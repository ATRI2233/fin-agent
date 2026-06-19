"""DefaultWorkflowRunner — DAG orchestration engine.

Phase 3 / TASK-309 核心卡。

本类实现 ``WorkflowRunner`` Protocol,负责:
    1. 读取工作流定义 (``WorkflowReader``)
    2. 计算 DAG 拓扑序、并行分支、前驱映射
    3. 拓扑驱动执行: ``record_node_started`` → dispatch → ``record_node_completed``/``record_node_failed``
    4. 失败级联: ``find_downstream(node_id, workflow.edges)`` 跳过所有下游
    5. 最终标记 execution 终态 + 返回 ``ExecutionSummary``

设计约束(强约束,见 TASK-309 §5 Do Not 清单):
    - **Do Not #19**(v2.1 §11.2): 执行器必须无状态;所有跨调用持久化状态
      (``_results`` / ``_failed_nodes`` / ``skipped_nodes`` / ``_chain_sessions``)
      集中在 ``WorkflowRunner`` 本类,执行器只通过 ``NodeContext`` 只读快照消费。
    - **Do Not #18 / Bug C-7**(v2.1 §7.6 + §11.2): ``bind_contextvars`` 仅用于
      logging 横切层(structlog 自动附加到日志 metadata),worker 函数(包括
      嵌套子执行器)必须显式接收 ``trace_id`` 参数,不得依赖 ContextVar 跨调用
      传递。本类在 ``run`` 入口 ``bind_contextvars(trace_id=...)``,``finally``
      块 ``unbind_contextvars("trace_id")`` —— 不保存 token(一次性 bind/unbind,
      范围 = 单次 run 调用的同步代码段),**禁止嵌套 bind 时不保存 token 的反 pattern**。
    - **Do Not(dag 纯函数契约)**: 禁止调 ``find_downstream(node_id, workflow)``,
      必须先解包为 ``workflow.edges`` 再传(``find_downstream(node_id, workflow.edges)``),
      保持 ``dag.py`` 纯函数语义(TASK-302 §3.3 + §4.4 约束)。
    - **Do Not #11**: 每次 ``registry.create`` 返回新 executor 实例,本类不缓存。
    - **Do Not #3**: 不吞异常;执行器抛 ``FinAgentError`` → 本类 catch 后
      ``record_node_failed`` → 重新记录到 ``_failed_nodes`` → 继续拓扑循环
      (不再 re-raise,确保所有可执行节点都被尝试过)。

修订关联:
    - REVISION_NOTES_2026-06-18.md **修订 T-1** (TASK-301): WorkflowRunner Protocol 入口
    - REVISION_NOTES_2026-06-18.md **修订 T-3** (TASK-309): ``_chain_sessions`` 独占管理
    - REVISION_NOTES_2026-06-18.md **Bug C-7**: 显式 ``bind/unbind`` 配对 + token 模式
    - REVISION_NOTES_2026-06-18.md **Bug C-8**: composite key 包含 trace_id
    - v2.1 §7.6 + §11.2: trace_id 显式传 worker,ContextVar 仅 logging
"""

from __future__ import annotations

from structlog.contextvars import bind_contextvars, unbind_contextvars

from src.main.infra.domain import (
    ExecutionId,
    NodeId,
    SessionId,
    TraceId,
    WorkflowId,
)
from src.main.infra.errors import (
    FinAgentError,
    WorkflowNotFoundError,
)
from src.main.infra.settings import Settings
from src.main.infra.uow import UoWFactory
from src.main.modules.agent.protocol import AgentDispatcher
from src.main.modules.execution.protocol import ExecutionRecorder
from src.main.modules.workflow.domain.dag import (
    build_predecessors,
    find_downstream,
    topological_sort,
)
from src.main.modules.workflow.executor.registry import NodeExecutorRegistry
from src.main.modules.workflow.protocol import (
    ExecutionSummary,
    NodeContext,
    NodeResult,
    WorkflowReader,
    WorkflowRunner,
)


# ExecutionStatus 字符串 forward ref(具体枚举在 TASK-202/ExecutionStatus)。
# 本类只消费字符串值,不使用具体枚举类型(避免循环 import)。
_STATUS_FAILED = "failed"
_STATUS_COMPLETED = "completed"


