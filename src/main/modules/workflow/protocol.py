"""工作流模块对外 Protocol 集合。

本文件是 ``modules/workflow`` 对其他模块暴露的唯一接口文件,符合
TARGET_ARCHITECTURE_v2 §0 P2 (对外只暴露 Protocol) 与 §3.6.3 的契约。

包含的 Protocol:
    - ``NodeContext`` TypedDict: 节点执行的只读快照。
    - ``NodeResult`` TypedDict: 节点执行的产出。
    - ``ExecutionSummary`` TypedDict: 执行总览。
    - ``RetryResult`` TypedDict: 重试结果。
    - ``NodeExecutor``: 无状态节点执行器。
    - ``NodeExecutorFactory``: 节点执行器工厂。
    - ``WorkflowRunner``: 触发一次工作流执行。
    - ``WorkflowReader``: 只读工作流/执行查询。
    - ``RetryService``: DAG-aware retry + circuit breaker。
    - ``CircuitBreaker``: 单节点失败计数 + 熔断状态(修订 T-1 从 execution 移入)。

修订关联:
    - REVISION_NOTES_2026-06-18.md **修订 T-1**: ``CircuitBreaker`` Protocol
      从 execution 模块移入本文件;execution 不感知熔断决策。
    - REVISION_NOTES_2026-06-18.md **修订 T-2**: ``RetryService`` docstring
      明示 composite key;``CircuitBreaker`` 三方法均接收 ``trace_id``。
    - REVISION_NOTES_2026-06-18.md **Bug C-8**: composite key 追加
      ``trace_id`` 维度,适配多 worker 部署。

Do Not:
    - Do Not #1: 禁止跨模块 ``from X import _xxx``。
    - Do Not #2: 接口未对齐时禁止反射修补;须改 Protocol。
    - Do Not #19: 执行器必须无状态;持久化状态由 WorkflowRunner 独占。
    - Do Not(类型一致性): 所有 ``params`` 参数必须含类型注解 ``dict[str, Any]``。
"""

from __future__ import annotations

from typing import Any, Mapping, Protocol, TypedDict, runtime_checkable

from src.main.infra.domain import (
    ExecutionId,
    NodeId,
    RetryPolicy,
    SessionId,
    TraceId,
    WorkflowId,
)
from src.main.modules.agent.protocol import AgentDispatcher
from src.main.modules.execution.protocol import ExecutionRecorder


# ── TypedDict ──


class NodeContext(TypedDict):
    """节点执行的只读快照。

    由 ``WorkflowRunner``(TASK-309)在调度节点前构造,传给 ``NodeExecutor.execute``。
    所有字段均为只读快照,执行器不得修改;持久化/共享状态由 WorkflowRunner
    独占管理(Do Not #19: 执行器必须无状态)。

    Attributes:
        node: 当前节点数据对象(类型由 TASK-302 domain 层定义;此处用字符串
            forward ref 以避免循环 import)。
        execution_id: 所属执行 ID。
        predecessor_ids: 前驱节点 ID 列表(拓扑序)。
        params: 触发执行的参数(payload);具体业务字段在 ``ExecutionParams``
            TypedDict(TASK-002 ``infra.domain``)中定义。
        results: 前驱节点已完成结果快照,``NodeId`` -> ``NodeResult``。
        edges: 与当前节点相关的边数据列表(类型由 TASK-302 定义)。
        trace_id: 审计/追踪 ID。
        chain_sessions: 链路上的 session 绑定快照,``NodeId`` -> ``SessionId``。
            写权在 WorkflowRunner,执行器只读。
    """

    node: "Node"
    execution_id: ExecutionId
    predecessor_ids: list[NodeId]
    params: dict[str, Any]
    results: dict[NodeId, "NodeResult"]
    edges: list["Edge"]
    trace_id: TraceId
    chain_sessions: Mapping[NodeId, SessionId]
    failed_nodes: set[NodeId]  # ← 修订 T-5: 让 output executor 区分"失败 vs 缺失"


class NodeResult(TypedDict):
    """节点执行的产出结构。

    Attributes:
        output: 节点产出的结构化数据(类型 ``Any``,因不同节点类型 schema 不固定)。
        session_id: 关联 session ID;纯计算节点可能为 ``None``。
        extra_data: 附加元数据(例如 debate_session_ids、retry_count 等)。
    """

    output: Any
    session_id: SessionId | None
    extra_data: dict[str, Any]


