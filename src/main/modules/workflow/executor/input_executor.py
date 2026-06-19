"""Input 节点执行器。

把 ``NodeContext.params`` 透传为 ``NodeResult.output``;本节点无副作用、
无 session 绑定、无 DB 写侧,仅作为 DAG 入口节点的"参数注入"。

Do Not:
    - Do Not #19: 执行器必须无状态;禁止引入跨调用可变实例字段(详见
      base.py 中列出的禁止前缀清单)。
    - Do Not #5: 事务边界由 WorkflowRunner / UoW 独占;本执行器为纯函数。
    - Do Not #3: 不吞异常;任何异常直接向上抛。
"""

from __future__ import annotations

from src.main.infra.domain import TraceId
from src.main.modules.agent.protocol import AgentDispatcher
from src.main.modules.execution.protocol import ExecutionRecorder
from src.main.modules.workflow.executor.base import BaseNodeExecutor
from src.main.modules.workflow.protocol import NodeContext, NodeResult


class InputNodeExecutor(BaseNodeExecutor):
    """Input 节点执行器:透传 params。

    典型用法:作为 DAG 的入口节点,把触发参数(payload)原样注入下游节点
    的 ``results`` 快照,下游节点即可从 ``ctx["results"][input_node_id"]``
    读到完整参数。
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
        """执行 input 节点。

        Args:
            ctx: 节点执行上下文(只读快照)。仅使用 ``ctx["params"]``。

        Returns:
            ``NodeResult``: ``output = ctx["params"]``,``session_id = None``,
            ``extra_data = {}``。
        """
        return {
            "output": ctx["params"],
            "session_id": None,
            "extra_data": {},
        }