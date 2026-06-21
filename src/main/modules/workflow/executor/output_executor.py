"""Output 节点执行器。

聚合所有前驱节点的 ``output``,封装为 ``{"inputs": [...]}`` 返回。
本节点无副作用、无 session 绑定、无 DB 写侧;**不**触发 session cleanup,
清理决策由 ``WorkflowRunner`` 独占(Do Not #19:执行器无状态)。

Do Not:
    - Do Not #19: 执行器必须无状态;禁止引入跨调用可变实例字段(详见
      base.py 中列出的禁止前缀清单)。
    - Do Not #5: 事务边界由 WorkflowRunner / UoW 独占;本执行器为纯函数。
    - Do Not #3: 不吞异常;任何异常直接向上抛。
    - 不触发 session cleanup: 留给 WorkflowRunner。
"""

from __future__ import annotations

from src.main.infra.domain import TraceId
from src.main.modules.agent.protocol import AgentDispatcher
from src.main.modules.execution.protocol import ExecutionRecorder
from src.main.modules.workflow.executor.base import BaseNodeExecutor
from src.main.modules.workflow.protocol import NodeContext, NodeResult


class OutputNodeExecutor(BaseNodeExecutor):
    """Output 节点执行器:聚合上游 output 列表。

    典型用法:作为 DAG 的出口节点,把多个前驱节点的 ``output`` 字段收集为
    一个列表,便于上游调用方统一获取整个工作流的产出。

    容错:当某个 ``predecessor_id`` 在 ``ctx["results"]`` 中不存在时,
    静默跳过该前驱(Do Not #3 仍受保护——此处是"可选缺失",并非"吞异常"):
    失败的前驱已被 WorkflowRunner 标记为 ``failed_nodes``,本节点仅消费
    成功的前驱输出。若所有前驱均缺失,返回 ``{"inputs": []}``。
    """

    def __init__(
        self,
        *,
        dispatcher: AgentDispatcher | None = None,
        execution_recorder: ExecutionRecorder | None = None,
        trace_id: TraceId | None = None,
    ) -> None:
        super().__init__(
            dispatcher=dispatcher,  # type: ignore[arg-type]
            execution_recorder=execution_recorder,  # type: ignore[arg-type]
            trace_id=trace_id,  # type: ignore[arg-type]
        )

    async def execute(self, ctx: NodeContext) -> NodeResult:
        """执行 output 节点。

        Args:
            ctx: 节点执行上下文(只读快照)。使用 ``ctx["predecessor_ids"]``
                与 ``ctx["results"]`` 以及 ``ctx["failed_nodes"]``。

        Returns:
            ``NodeResult``: ``output = {"inputs": [...]}``,
            ``session_id = None``,``extra_data = {}``。

        Raises:
            ValidationError: 当某个 predecessor 既不在 ``results`` 中也不
                在 ``failed_nodes`` 中时 —— 表明 WorkflowRunner 存在 bug
                (漏执行了某个前驱且未标记为失败)。
        """
        from src.main.infra.errors import ValidationError

        inputs: list = []
        for pid in ctx["predecessor_ids"]:
            if pid in ctx["results"]:
                val = ctx["results"][pid]
                inputs.append(
                    val.get("output") if isinstance(val, dict) else val
                )
            elif pid in ctx.get("failed_nodes", set()):
                # 前驱已失败(被级联跳过或显式失败),允许缺失。
                continue
            else:
                # predecessor 既不在 results 也不在 failed_nodes — runner bug
                raise ValidationError(
                    "output node encountered a predecessor that is neither "
                    "completed nor failed",
                    details={
                        "missing_predecessor": str(pid),
                        "node_id": str(ctx["node"].id),
                        "execution_id": str(ctx["execution_id"]),
                    },
                )

        return {
            "output": {"inputs": inputs},
            "session_id": None,
            "extra_data": {},
        }