"""Agent 节点执行器。

负责 dispatch 单个 Agent 节点:判定串行链 session 复用、调用
``AgentDispatcher.dispatch`` 派发、持久化完成态 / 失败态。

Do Not:
    - Do Not #19: 执行器必须无状态;禁止持有 results / chain_sessions
      / failed_nodes / skipped_nodes / db 等可变字段(详见 §11.2)。
    - Do Not #5: 事务边界由 WorkflowRunner / UoW 独占;本执行器为纯函数
      + 单步 IO,DB 写侧走 ``self.recorder``。
    - Do Not #8: P8 重试只一层 — 禁止内层重试循环与重试装饰器;全部重试
      由 WorkflowRunner 编排。
    - Do Not #18: ``trace_id`` 显式传入 ``dispatcher.dispatch``,
      不依赖 ContextVar。
    - Do Not #3: 不吞异常;所有异常向上抛或转 ``FinAgentError`` 后抛出。
    - Do Not #11: Executor 必须无状态,每次新建。
"""

from __future__ import annotations

from src.main.infra.domain import (
    AgentReference,
    SessionId,
    TraceId,
)
from src.main.infra.errors import (
    AgentNotFoundError,
    FinAgentError,
    InfraError,
)
from src.main.infra.logging import get_logger
from src.main.modules.agent.protocol import AgentDispatcher
from src.main.modules.execution.protocol import ExecutionRecorder
from src.main.modules.workflow.domain.dag import is_only_successor
from src.main.modules.workflow.executor.base import BaseNodeExecutor
from src.main.modules.workflow.protocol import NodeContext, NodeResult

logger = get_logger(__name__)


class AgentNodeExecutor(BaseNodeExecutor):
    """Agent 节点执行器。

    行为契约:
        1. 从 ``ctx["node"].agent`` 解析 ``AgentReference``;缺失抛
           ``AgentNotFoundError``(BIZ-1xxx)。
        2. 串行链判定:读 ``ctx["chain_sessions"]`` 只读快照 — 当且仅当
           唯一前驱 ``pred_id`` 在快照中且 ``is_only_successor`` 成立时
           复用 ``pred_id`` 对应的 ``session_id``,否则 ``None``(开新 session)。
        3. ``dispatcher.dispatch`` 显式传入 ``trace_id=trace_id``,不依赖
           ContextVar(Do Not #18)。
        4. 写权归 WorkflowRunner:本执行器不写内部链状态,通过返回
           ``NodeResult.session_id`` 由 runner 独占写入。
        5. 成功: ``recorder.record_node_completed`` → 返回 ``NodeResult``。
        6. 失败: ``recorder.record_node_failed`` → 包装为 ``InfraError`` →
           重新 raise(不 swallow)。
    """

    def __init__(
        self,
        *,
        dispatcher: AgentDispatcher,
        execution_recorder: ExecutionRecorder,
        trace_id: TraceId,
    ) -> None:
        super().__init__(
            dispatcher=dispatcher,
            execution_recorder=execution_recorder,
            trace_id=trace_id,
        )

    async def execute(self, ctx: NodeContext) -> NodeResult:
        """执行单个 agent 节点。

        Args:
            ctx: 节点执行上下文(只读快照)。

        Returns:
            ``NodeResult`` TypedDict — ``output`` 为 dispatcher 返回的
            ``result``,``session_id`` 为本次派发的 session,``extra_data``
            为空 dict。

        Raises:
            AgentNotFoundError: 节点未配置 agent 引用。
            FinAgentError: dispatch 失败或任何 infra 异常(已结构化)。
        """
        node = ctx["node"]
        node_id = node.id
        edges = ctx["edges"]
        trace_id = ctx["trace_id"]

        # ── 1. 解析 Agent 引用(Do Not #3: 缺失直接抛 BizError) ──
        agent: AgentReference | None = node.agent
        if agent is None:
            raise AgentNotFoundError(
                f"Node {node_id} has no agent reference defined",
                details={"node_id": str(node_id)},
            )

        # ── 2. 串行链判定(读 ctx["chain_sessions"] 只读快照) ──
        session_id: SessionId | None = None
        chain = ctx["chain_sessions"]
        predecessor_ids = ctx["predecessor_ids"]
        if len(predecessor_ids) == 1:
            pred_id = predecessor_ids[0]
            if pred_id in chain and is_only_successor(node_id, pred_id, edges):
                session_id = chain[pred_id]

        # ── 3. 构建 prompt ──
        prompt = self._build_prompt(ctx)

        # ── 4. Dispatch(trace_id 显式传入,Do Not #18) ──
        try:
            resp = await self.dispatcher.dispatch(
                agent=agent,
                prompt=prompt,
                session_id=session_id,
                trace_id=trace_id,
            )
        except FinAgentError as e:
            # dispatcher 已分类的异常:直接 raise,持久化由 WorkflowRunner 处理
            raise
        except Exception as e:
            # 未预期异常:包装为 InfraError,禁止静默吞掉
            wrapped = InfraError(
                f"Unexpected error during agent dispatch for node {node_id}: {e}",
                details={"node_id": str(node_id)},
                cause=e,
            )
            raise wrapped from e

        # ── 5. 成功 — 仅返回结果(持久化由 WorkflowRunner 处理) ──
        return {
            "output": resp["result"],
            "session_id": resp["session_id"],
            "extra_data": {},
        }

    def _build_prompt(self, ctx: NodeContext) -> str:
        """构建 agent prompt。

        本实现为简化版:把 ``params`` 序列化为文本片段,后续 TASK-308
        会替换为完整的 ``prompt_builder``。本卡片只保证执行器主链路
        可工作。

        Args:
            ctx: 节点执行上下文。

        Returns:
            prompt 字符串。
        """
        params = ctx["params"]
        node = ctx["node"]
        template = node.prompt or ""
        if template:
            return f"{template}\n\nParams: {params}"
        return f"Params: {params}"