class ExecutionSummary(TypedDict):
    """执行总览。

    Attributes:
        execution_id: 执行 ID。
        workflow_id: 所属工作流 ID。
        status: 执行终态(字符串 forward ref;具体枚举由 TASK-202 定义)。
        results: 所有已完成节点的结果,``NodeId`` -> ``NodeResult``。
        failed_nodes: 失败节点 ID 列表。
        skipped_nodes: 被跳过节点 ID 列表。
    """

    execution_id: ExecutionId
    workflow_id: WorkflowId
    status: "ExecutionStatus"
    results: dict[NodeId, NodeResult]
    failed_nodes: list[NodeId]
    skipped_nodes: list[NodeId]


class RetryResult(TypedDict):
    """重试结果。

    Attributes:
        success: 是否成功。
        result: 成功时的节点结果(``NodeResult`` 或 ``ExecutionSummary`` 之一);
            失败时为 ``None``。
        error: 失败时的错误描述;成功时为 ``None``。
        retry_count: 已重试次数(含首次尝试)。
    """

    success: bool
    result: Any | None
    error: str | None
    retry_count: int


# ── Protocol ──


@runtime_checkable
class NodeExecutor(Protocol):
    """无状态节点执行器。

    每次调用都是新实例;不允许持有跨调用持久化状态(Do Not #19)。
    所有跨调用共享状态由 WorkflowRunner 通过 ``NodeContext`` 只读快照传入。

    实现约束:
        - ``execute`` 必须为 ``async def``(允许节点内做 IO / dispatch agent)。
        - 不抛非 ``FinAgentError`` 子类的异常;异常分层遵循 Do Not #16。
    """

    async def execute(self, ctx: NodeContext) -> NodeResult:
        """执行单个节点。

        Args:
            ctx: 节点执行上下文(只读快照)。

        Returns:
            ``NodeResult`` TypedDict。

        Raises:
            FinAgentError: 结构化异常(BizError / SystemError / InfraError 之一)。
        """
        ...


@runtime_checkable
class NodeExecutorFactory(Protocol):
    """节点执行器工厂。

    按节点类型创建对应的 ``NodeExecutor`` 实例;实现类可在工厂内注入
    ``AgentDispatcher`` / ``ExecutionRecorder`` 等依赖。
    """

    def create(
        self,
        node_type: str,
        *,
        dispatcher: AgentDispatcher,
        execution_recorder: ExecutionRecorder,
        trace_id: TraceId,
    ) -> NodeExecutor:
        """创建节点执行器。

        Args:
            node_type: 节点类型字符串(例如 ``"agent"`` / ``"input"`` /
                ``"output"`` / ``"debate"``);具体枚举在 TASK-302。
            dispatcher: Agent 调度器,用于 agent 节点派发。
            execution_recorder: 执行记录写侧,用于持久化节点状态。
            trace_id: 审计/追踪 ID。

        Returns:
            对应类型的 ``NodeExecutor`` 实例(无状态,每次调用可返回新实例)。
        """
        ...


@runtime_checkable
class WorkflowRunner(Protocol):
    """触发一次工作流执行。

    负责 DAG 解析、拓扑排序、并行分支调度、状态机推进、重试 + 熔断协调。
    所有持久化状态由本接口独占管理;``NodeExecutor`` 无状态。
    """

    async def run(
        self,
        workflow_id: WorkflowId,
        params: dict[str, Any],
        *,
        execution_id: ExecutionId | None = None,
        trace_id: TraceId,
    ) -> ExecutionSummary:
        """执行工作流。

        Args:
            workflow_id: 工作流 ID。
            params: 触发参数(payload);类型 ``dict[str, Any]`` 为宽泛约束,
                业务字段在 ``ExecutionParams`` TypedDict(TASK-002 ``infra.domain``)
                中定义;Protocol 层只用宽泛类型,具体字段由调用方契约保证。
            execution_id: 可选,显式指定 execution_id;``None`` 时由实现方自生成。
            trace_id: 审计/追踪 ID,keyword-only,贯穿整个执行。

        Returns:
            ``ExecutionSummary`` TypedDict,含所有节点结果 + 终态。

        Raises:
            WorkflowNotFoundError: 工作流不存在。
            ValidationError: DAG 校验失败(环、孤立节点等)。
            FinAgentError: 其他结构化异常。
        """
        ...


@runtime_checkable
class WorkflowReader(Protocol):
    """只读工作流 / 执行查询接口。

    纯查询,不阻塞事件循环;不写审计日志(审计只跟随写侧)。
    """

    def get(self, workflow_id: WorkflowId) -> Any | None:
        """获取工作流定义。

        Args:
            workflow_id: 工作流 ID。

        Returns:
            工作流数据对象(由 TASK-302 domain 层定义),不存在返回 ``None``。
        """
        ...

    def list(
        self,
        *,
        limit: int,
        offset: int,
    ) -> list[Any]:
        """列出工作流(分页)。

        Args:
            limit: 返回条数上限(keyword-only)。
            offset: 分页偏移(keyword-only)。

        Returns:
            工作流数据对象列表(按 ``updated_at`` 倒序)。
        """
        ...


