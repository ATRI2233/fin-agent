"""Debate 节点执行器。

并行 dispatch 多个 Agent(辩论参与者),按 ``ctx["node"].data["strategy"]``
选择合并策略(``summary`` / ``vote`` / ``first``),返回结构化结果与
``extra_data["debate_session_ids"]``。

设计要点:
    - **无状态**: 执行器不持有任何跨调用可变字段(Do Not #19,具体
      禁用字段见 ``base.py``)。
    - **事务边界**: 执行器本身不 commit;持久化通过
      ``ExecutionRecorder.record_node_completed`` 写侧完成(Do Not #5)。
    - **ContextVar 显式绑定**: 遵循 v2.1 §7.6,``bind_contextvars`` /
      ``unbind_contextvars`` 必须配对,``dispatch_parallel`` 必须显式传入
      ``trace_id=trace_id``(Do Not #18)。
    - **不吞异常**: 异常直接向上抛或交由 ``AgentDispatcher`` 包装为
      ``FinAgentError``(Do Not #3 / Do Not #16)。
    - **无内层重试**: 上游 ``AgentDispatcher`` 已封装 5xx 重试策略,
      本执行器不重复实现(Do Not #8)。

Do Not:
    - Do Not #19: 执行器必须无状态;跨调用持久化状态由 ``WorkflowRunner``
      独占,通过 ``NodeContext`` 只读快照传入。
    - Do Not #18(v2.1 §7.6): ContextVar 在跨 Task 调度时只继承调度时刻
      快照,子 Task 的 set 不会回写;一旦污染,日志 ``trace_id`` 错乱且
      不可复现。必须显式 ``bind_contextvars`` + ``unbind_contextvars``
      配对,``dispatch_parallel`` 调用必须显式传入 ``trace_id``。
    - Do Not #8: 无内层重试;超时/退避由 ``settings.py`` 与
      ``AgentDispatcher`` 统一管理。
    - Do Not #3: 不吞异常;异常直接向上抛。
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from structlog.contextvars import bind_contextvars, unbind_contextvars

from src.main.infra.domain import AgentReference, SessionId, TraceId
from src.main.infra.errors import ValidationError
from src.main.modules.workflow.executor.base import BaseNodeExecutor
from src.main.modules.workflow.protocol import NodeContext, NodeResult


class DebateNodeExecutor(BaseNodeExecutor):
    """辩论节点执行器:并行 dispatch 多个 Agent,合并结果。

    节点 schema(TASK-302 ``Node.data``):
        - ``participants``: ``list[AgentReference]``,辩论参与者列表(必填)。
          兼容 ``list[str]``(Agent 名称),内部经 ``AgentReference(name, ...)``
          包装。
        - ``strategy``: 合并策略;取值为 ``"summary"``(默认)/ ``"vote"`` /
          ``"first"`` 之一。

    执行流程(v2.1 §7.6 合规):
        1. 解析 ``participants`` 与 ``strategy``;空参与者 → ``ValidationError``。
        2. ``bind_contextvars(trace_id=..., node_id=..., event="debate.started")``。
        3. ``dispatch_parallel(agents, prompt, trace_id=trace_id)``(显式传 trace_id)。
        4. ``finally`` 中 ``unbind_contextvars("trace_id", "node_id", "event")``。
        5. 按 ``strategy`` 合并 ``results`` → ``merged``。
        6. ``recorder.record_node_completed(...)`` 写侧持久化。
        7. 返回 ``NodeResult``,``extra_data["debate_session_ids"]`` 含所有
           debate-style 辅助 session_id(修订 T-3:不与主 session_id 重叠)。
    """

    # ──────────────────────────────────────────────────────────────────
    # 构造
    # ──────────────────────────────────────────────────────────────────

    def __init__(self, *, dispatcher, execution_recorder, trace_id) -> None:
        super().__init__(
            dispatcher=dispatcher,
            execution_recorder=execution_recorder,
            trace_id=trace_id,
        )

    # ──────────────────────────────────────────────────────────────────
    # 主入口
    # ──────────────────────────────────────────────────────────────────

    async def execute(self, ctx: NodeContext) -> NodeResult:
        """执行辩论节点。

        Args:
            ctx: 节点执行上下文(只读快照)。

        Returns:
            ``NodeResult``:
                - ``output``: 合并后的辩论产出(策略相关,见 ``_merge``)。
                - ``session_id``: 主辩论 session(取 ``session_ids[0]`` 或
                  ``results[0].session_id``;辩论/纯计算场景可能为 ``None``)。
                - ``extra_data``: ``{"debate_session_ids": [...]}``,所有
                  debate-style 辅助 session_id(字符串形式)。

        Raises:
            ValidationError: 节点无参与者或合并策略未知。
            FinAgentError: ``AgentDispatcher`` 包装后的结构化异常
                (``AgentTimeoutError`` / ``AgentHttp5xxError`` /
                ``OpencodeUnavailableError`` / ``McpServerError`` 之一)。
        """
        node = ctx["node"]
        node_id = node.id
        trace_id = ctx["trace_id"]
        execution_id = ctx["execution_id"]

        # ── 解析参与者与合并策略 ────────────────────────────────────
        participants = self._resolve_participants(node.data)
        strategy = node.data.get("strategy", "summary")

        # ── v2.1 §7.6 强约束:显式 bind / unbind ContextVar ───────────
        bind_contextvars(
            trace_id=str(trace_id),
            node_id=str(node_id),
            event="debate.started",
        )
        try:
            # 显式传 trace_id(Do Not #18:不可隐式依赖 ContextVar)。
            results, extra_session_ids = await self.dispatcher.dispatch_parallel(
                agents=participants,
                prompt=self._build_prompt(node, ctx),
                timeout=None,
                trace_id=trace_id,
            )
        finally:
            unbind_contextvars("trace_id", "node_id", "event")

        # ── 主 session_id 提取 ────────────────────────────────────────
        # 优先取首个 DispatchResult 的 session_id;若 results 元素是
        # 裸值(非 dict,如单元测试简化 mock),退化取 ``extra_session_ids[0]``。
        primary_session_id: SessionId | None = DebateNodeExecutor._extract_primary_session(
            results, extra_session_ids
        )

        # ── 合并 ──────────────────────────────────────────────────────
        merged = self._merge(results, strategy)

        # ── 写侧:持久化节点完成状态(由 ExecutionRecorder 独占 commit)─
        await self.recorder.record_node_completed(
            execution_id=execution_id,
            node_id=node_id,
            output={"result": merged, "strategy": strategy},
            session_id=primary_session_id,
            trace_id=trace_id,
        )

        # ── 组装 NodeResult(extra_data 必须含 debate_session_ids)─────
        all_session_ids: list[SessionId] = list(extra_session_ids)
        return {
            "output": merged,
            "session_id": primary_session_id,
            "extra_data": {
                "debate_session_ids": [str(s) for s in all_session_ids],
                "strategy": strategy,
            },
        }

    # ──────────────────────────────────────────────────────────────────
    # 辅助
    # ──────────────────────────────────────────────────────────────────

    @staticmethod
    def _extract_primary_session(
        results: list,
        extra_session_ids: list[SessionId],
    ) -> SessionId | None:
        """提取辩论的主 session_id(辅助方法,便于测试与防御性 fallback)。

        优先级:
            1. ``results[0]["session_id"]``: 标准 ``DispatchResult`` 形态。
            2. ``extra_session_ids[0]``: results 元素为非 dict 时的 fallback。
            3. ``None``: 二者皆空。

        Args:
            results: ``dispatch_parallel`` 返回的第一个列表(可能含 dict 或裸值)。
            extra_session_ids: ``dispatch_parallel`` 返回的辅助 session_id 列表。

        Returns:
            主 session_id,或 ``None``。
        """
        if results:
            first = results[0]
            if isinstance(first, dict):
                sid = first.get("session_id")
                if isinstance(sid, SessionId):
                    return sid
        if extra_session_ids:
            return extra_session_ids[0]
        return None

    # ──────────────────────────────────────────────────────────────────
    # 参与者解析
    # ──────────────────────────────────────────────────────────────────

    @staticmethod
    def _resolve_participants(node_data: dict) -> list[AgentReference]:
        """从 ``node.data["participants"]`` 解析辩论参与者列表。

        接受两种 schema:
            - ``list[AgentReference]``: 已构造好的引用列表。
            - ``list[str]``: Agent 名称列表,内部包装为
              ``AgentReference(name, definition_path=None)``。

        Args:
            node_data: 节点 data 字典。

        Returns:
            ``AgentReference`` 列表(顺序敏感,影响 ``strategy="first"`` 结果)。

        Raises:
            ValidationError: 字段缺失/为空/类型错误。
        """
        raw = node_data.get("participants")
        if not raw:
            raise ValidationError(
                "debate node requires non-empty 'participants' list",
                details={"node_data_keys": list(node_data.keys())},
            )
        if not isinstance(raw, list):
            raise ValidationError(
                "debate node 'participants' must be a list",
                details={"got_type": type(raw).__name__},
            )

        result: list[AgentReference] = []
        for idx, item in enumerate(raw):
            if isinstance(item, AgentReference):
                result.append(item)
            elif isinstance(item, str):
                if not item:
                    raise ValidationError(
                        "debate participant name must be non-empty",
                        details={"index": idx},
                    )
                result.append(AgentReference(name=item, definition_path=None))
            else:
                raise ValidationError(
                    "debate participant must be AgentReference or str",
                    details={"index": idx, "got_type": type(item).__name__},
                )
        return result

    # ──────────────────────────────────────────────────────────────────
    # Prompt 构造
    # ──────────────────────────────────────────────────────────────────

    @staticmethod
    def _build_prompt(node, ctx: NodeContext) -> str:
        """构造辩论 prompt。

        优先级:
            1. ``node.prompt`` 显式模板(若非空)。
            2. 回退到 ``ctx["params"].get("prompt", "")``。

        注: 此处不调用 ``prompt_builder``(Task 后续会注入更复杂的
        模板渲染);辩论场景 prompt 通常由前端固定写入 ``node.prompt``。

        Args:
            node: 当前节点值对象。
            ctx: 节点执行上下文。

        Returns:
            最终 prompt 字符串(允许为空,但 ``AgentDispatcher`` 内部
            仍会做非空校验)。
        """
        if node.prompt:
            return node.prompt
        params = ctx.get("params") or {}
        prompt = params.get("prompt")
        return prompt if isinstance(prompt, str) else ""

    # ──────────────────────────────────────────────────────────────────
    # 合并策略
    # ──────────────────────────────────────────────────────────────────

    @staticmethod
    def _merge(results: list, strategy: str) -> Any:
        """按策略合并多个 ``DispatchResult.result``。

        策略语义:
            - ``"summary"``(默认): 返回 ``list[result]``,保留所有参与者
              的原始结果,供下游或人工审阅聚合(任务卡 §4.3 暂留 TODO,
              简化版即为列表返回;LLM summary 留给后续 TASK)。
            - ``"vote"``: 取 ``Counter`` 多数票;平票时取首个出现的。
            - ``"first"``: 取 ``results[0].result``。

        Args:
            results: ``DispatchResult`` 列表(可能为空)。
            strategy: 策略字符串。

        Returns:
            合并后的产出;类型随策略而异(``list`` / 标量)。

        Raises:
            ValidationError: 策略未知或 ``results`` 为空(空列表下任何
                策略均无意义,显式报错便于上游定位)。
        """
        if not results:
            raise ValidationError(
                "debate merge called with empty results",
                details={"strategy": strategy},
            )

        if strategy == "summary":
            return [DebateNodeExecutor._extract_result_value(r) for r in results]
        if strategy == "vote":
            counter = Counter(
                DebateNodeExecutor._extract_result_value(r) for r in results
            )
            # most_common 平票时保留出现顺序:Counter 已经按插入序迭代;
            # 直接取最频繁项,出现频次相同时 most_common 返回首个最频繁的。
            top_value, _ = counter.most_common(1)[0]
            return top_value
        if strategy == "first":
            return DebateNodeExecutor._extract_result_value(results[0])
        raise ValidationError(
            "unknown debate merge strategy",
            details={"strategy": strategy, "allowed": ["summary", "vote", "first"]},
        )

    @staticmethod
    def _extract_result_value(item: Any) -> Any:
        """从 ``DispatchResult`` 提取 ``result`` 字段(防御性 fallback)。

        标准形态: ``item`` 为 dict,键 ``result``。
        简化 mock/裸值: ``item`` 本身就是结果值(字符串等)。

        Args:
            item: 单个 ``DispatchResult`` 或裸值。

        Returns:
            ``result`` 字段值,或 ``item`` 本身。
        """
        if isinstance(item, dict):
            return item.get("result", item)
        return item