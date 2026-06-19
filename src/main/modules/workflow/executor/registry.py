"""节点执行器注册表。

提供 ``NodeExecutorRegistry`` 类与模块级 ``default_registry`` 实例,
按 ``NodeType`` 注册并创建无状态 ``NodeExecutor``。

设计要点:
    - **无实例缓存**: Registry 只持有 ``cls``,每次 ``create`` 返回新实例
      (Do Not #11 / Do Not #19:执行器必须无状态)。
    - **无反射修补**: 不通过 ``try: cls() except TypeError`` 反射绑定参数;
      所有参数由 ``create`` 调用方显式传入,签名不匹配时由 Python
      ``TypeError`` 透传(Do Not #2:接口没对齐时用反射修补 = 隐藏 bug)。
    - **可由后续 TASK-305~308 在 ``build_registry`` 时调用 ``register``**,
      本文件不预注册任何 NodeType。

Do Not:
    - Do Not #11: Registry 只持有 ``cls``,**不**持有 ``instance``。
    - Do Not #19: 不引入 ``_instances`` 缓存;不允许 ``@lru_cache`` 包裹
      ``create``。
    - Do Not #2: 接口未对齐时禁止反射修补;必须改 Protocol。
"""

from __future__ import annotations

from src.main.infra.domain import TraceId
from src.main.infra.errors import RegistryError
from src.main.modules.agent.protocol import AgentDispatcher
from src.main.modules.execution.protocol import ExecutionRecorder
from src.main.modules.workflow.domain.node import NodeType
from src.main.modules.workflow.protocol import NodeExecutor, NodeExecutorFactory


class NodeExecutorRegistry(NodeExecutorFactory):
    """按 ``NodeType`` 创建对应 ``NodeExecutor`` 实例的注册表。

    内部以 ``dict[NodeType, type[NodeExecutor]]`` 存储 class 引用,
    ``create`` 方法以 keyword-only 依赖调用对应 class 的构造函数,
    每次返回新实例。
    """

    def __init__(self) -> None:
        self._factories: dict[NodeType, type[NodeExecutor]] = {}

    def register(
        self,
        node_type: NodeType,
        executor_cls: type[NodeExecutor],
    ) -> None:
        """注册或替换某个 ``NodeType`` 对应的执行器 class。

        Args:
            node_type: 节点类型枚举值。
            executor_cls: ``NodeExecutor`` 子类(必须是 class 引用,非实例)。
        """
        self._factories[node_type] = executor_cls

    def create(
        self,
        node_type: str,
        *,
        dispatcher: AgentDispatcher,
        execution_recorder: ExecutionRecorder,
        trace_id: TraceId,
    ) -> NodeExecutor:
        """创建对应类型的 ``NodeExecutor`` 实例(每次新实例,无缓存)。

        Args:
            node_type: 节点类型字符串(``NodeType.value``,如 ``"agent"`` /
                ``"input"`` / ``"output"`` / ``"debate"``)。
            dispatcher: Agent 调度器。
            execution_recorder: 执行记录写侧。
            trace_id: 审计/追踪 ID。

        Returns:
            新建的 ``NodeExecutor`` 实例。

        Raises:
            RegistryError: 对应 ``node_type`` 未注册。
        """
        cls = self._factories.get(node_type)
        if cls is None:
            raise RegistryError(f"no executor registered for node_type={node_type!r}")
        return cls(
            dispatcher=dispatcher,
            execution_recorder=execution_recorder,
            trace_id=trace_id,
        )


# 模块级默认注册表实例(无状态,无可变字段,允许共享)。
# 不在此处预注册任何 NodeType —— 具体 executor 在 TASK-305~308 的
# ``build_registry`` 中按需注册,避免循环 import。
default_registry = NodeExecutorRegistry()