class DefaultWorkflowRunner(WorkflowRunner):
    """默认工作流执行器:DAG 编排 + 状态机推进 + 失败级联。

    构造签名(``__init__``)严格按 TASK-309 §4.1 + 关键约束 #4:
        ``(reader, recorder, dispatcher, executor_registry, uow_factory, settings)``
    全部为 keyword-only 依赖,通过 DI 容器注入。

    Attributes(全部为依赖,无业务状态):
        _reader: 工作流只读查询。
        _recorder: 执行写侧(持久化节点/执行状态)。
        _dispatcher: Agent 调度器(注入到 executor)。
        _registry: 节点执行器工厂(每次 create 新实例)。
        _uow: 事务工厂(预留,当前由 recorder 内部管理事务)。
        _settings: 全局配置。

    每调用 ``run`` 一次,临时持有以下执行状态(``run`` 入口初始化,finally 不清理
    —— 单次 run 调用结束后该实例不应再被并发复用):
        _results: ``NodeId`` → ``NodeResult``,已完成节点结果快照。
        _failed_nodes: 已失败节点集合。
        _skipped_nodes: 被级联跳过的节点集合。
        _chain_sessions: ``NodeId`` → ``SessionId``,串行链 session 绑定快照。
    """

    def __init__(
        self,
        *,
        reader: WorkflowReader,
        recorder: ExecutionRecorder,
        dispatcher: AgentDispatcher,
        executor_registry: NodeExecutorRegistry,
        uow_factory: UoWFactory,
        settings: Settings,
    ) -> None:
        self._reader = reader
        self._recorder = recorder
        self._dispatcher = dispatcher
        self._registry = executor_registry
        self._uow = uow_factory
        self._settings = settings

    # ──────────────────────────────────────────────────────────────────
    # 主入口
    # ──────────────────────────────────────────────────────────────────

    async def run(
        self,
        workflow_id: WorkflowId,
        params: dict,
        *,
        execution_id: ExecutionId | None = None,
        trace_id: TraceId,
    ) -> ExecutionSummary:
        """执行工作流 DAG。

        完整流程(对应 TASK-309 §4.1):
            1. ``bind_contextvars(trace_id=...)`` —— 仅用于 logging 横切层。
            2. ``reader.get(workflow_id)`` → 缺失抛 ``WorkflowNotFoundError``。
            3. 初始化本 runner 的执行状态(``_results`` / ``_failed_nodes`` /
               ``_skipped_nodes`` / ``_chain_sessions``)。
            4. ``execution_id is None`` 时 ``recorder.create_execution(...)``。
            5. ``topological_sort(workflow.nodes, workflow.edges)`` → 拓扑序。
            6. ``build_predecessors(workflow.edges)`` → 前驱映射。
            7. 遍历拓扑序:
               a. 已在 ``_failed_nodes`` / ``_skipped_nodes`` → 跳过。
               b. ``recorder.record_node_started(execution_id, node_id, trace_id)``
                  (TASK-201 必调契约,PENDING → RUNNING)。
               c. ``registry.create(node.type, dispatcher=..., execution_recorder=..., trace_id=...)``
                  → 新 executor 实例。
               d. 构造 ``NodeContext`` 只读快照(``results`` / ``chain_sessions``
                  均为 ``dict(...)`` 拷贝,执行器无法写回)。
               e. ``await executor.execute(ctx)``:
                  - 成功: ``self._results[node_id] = result``;
                    若 ``result["session_id"]`` 存在, ``self._chain_sessions[node_id] = ...``;
                    ``recorder.record_node_completed(...)``。
                  - 抛 ``FinAgentError``: ``self._failed_nodes.add(node_id)``;
                    ``recorder.record_node_failed(...)``;
                    ``find_downstream(node_id, workflow.edges)`` → 每个下游若
                    未失败则 ``_skipped_nodes.add(dn)`` + ``recorder.record_node_skipped(...)``。
            8. ``recorder.mark_execution(execution_id, FAILED/COMPLETED, trace_id)``。
            9. 返回 ``ExecutionSummary``。
           10. ``finally`` 块 ``unbind_contextvars("trace_id")``。

        Args:
            workflow_id: 工作流 ID。
            params: 触发参数(payload);类型 ``dict`` 宽泛约束,具体业务字段
                在 ``ExecutionParams`` TypedDict 中定义。
            execution_id: 可选,显式指定 execution_id;``None`` 时由 recorder 自生成。
            trace_id: 审计/追踪 ID,keyword-only,贯穿整个执行。

        Returns:
            ``ExecutionSummary`` TypedDict,含所有节点结果 + 终态。

        Raises:
            WorkflowNotFoundError: 工作流不存在。
            ValidationError: DAG 校验失败(拓扑返回空列表 = 存在环)。
            FinAgentError: 其他结构化异常(由执行器透传)。
        """
        # ── Step 1: bind contextvars(仅 logging,worker 显式接 trace_id)──
        # Bug C-7 强约束:此处 bind 不保存 token,因为 ``run`` 入口是单次
        # 同步代码段,不需要嵌套 token 模式;finally 块无条件 unbind。
        bind_contextvars(trace_id=str(trace_id))
        try:
            # ── Step 2: 读 workflow ──
            workflow = self._reader.get(workflow_id)
            if workflow is None:
                raise WorkflowNotFoundError(
                    f"Workflow {workflow_id} not found",
                    details={"workflow_id": str(workflow_id)},
                )

            # ── Step 3: 初始化 runner 独占执行状态(Do Not #19) ──
            self._results: dict[NodeId, NodeResult] = {}
            self._failed_nodes: set[NodeId] = set()
            self._skipped_nodes: set[NodeId] = set()
            self._chain_sessions: dict[NodeId, SessionId] = {}

            # ── Step 4: 创建 execution(显式传入则跳过) ──
            if execution_id is None:
                execution_id = await self._recorder.create_execution(
                    workflow_id=workflow_id,
                    params=params,
                    trace_id=trace_id,
                )

            # ── Step 5: DAG 计算 ──
            order = topological_sort(workflow.nodes, workflow.edges)
            if not order:
                # 拓扑排序返回空 = 存在环,ValidationError(由 recorder 上层处理)
                from src.main.infra.errors import ValidationError

                raise ValidationError(
                    "Failed to compute topological order — possible cycle",
                    details={"workflow_id": str(workflow_id)},
                )

            # ── Step 6: 前驱映射 ──
            preds_map = build_predecessors(workflow.edges)

            # ── Step 7: 拓扑驱动执行 ──
            for node_id in order:
                # 7a. 已失败 / 已跳过 → 跳过本节点
                if node_id in self._failed_nodes or node_id in self._skipped_nodes:
                    continue

                # 7b. record_node_started(必调契约,PENDING → RUNNING)
                await self._recorder.record_node_started(
                    execution_id=execution_id,
                    node_id=node_id,
                    trace_id=trace_id,
                )

                # 7c. 创建 executor(每次新实例,Do Not #11)
                node_obj = next(n for n in workflow.nodes if n.id == node_id)
                executor = self._registry.create(
                    node_obj.type,
                    dispatcher=self._dispatcher,
                    execution_recorder=self._recorder,
                    trace_id=trace_id,
                )

                # 7d. 构造 NodeContext 只读快照
                # results / chain_sessions 用 dict() 浅拷贝,执行器无法写回本 runner 状态
                ctx: NodeContext = {
                    "node": node_obj,
                    "execution_id": execution_id,
                    "predecessor_ids": preds_map.get(node_id, []),
                    "params": params,
                    "results": dict(self._results),
                    "edges": workflow.edges,
                    "trace_id": trace_id,
                    "chain_sessions": dict(self._chain_sessions),
                }

                # 7e. 执行 + 记录
                try:
                    result = await executor.execute(ctx)
                except FinAgentError as e:
                    # 失败:记录 + 级联(Do Not #3:不静默吞)
                    self._failed_nodes.add(node_id)
                    await self._recorder.record_node_failed(
                        execution_id=execution_id,
                        node_id=node_id,
                        error=e,
                        trace_id=trace_id,
                    )
                    # cascade skip(走 workflow.edges 而非 workflow,纯函数契约)
                    for dn in find_downstream(node_id, workflow.edges):
                        if dn not in self._failed_nodes:
                            self._skipped_nodes.add(dn)
                            await self._recorder.record_node_skipped(
                                execution_id=execution_id,
                                node_id=dn,
                                trace_id=trace_id,
                            )
                    continue

                # 成功:写 runner 状态 + 持久化
                self._results[node_id] = result
                if result.get("session_id"):
                    self._chain_sessions[node_id] = result["session_id"]
                await self._recorder.record_node_completed(
                    execution_id=execution_id,
                    node_id=node_id,
                    output={"result": result["output"]},
                    session_id=result.get("session_id"),
                    trace_id=trace_id,
                )

            # ── Step 8: 标记 execution 终态 ──
            final_status = _STATUS_FAILED if self._failed_nodes else _STATUS_COMPLETED
            await self._recorder.mark_execution(
                execution_id=execution_id,
                status=final_status,
                trace_id=trace_id,
            )

            # ── Step 9: 返回 ExecutionSummary ──
            return {
                "execution_id": execution_id,
                "workflow_id": workflow_id,
                "status": final_status,
                "results": self._results,
                "failed_nodes": list(self._failed_nodes),
                "skipped_nodes": list(self._skipped_nodes),
            }
        finally:
            # ── Step 10: unbind contextvars ──
            unbind_contextvars("trace_id")