@runtime_checkable
class RetryService(Protocol):
    """DAG-aware retry + circuit breaker.

    Circuit breaker composite key MUST be ``(execution_id, node_id, trace_id)`` —
    the same node_id appears in different executions AND the same (execution_id,
    node_id) may be retried under different trace_ids (Bug C-8: 多 worker 部署
    场景下,内存版熔断器必须以 trace_id 区分,避免 worker 间失败计数误串)。
    Implementations persist counts keyed on this composite string.

    Both retry methods take an explicit ``policy: RetryPolicy`` so the public
    contract matches the implementation (no hidden ``_get_policy(node)``
    parsing inside implementations).

    ``params`` 字段类型为 ``dict[str, Any]``,具体业务字段在
    ``ExecutionParams`` TypedDict(TASK-002 ``infra.domain``)中定义,
    Protocol 层仅用宽泛类型约束。
    """

    async def retry_node(
        self,
        execution_id: ExecutionId,
        node_id: NodeId,
        *,
        policy: RetryPolicy,
        trace_id: TraceId,
    ) -> RetryResult:
        """重试单个节点(在其所属 execution 内)。

        Args:
            execution_id: 所属执行 ID。
            node_id: 目标节点 ID。
            policy: 重试策略(keyword-only,显式传入)。
            trace_id: 审计/追踪 ID(keyword-only)。

        Returns:
            ``RetryResult`` TypedDict。
        """
        ...

    async def retry_workflow(
        self,
        workflow_id: WorkflowId,
        *,
        params: dict[str, Any],
        from_node_id: NodeId | None,
        policy: RetryPolicy,
        trace_id: TraceId,
    ) -> RetryResult:
        """从指定节点开始重试整条工作流(可能创建新 execution)。

        Args:
            workflow_id: 工作流 ID。
            params: 触发参数(payload);``dict[str, Any]`` 宽泛类型,
                业务字段在 ``ExecutionParams`` TypedDict 中定义。
            from_node_id: 从哪个节点开始重跑;``None`` 表示从头开始。
            policy: 重试策略(keyword-only)。
            trace_id: 审计/追踪 ID(keyword-only)。

        Returns:
            ``RetryResult`` TypedDict。
        """
        ...


@runtime_checkable
class CircuitBreaker(Protocol):
    """Per-execution node failure threshold + cooldown state.

    Implementations live in ``modules/workflow/service/retry_service.py``.
    The execution module does NOT import this Protocol — it only persists
    node-level failure counts; circuit decisions belong to workflow
    orchestration.

    Bug C-8 变更: composite key 追加 ``trace_id`` 维度。
    多 worker 部署(uvicorn)时,同一 ``(execution_id, node_id)`` 的失败
    计数可能来自不同 worker 的不同 trace;内存版熔断器必须以
    ``(execution_id, node_id, trace_id)`` 区分,避免 worker 间的失败
    计数误串导致熔断误判。persistence 版(若未来)仍以 composite 存。

    三方法 ``is_open`` / ``record_failure`` / ``reset`` 均接收
    ``trace_id: TraceId`` 参数。
    """

    def is_open(self, execution_id: ExecutionId, node_id: NodeId, trace_id: TraceId) -> bool:
        """判断指定节点是否处于熔断状态(达到失败阈值 + 冷却中)。

        Args:
            execution_id: 所属执行 ID。
            node_id: 目标节点 ID。
            trace_id: 审计/追踪 ID(composite key 的一部分,Bug C-8)。

        Returns:
            ``True`` 表示已熔断(暂停重试);``False`` 表示可继续。
        """
        ...

    def record_failure(self, execution_id: ExecutionId, node_id: NodeId, trace_id: TraceId) -> None:
        """记录一次失败,累加对应 composite key 的失败计数。

        Args:
            execution_id: 所属执行 ID。
            node_id: 目标节点 ID。
            trace_id: 审计/追踪 ID(composite key 的一部分,Bug C-8)。
        """
        ...

    def reset(self, execution_id: ExecutionId, node_id: NodeId, trace_id: TraceId) -> None:
        """重置(清零)指定 composite key 的失败计数,通常在节点成功后调用。

        Args:
            execution_id: 所属执行 ID。
            node_id: 目标节点 ID。
            trace_id: 审计/追踪 ID(composite key 的一部分,Bug C-8)。
        """
        ...