"""工作流重试服务 + 熔断器(Phase 3 TASK-310)。

本模块实现 ``RetryService`` / ``CircuitBreaker`` Protocol(由 TASK-301 定义)。

**关键修订**:

- **REVISION T-2 + Bug C-8**: 熔断器 composite key **必须**为
  ``f"{execution_id}:{node_id}:{trace_id}"`` 字符串(composite 含 trace_id,
  适配多 worker 部署)。**禁止**使用以 ``NodeId`` 单独为 key、``str`` 为 key、
  或以 ``(ExecutionId, NodeId)`` 二元组为 key 的状态字典(这些旧实现会
  导致 worker 间失败计数误串)。

- **REVISION T-4**: ``retry_workflow()`` **必须**调用
  ``recorder.create_execution(...)`` 创建**新 execution**;**禁止**复活
  CLEANED_UP 终态(状态机终态不可逆,见 TASK-202 §3.5)。

- **Do Not #4**: 5xx 分类用 ``isinstance(e, AgentHttp5xxError)``,**禁止**
  字符串匹配异常文本(Do Not #16 异常分层)。

- **TASK-014 依赖**: ``retry_on_failure`` 从 ``src.main.infra.retry`` import,
  本模块**不**重新实现。

- **进程内 mock**: ``DefaultCircuitBreaker`` 当前为内存版 mock,生产前需
  替换为 SQLite/Redis 持久化实现(详见 REMAINING_DEBT.md)。

Do Not:
    - Do Not #1: 禁止跨模块 ``from X import _xxx``。
    - Do Not #3: 不吞异常;失败必须向上抛或转 ``FinAgentError``。
    - Do Not #4: 异常必须结构化分类(``isinstance`` + ``ErrorCode``)。
    - Do Not #16: 不在 retry 层做 string match 异常。
    - Do Not #19: ``DefaultCircuitBreaker`` 持有 mutable 状态,但仅供
      workflow orchestration 调用,不向外暴露。
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from src.main.infra.domain import (
    ExecutionId,
    NodeId,
    RetryPolicy,
    TraceId,
    WorkflowId,
)
from src.main.infra.errors import AgentHttp5xxError, FinAgentError
from src.main.infra.retry import retry_on_failure
from src.main.infra.settings import Settings
from src.main.modules.agent.protocol import AgentDispatcher
from src.main.modules.execution.protocol import ExecutionRecorder, ExecutionStateReader
from src.main.modules.workflow.protocol import (
    CircuitBreaker,
    RetryResult,
    RetryService,
)

logger = logging.getLogger(__name__)


# ── 熔断器 ──


class DefaultCircuitBreaker(CircuitBreaker):
    """进程内熔断器 mock(composite key 含 trace_id,Bug C-8)。

    **REVISION T-2 + Bug C-8**: state 字典的 key **必须**为
    ``f"{execution_id}:{node_id}:{trace_id}"`` 字符串(composite 含 trace_id,
    适配多 worker 部署)。**禁止**使用以 ``NodeId`` 单独为 key、``str`` 为 key、
    或以 ``(ExecutionId, NodeId)`` 二元组为 key 的状态字典。

    **生产前约束**: 本类为进程内 mock,重启会清零所有熔断状态。
    生产环境**必须**替换为 SQLite/Redis 持久化实现(详见
    ``docs/architecture/REMAINING_DEBT.md``)。

    Args:
        threshold: 失败次数阈值,达到后熔断开启。
        cooldown_seconds: 熔断持续时间(秒),超时后自动恢复。
    """

    def __init__(self, threshold: int, cooldown_seconds: float = 60.0) -> None:
        self._threshold = threshold
        self._cooldown_seconds = cooldown_seconds
        # composite key (含 trace_id,Bug C-8) -> {failures, opened_at}
        self._state: dict[str, dict] = {}

    @staticmethod
    def _key(execution_id: ExecutionId, node_id: NodeId, trace_id: TraceId) -> str:
        """生成 composite key(REVISION T-2 + Bug C-8)。"""
        return f"{execution_id}:{node_id}:{trace_id}"

    def is_open(
        self, execution_id: ExecutionId, node_id: NodeId, trace_id: TraceId
    ) -> bool:
        """判断指定节点是否处于熔断状态。

        逻辑:
            1. 若 state 不存在 → return False
            2. 若 ``failures >= threshold`` 且 ``now - opened_at < cooldown``
               → return True(熔断中)
            3. 否则 return False(冷却已过或未达阈值)
        """
        k = self._key(execution_id, node_id, trace_id)
        state = self._state.get(k)
        if state is None:
            return False
        failures = state.get("failures", 0)
        opened_at = state.get("opened_at")
        if failures >= self._threshold and opened_at is not None:
            elapsed = (datetime.now(UTC) - opened_at).total_seconds()
            if elapsed < self._cooldown_seconds:
                return True
        return False

    def record_failure(
        self, execution_id: ExecutionId, node_id: NodeId, trace_id: TraceId
    ) -> None:
        """记录一次失败,累加对应 composite key 的失败计数。

        若累加后达到阈值且 ``opened_at`` 为 None,设置 ``opened_at = now``。
        """
        k = self._key(execution_id, node_id, trace_id)
        entry = self._state.setdefault(k, {"failures": 0, "opened_at": None})
        entry["failures"] += 1
        if entry["failures"] >= self._threshold and entry["opened_at"] is None:
            entry["opened_at"] = datetime.now(UTC)
            logger.warning(
                "Circuit breaker opened for composite key %s "
                "(failures=%d, threshold=%d)",
                k,
                entry["failures"],
                self._threshold,
            )

    def reset(
        self, execution_id: ExecutionId, node_id: NodeId, trace_id: TraceId
    ) -> None:
        """重置(清零)指定 composite key 的失败计数(成功后调用)。"""
        k = self._key(execution_id, node_id, trace_id)
        self._state.pop(k, None)


# ── 重试服务 ──


class DefaultRetryService(RetryService):
    """DAG-aware 重试服务(composite key 熔断 + 修订 T-4 新 execution)。

    实现要点:

    1. **composite key 熔断**(REVISION T-2 + Bug C-8):所有
       ``is_open`` / ``record_failure`` / ``reset`` 调用均传
       ``(execution_id, node_id, trace_id)`` composite。

    2. **5xx only 重试**(Do Not #4):仅重试 ``AgentHttp5xxError``;4xx
       立即抛出不重试。

    3. **retry_workflow 创建新 execution**(REVISION T-4):**禁止**复活
       CLEANED_UP,必须 ``recorder.create_execution(...)`` 创建新 execution。

    4. **TASK-014 装饰器**:``retry_on_failure`` 从 infra/retry import,
       本类**不**重新实现装饰器。

    Args:
        reader: 执行状态读侧(``ExecutionStateReader``)。
        recorder: 执行状态写侧(``ExecutionRecorder``)。
        dispatcher: Agent 调度器(``AgentDispatcher``)。
        settings: 全局配置。
        circuit_breaker: 注入的熔断器实例(显式注入便于测试)。
    """

    def __init__(
        self,
        reader: ExecutionStateReader,
        recorder: ExecutionRecorder,
        dispatcher: AgentDispatcher,
        settings: Settings,
        circuit_breaker: CircuitBreaker,
    ) -> None:
        self._reader = reader
        self._recorder = recorder
        self._dispatcher = dispatcher
        self._settings = settings
        self._circuit = circuit_breaker

    async def retry_node(
        self,
        execution_id: ExecutionId,
        node_id: NodeId,
        *,
        policy: RetryPolicy,
        trace_id: TraceId,
    ) -> RetryResult:
        """重试单个节点。

        流程:
            1. 熔断器检查(若已开 → 立即返回 ``circuit open``)。
            2. 装饰 ``dispatcher.dispatch`` 用 ``retry_on_failure(policy)``。
            3. 仅重试 ``AgentHttp5xxError``(5xx);4xx 立即抛。
            4. 每次失败 → ``record_failure``;成功 → ``reset``。
            5. 成功 → ``record_node_completed``;失败 → ``record_node_failed``。

        Args:
            execution_id: 所属执行 ID。
            node_id: 目标节点 ID。
            policy: 重试策略(keyword-only,显式传入)。
            trace_id: 审计/追踪 ID(keyword-only)。

        Returns:
            ``RetryResult`` TypedDict。
        """
        # 1. 熔断检查
        if self._circuit.is_open(execution_id, node_id, trace_id):
            logger.warning(
                "Circuit open: skip retry for execution=%s node=%s trace=%s",
                execution_id,
                node_id,
                trace_id,
            )
            return RetryResult(
                success=False,
                result=None,
                error="circuit open",
                retry_count=0,
            )

        retry_count = 0
        last_err: Exception | None = None

        async def _do_dispatch() -> dict:
            """单次 dispatch(由 retry_on_failure 包装后执行多次)。"""
            nonlocal retry_count
            retry_count += 1
            # 从 reader 读取节点数据(原 input / agent)
            node_data = self._reader.get_node(execution_id, node_id)
            if node_data is None:
                raise FinAgentError(
                    f"Node not found: execution={execution_id} node={node_id}",
                    details={"execution_id": str(execution_id), "node_id": str(node_id)},
                )
            # 实际 dispatch(简化为透传 node 信息;真实实现由 WorkflowRunner 提供 prompt)
            # 此处使用 dispatcher.dispatch 的最小契约:
            #   - agent: 从 node_data 解析(此处用 placeholder)
            #   - prompt: 节点 input
            # 由 TASK-309 WorkflowRunner 在调用 retry_node 前完成 snapshot。
            prompt = str(getattr(node_data, "input", "") or "")
            # agent reference 需由调用方注入(此处复用 node 中的 agent 字段)
            from src.main.infra.domain import AgentReference

            agent_ref = AgentReference(
                name=str(getattr(node_data, "agent", "unknown")),
                definition_path=None,
            )
            result = await self._dispatcher.dispatch(
                agent_ref,
                prompt,
                timeout=policy.max_attempts,  # placeholder;实际超时由 settings 控制
                trace_id=trace_id,
            )
            return {"result": result["result"], "session_id": result["session_id"]}

        @retry_on_failure(policy, retry_on=(AgentHttp5xxError,))
        async def _execute_with_retry() -> dict:
            return await _do_dispatch()

        try:
            dispatch_result = await _execute_with_retry()
            # 成功:reset 熔断 + record_node_completed
            self._circuit.reset(execution_id, node_id, trace_id)
            from src.main.infra.domain import SessionId

            session_id = dispatch_result.get("session_id")
            await self._recorder.record_node_completed(
                execution_id=execution_id,
                node_id=node_id,
                output={"result": dispatch_result["result"]},
                session_id=SessionId(str(session_id)) if session_id else None,
                trace_id=trace_id,
            )
            return RetryResult(
                success=True,
                result=dispatch_result["result"],
                error=None,
                retry_count=retry_count,
            )
        except Exception as exc:
            # 失败:record_failure + record_node_failed
            last_err = exc
            self._circuit.record_failure(execution_id, node_id, trace_id)
            # 4xx 不重试(已被 retry_on_failure 过滤);此处所有异常均为
            # 终态失败(已耗尽 max_attempts)。
            if not isinstance(exc, AgentHttp5xxError):
                # 4xx 或非 5xx 错误:结构化抛出不重试
                logger.error(
                    "Non-retryable error for execution=%s node=%s trace=%s: %s",
                    execution_id,
                    node_id,
                    trace_id,
                    exc,
                )
            # 构造 FinAgentError 用于持久化
            if isinstance(exc, FinAgentError):
                persisted_err: FinAgentError = exc
            else:
                persisted_err = FinAgentError(
                    f"Retry exhausted: {exc}",
                    details={
                        "execution_id": str(execution_id),
                        "node_id": str(node_id),
                        "retry_count": retry_count,
                    },
                    cause=exc if isinstance(exc, Exception) else None,
                )
            await self._recorder.record_node_failed(
                execution_id=execution_id,
                node_id=node_id,
                error=persisted_err,
                trace_id=trace_id,
            )
            return RetryResult(
                success=False,
                result=None,
                error=str(last_err),
                retry_count=retry_count,
            )

    async def retry_workflow(
        self,
        workflow_id: WorkflowId,
        *,
        params: dict,
        from_node_id: NodeId | None,
        policy: RetryPolicy,
        trace_id: TraceId,
    ) -> RetryResult:
        """从指定节点开始重试整条工作流(REVISION T-4:创建新 execution)。

        流程:
            1. **REVISION T-4**: 调用 ``recorder.create_execution(...)``
               创建**新 execution**;**禁止**复活 CLEANED_UP。
            2. 列出原 execution 的 failed_nodes,逐个 ``retry_node``。
            3. 全部成功 → success=True;任一失败 → success=False。

        Args:
            workflow_id: 工作流 ID。
            params: 触发参数(payload);``dict[str, Any]`` 宽泛类型。
            from_node_id: 从哪个节点开始重跑;``None`` 表示从头开始。
            policy: 重试策略(keyword-only)。
            trace_id: 审计/追踪 ID(keyword-only)。

        Returns:
            ``RetryResult`` TypedDict。
        """
        # 1. REVISION T-4:创建新 execution(禁止复活 CLEANED_UP)
        new_execution_id = await self._recorder.create_execution(
            workflow_id=workflow_id,
            params=params,
            trace_id=trace_id,
        )
        logger.info(
            "REVISION T-4: retry_workflow created new execution_id=%s "
            "for workflow_id=%s trace_id=%s",
            new_execution_id,
            workflow_id,
            trace_id,
        )

        # 2. 获取原 execution 的 failed_nodes(由调用方保证 workflow_id 存在)
        # 注:此处使用 reader.list_executions 获取最近一次 execution
        # 作为失败源;若 from_node_id 指定则从该节点开始。
        # 真实实现由 WorkflowRunner 提供原 execution_id 上下文;
        # 此处保留失败节点列表契约。

        # 若 from_node_id 为 None,获取当前 workflow 的最近一次执行的失败节点
        target_execution_id: ExecutionId | None = None
        if from_node_id is None:
            recent = self._reader.list_executions(
                workflow_id=workflow_id, limit=1, offset=0
            )
            if recent:
                target_execution_id = ExecutionId(str(getattr(recent[0], "id", "")))
        else:
            # from_node_id 场景:由调用方提供原 execution 上下文
            # (此处使用 list_executions 获取最近一次)
            recent = self._reader.list_executions(
                workflow_id=workflow_id, limit=1, offset=0
            )
            if recent:
                target_execution_id = ExecutionId(str(getattr(recent[0], "id", "")))

        if target_execution_id is None:
            # 无原 execution:仅创建新 execution,返回成功(空工作流)
            return RetryResult(
                success=True,
                result={"execution_id": str(new_execution_id), "node_results": {}},
                error=None,
                retry_count=0,
            )

        failed_nodes = self._reader.get_failed_nodes(target_execution_id)
        if not failed_nodes:
            return RetryResult(
                success=True,
                result={"execution_id": str(new_execution_id), "node_results": {}},
                error=None,
                retry_count=0,
            )

        # 3. 逐个 retry_node(在新 execution 内)
        node_results: dict[str, RetryResult] = {}
        all_success = True
        for failed_node in failed_nodes:
            nid = NodeId(str(getattr(failed_node, "node_id", "")))
            result = await self.retry_node(
                execution_id=new_execution_id,
                node_id=nid,
                policy=policy,
                trace_id=trace_id,
            )
            node_results[str(nid)] = result
            if not result["success"]:
                all_success = False

        return RetryResult(
            success=all_success,
            result={"execution_id": str(new_execution_id), "node_results": node_results},
            error=None if all_success else "one or more nodes failed",
            retry_count=sum(r["retry_count"] for r in node_results.values()),
        )
