# TASK-301: modules/workflow/protocol.py - 所有 Workflow Protocol（含 CircuitBreaker）

> **阶段**: Phase 3 · **估时**: 3h · **优先级**: P0（Protocol 优先）
> **上下文窗口**: 2 输入 · 1 输出
> **关联修订**: REVISION_NOTES_2026-06-18.md 修订 **T-1**（CircuitBreaker 移入 workflow）+ 修订 **T-2**（熔断器 key = `(execution_id, node_id)` composite）+ **Bug C-8**（composite key 追加 `trace_id` 维度,适配多 worker 部署）

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-301` |
| 所属阶段 | Phase 3 / workflow |
| 前置任务 | TASK-002, TASK-105, TASK-201 |
| 后置任务 | TASK-302, TASK-303, TASK-304, TASK-309, TASK-310 |
| 输出文件 | `src/main/modules/workflow/protocol.py` |

## 2. 目标

定义 workflow 模块对外 Protocol: `WorkflowRunner`, `WorkflowReader`, `NodeExecutor`, `NodeExecutorFactory`, `RetryService`, **`CircuitBreaker`**（修订 T-1 移入）,以及 `NodeContext`/`NodeResult` 数据类型。`RetryService` Protocol docstring 必须明示 composite key（修订 T-2）。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.6.3
2. `docs/architecture/REVISION_NOTES_2026-06-18.md` 修订 T-1 + T-2
3. `src/main/modules/agent/protocol.py` (TASK-105), `src/main/modules/execution/protocol.py` (TASK-201)

### 3.2 类型依赖

- `infra.domain.TraceId, WorkflowId, ExecutionId, NodeId, SessionId, AgentReference` (TASK-002)
- `modules.agent.protocol.AgentDispatcher` (TASK-105)
- `modules.execution.protocol.ExecutionRecorder, ExecutionStateReader` (TASK-201)

### 3.3 输出文件

1. `src/main/modules/workflow/protocol.py` - 含:
   - `NodeContext` TypedDict (按 v2.1 §3.6.3,**必须含 `chain_sessions`**)
   - `NodeResult` TypedDict
   - `ExecutionSummary` TypedDict
   - `RetryResult` TypedDict
   - `class NodeExecutor(Protocol)`: 单方法 `execute(ctx)`
   - `class NodeExecutorFactory(Protocol)`: `create(node_type, *, dispatcher, execution_recorder, trace_id) -> NodeExecutor`
   - `class WorkflowRunner(Protocol)`: `run(workflow_id, params: dict[str, Any], *, execution_id=None, trace_id) -> ExecutionSummary`
     - **类型化说明**: `params` 类型为 `dict[str, Any]`,业务字段在 `ExecutionParams` TypedDict(TASK-002 `infra.domain` 导出)中定义,Protocol 层只用宽泛的 `dict[str, Any]`,具体字段由调用方契约保证。
   - `class WorkflowReader(Protocol)`: `get`, `list`
   - `class RetryService(Protocol)`（修订 T-2 docstring）: `retry_node`, `retry_workflow`
   - **`class CircuitBreaker(Protocol)`**（修订 T-1 从 execution 模块移入）: 3 个方法

## 4. 详细步骤

### 4.0 准备: 创建空 `__init__.py`

```python
# Step 0: 创建空 __init__.py(占位模块入口,后续 import 必备)
import os
os.makedirs("src/main/modules/workflow", exist_ok=True)
with open("src/main/modules/workflow/__init__.py", "w", encoding="utf-8") as f:
    pass
