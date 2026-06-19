"""NodeExecutor 基类。

定义 ``BaseNodeExecutor`` 抽象基类(ABC),为 TASK-305~308 的具体执行器
提供统一的依赖注入接口。

Do Not:
    - Do Not #11: Executor 必须无状态,每次新建。基类本身不持有跨调用
      可变状态,具体子类亦不得引入 ``_results`` / ``_failed_nodes`` /
      ``_skipped_nodes`` / ``_chain_sessions`` / ``_db`` 等字段。
    - Do Not #19(v2.1): 所有跨调用持久化状态由 ``WorkflowRunner`` 独占,
      通过 ``NodeContext`` 只读快照传入执行器。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from src.main.infra.domain import TraceId
from src.main.modules.agent.protocol import AgentDispatcher
from src.main.modules.execution.protocol import ExecutionRecorder
from src.main.modules.workflow.protocol import NodeContext, NodeExecutor, NodeResult


class BaseNodeExecutor(NodeExecutor, ABC):
    """节点执行器抽象基类。

    接受三个 keyword-only 依赖 ``dispatcher`` / ``execution_recorder`` /
    ``trace_id``,供子类在 ``execute`` 中使用。

    约束:
        - 不可直接实例化(``@abstractmethod``)。
        - 不持有任何可变状态字段(``self._xxx`` 字典/列表/集合均为禁止)。
        - ``execute`` 必须为 ``async def``。

    Attributes:
        dispatcher: Agent 调度器(仅 agent / debate 节点使用)。
        recorder: 执行记录写侧(用于持久化节点状态)。
        trace_id: 审计/追踪 ID。
    """

    def __init__(
        self,
        *,
        dispatcher: AgentDispatcher,
        execution_recorder: ExecutionRecorder,
        trace_id: TraceId,
    ) -> None:
        self.dispatcher = dispatcher
        self.recorder = execution_recorder
        self.trace_id = trace_id

    @abstractmethod
    async def execute(self, ctx: NodeContext) -> NodeResult:
        """执行单个节点(由子类实现)。"""
        ...