```

1. `from __future__ import annotations`
2. `from typing import Protocol, TypedDict, Any, runtime_checkable`
3. `from src.main.infra.domain import TraceId, WorkflowId, ExecutionId, NodeId, SessionId, RetryPolicy`
4. `NodeContext` TypedDict 字段**严格**按 v2.1 §3.6.3:
   ```python
   class NodeContext(TypedDict):
       node: Node
       execution_id: ExecutionId
       predecessor_ids: list[NodeId]
       params: dict[str, Any]
       results: dict[NodeId, "NodeResult"]      # 只读快照
       edges: list[Edge]
       trace_id: TraceId
       chain_sessions: Mapping[NodeId, SessionId]  # 只读快照
   ```
5. `NodeResult` TypedDict: `output: Any`, `session_id: SessionId | None`, `extra_data: dict[str, Any]`
6. `ExecutionSummary` TypedDict: `execution_id, workflow_id, status, results, failed_nodes, skipped_nodes`
7. `RetryResult` TypedDict: `success: bool`, `result: Any | None`, `error: str | None`, `retry_count: int`
8. `class NodeExecutor(Protocol)`:
   ```python
   class NodeExecutor(Protocol):
       """无状态。每次调用都是新实例。"""
       async def execute(self, ctx: NodeContext) -> NodeResult: ...
   ```
9. `NodeExecutorFactory.create(node_type, *, dispatcher: AgentDispatcher, execution_recorder: ExecutionRecorder, trace_id: TraceId) -> NodeExecutor`
10. `WorkflowRunner.run(workflow_id, params: dict[str, Any], *, execution_id=None, trace_id) -> ExecutionSummary`
    - **类型化说明**: `params` 使用 `dict[str, Any]`(Protocol 层用宽泛类型,具体字段在 `ExecutionParams` TypedDict 中定义 — TASK-002 `infra.domain` 导出);`NodeContext.params` 同上
11. `WorkflowReader.get`, `list`
12. `RetryService`（**修订 T-2** docstring 必填,**Bug A-15** RetryPolicy 显式入参）:
    ```python
    class RetryService(Protocol):
        """DAG-aware retry + circuit breaker.

        Circuit breaker key MUST be ``(execution_id, node_id)`` — the same
        node_id appears in different executions and must NOT share state.
        Implementations persist counts keyed on this composite string.

        Both retry methods take an explicit ``policy: RetryPolicy`` so the
        public contract matches the implementation (no hidden
        ``_get_policy(node)`` parsing inside implementations).
        """

        async def retry_node(self, execution_id: ExecutionId,
                             node_id: NodeId, *,
                             policy: RetryPolicy,
                             trace_id: TraceId) -> RetryResult: ...
        async def retry_workflow(self, workflow_id: WorkflowId,
                                 *, params: dict[str, Any],
                                 from_node_id: NodeId | None,
                                 policy: RetryPolicy,
                                 trace_id: TraceId) -> RetryResult: ...
        # `params` 字段类型: `dict[str, Any]`,具体业务字段在 `ExecutionParams`
        # TypedDict(TASK-002 `infra.domain`)中定义,Protocol 层仅用宽泛类型约束。
    ```
13. **`CircuitBreaker`**（**修订 T-1 移入 + Bug C-8 trace_id 维度** ,追加在 RetryService 之后）:
    ```python
    class CircuitBreaker(Protocol):
        """Per-execution node failure threshold + cooldown state.

        Implementations live in modules/workflow/service/retry_service.py.
        The execution module does NOT import this Protocol — it only
        persists node-level failure counts; circuit decisions belong to
        workflow orchestration.

        Bug C-8 变更: composite key 追加 ``trace_id`` 维度。
        多 worker 部署 (uvicorn) 时,同一 (execution_id, node_id) 的失败计数
        可能来自不同 worker 的不同 trace;内存版熔断器必须以
        ``(execution_id, node_id, trace_id)`` 区分,避免 worker 间的失败计数
        误串导致熔断误判。persistence 版(若未来)仍以 composite 存。
        """

        def is_open(self, execution_id: ExecutionId, node_id: NodeId,
                    trace_id: TraceId) -> bool: ...
        def record_failure(self, execution_id: ExecutionId, node_id: NodeId,
                           trace_id: TraceId) -> None: ...
        def reset(self, execution_id: ExecutionId, node_id: NodeId,
                  trace_id: TraceId) -> None: ...
    ```

## 5. Do Not 清单

- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not #2**: 接口没对齐时用反射修补 = 隐藏 bug;改 Protocol
- [ ] **Do Not #19**（v2.1 新增）: 执行器必须无状态;所有跨调用持久化状态由 WorkflowRunner 独占,通过 `NodeContext` 只读快照传入。并行执行时任何共享实例字段 = 数据串读 — 这是后续 TASK-306/309/310 实现执行器无状态的关键
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **修订 T-1 强约束**: `CircuitBreaker` Protocol **必须**出现在本文件末尾;**禁止**出现在 `modules/execution/protocol.py`
- [ ] **Do Not(类型一致性)**: 所有 `params` 参数(Protocol 方法签名 + TypedDict 字段)**必须**有类型注解 — 至少 `dict[str, Any]`,业务侧优先用 `ExecutionParams` TypedDict(TASK-002 `infra.domain`);**禁止**完全无注解的 `params: dict`(避免跨模块传递时类型裸奔,IDE 无法提示)
- [ ] **修订 T-2 强约束**: `RetryService` docstring **必须**包含"MUST be `(execution_id, node_id, trace_id)`"字样;**禁止**实现类（DefaultRetryService in TASK-310）使用 `dict[node_id, int]` 或 `dict[(execution_id, node_id), int]` 作为熔断器 key(Bug C-8 要求 trace_id 加入 composite)
- [ ] **Bug C-8 强约束**: `CircuitBreaker.is_open / record_failure / reset` **必须**接收 `trace_id: TraceId` 参数,composite key = `(execution_id, node_id, trace_id)`;**禁止**任何实现类缺少 trace_id 参数(多 worker 部署场景下会导致熔断误判)

## 6. 验收标准

- [ ] `python -c "from src.main.modules.workflow.protocol import WorkflowRunner, WorkflowReader, NodeExecutor, NodeExecutorFactory, RetryService, CircuitBreaker, NodeContext, NodeResult"` 退出码 0
- [ ] 所有 Protocol 都标 `@runtime_checkable`
- [ ] `NodeContext` 含 `chain_sessions` 字段
- [ ] **关键 grep #1**: `grep -nE 'chain_sessions' src/main/modules/workflow/protocol.py` 命中
- [ ] **修订 T-1 验证 #1**: `grep -nE 'class CircuitBreaker' src/main/modules/workflow/protocol.py` 命中 ≥ 1
- [ ] **修订 T-1 验证 #2**: `grep -nE 'class CircuitBreaker' src/main/modules/execution/protocol.py` → 0(确保 execution 模块没有)
- [ ] **修订 T-2 验证**: `grep -nE 'execution_id.*node_id|composite' src/main/modules/workflow/protocol.py` 命中 ≥ 1(RetryService docstring 内)
- [ ] **Bug C-8 验证 #1**: `grep -nE 'def is_open\(self, execution_id: ExecutionId, node_id: NodeId, trace_id: TraceId\)' src/main/modules/workflow/protocol.py` 命中 ≥ 1(CircuitBreaker 三方法均含 trace_id)
- [ ] **Bug C-8 验证 #2**: `grep -nE 'execution_id.*node_id.*trace_id|f"\{execution_id\}:\{node_id\}:\{trace_id\}"' src/main/modules/workflow/protocol.py` 命中 ≥ 1(composite key 含 trace_id)

## 7. 非目标

- 不实现具体类
- 不定义 NodeType 枚举（在 domain，TASK-302）

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-301 交付说明

$ grep -nE 'chain_sessions' src/main/modules/workflow/protocol.py
12:    chain_sessions: Mapping[NodeId, SessionId]   # 只读快照；写权在 WorkflowRunner

$ grep -nE 'class CircuitBreaker' src/main/modules/workflow/protocol.py
95:class CircuitBreaker(Protocol):

$ grep -nE 'class CircuitBreaker' src/main/modules/execution/protocol.py
(no output — confirmed T-1 relocation)

$ grep -nE 'composite|MUST be' src/main/modules/workflow/protocol.py
60:    Circuit breaker key MUST be ``(execution_id, node_id)`` — the same
61:    node_id appears in different executions and must NOT share state.

$ python -c "
from src.main.modules.workflow.protocol import WorkflowRunner, NodeExecutor, RetryService, CircuitBreaker
for p in (WorkflowRunner, NodeExecutor, RetryService, CircuitBreaker):
    print(p.__name__, hasattr(p, '_is_runtime_protocol'))
"

### 偏离 / 备注
无偏离,严格按设计文档 + 修订 T-1/T-2 执行
```
