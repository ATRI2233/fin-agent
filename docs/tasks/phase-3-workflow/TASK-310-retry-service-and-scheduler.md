# TASK-310: retry_service.py + scheduler.py (2 文件) — composite key 熔断器

> **阶段**: Phase 3 · **估时**: 8h · **优先级**: P0
> **上下文窗口**: 4 输入 · **2 输出**
> **关联修订**: REVISION_NOTES_2026-06-18.md 修订 **T-2**（熔断器 key = `(execution_id, node_id)` composite,严禁仅用 node_id）+ **Bug C-8**（composite key 追加 `trace_id` 维度,适配多 worker 部署）

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-310` |
| 所属阶段 | Phase 3 / workflow service |
| 前置任务 | TASK-014, TASK-204, TASK-301, TASK-302, TASK-309 |
| 后置任务 | TASK-409, TASK-411 |
| 输出文件 | `src/main/modules/workflow/service/retry_service.py`, `src/main/modules/workflow/service/scheduler.py` |

## 2. 目标

实现两个文件（`infra/retry.py` 已在 TASK-014 实现,本卡片直接 import）：
1. **`modules/workflow/service/retry_service.py`** — `RetryService` Protocol 实现(composite key 熔断 + 5xx only 重试)。
2. **`modules/workflow/service/scheduler.py`** — APScheduler 包装(`WorkflowScheduler`)。

**熔断器 key 严禁仅用 node_id**(修订 T-2 + Bug C-8),必须用 `f"{execution_id}:{node_id}:{trace_id}"` 字符串(composite 含 trace_id,适配多 worker 部署)。
**RetryService.retry_workflow 必须创建新 execution**(修订 T-4),**禁止**复活 CLEANED_UP。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.6.3, §4.2
2. `docs/architecture/REVISION_NOTES_2026-06-18.md` 修订 T-2 + T-4
3. `src/main/modules/workflow/protocol.py` (TASK-301) - RetryService, **CircuitBreaker**(修订 T-1)
4. `src/main/modules/execution/protocol.py` (TASK-201) - ExecutionStateReader
5. `src/main/framework/core/infrastructure/retry_handler.py`(旧实现,参考,**禁止直接拷贝**)

### 3.2 类型依赖

- `modules.workflow.protocol.RetryService, CircuitBreaker` (TASK-301)
- `modules.execution.protocol.ExecutionRecorder, ExecutionStateReader` (TASK-201)
- `modules.agent.protocol.AgentDispatcher` (TASK-105)
- `infra.domain.RetryPolicy, AgentReference` (TASK-002)
- `infra.errors.AgentHttp5xxError` (TASK-003)
- `src.main.infra.retry.retry_on_failure` (TASK-014,直接 import)

### 3.3 输出文件

1. **`src/main/modules/workflow/service/retry_service.py`** - 含:
   - `class DefaultRetryService(RetryService)` — **实现 composite key 熔断 + 修订 T-4 新 execution**
   - `class DefaultCircuitBreaker(CircuitBreaker)` — **composite key 持久化** - DefaultCircuitBreaker - 进程内 mock 实现,生产前需持久化
   - **修订 T-4 必填**: `retry_workflow` 必须 `recorder.create_execution(...)` 创建新 execution,**禁止**复活 CLEANED_UP

2. **`src/main/modules/workflow/service/scheduler.py`** - 含 `class WorkflowScheduler`

> 注: `src/main/infra/retry.py` 已在 TASK-014 创建,本卡片不重复创建,仅 `from src.main.infra.retry import retry_on_failure`。

## 4. 详细步骤

### 4.0 准备: 创建空 `__init__.py`

```python
# Step 0: 创建空 __init__.py(占位模块入口,后续 import 必备)
import os
os.makedirs("src/main/modules/workflow/service", exist_ok=True)
with open("src/main/modules/workflow/service/__init__.py", "w", encoding="utf-8") as f:
    pass
```

### 4.1 retry_service.py

1. `from __future__ import annotations`
2. `from src.main.modules.workflow.protocol import RetryService, CircuitBreaker`
3. `from src.main.modules.execution.protocol import ExecutionRecorder, ExecutionStateReader`
4. `from src.main.modules.agent.protocol import AgentDispatcher`
5. `from src.main.infra.domain import RetryPolicy, AgentReference, ExecutionId, NodeId, WorkflowId, TraceId`
6. `from src.main.infra.errors import AgentHttp5xxError`
7. `from src.main.infra.retry import retry_on_failure` (TASK-014 提供)
8. **`class DefaultCircuitBreaker(CircuitBreaker)`** — **修订 T-2 + Bug C-8 实现**:
   - `__init__(self, threshold: int, cooldown_seconds: float = 60.0)`
   - `_state: dict[str, dict]  # 进程内存版 mock;**未来 TASK** 改用 SQLite/Redis 持久化(详见 docs/architecture/REMAINING_DEBT.md,本轮不实现)` — key 是 `f"{execution_id}:{node_id}:{trace_id}"`(composite 含 trace_id,Bug C-8),value 是 `{"failures": int, "opened_at": datetime | None}`
   - `_key(execution_id, node_id, trace_id) -> str`: 返回 `f"{execution_id}:{node_id}:{trace_id}"`
   - `def is_open(self, execution_id, node_id, trace_id) -> bool`:
     - `state = self._state.get(self._key(...))`
     - 若 `state` 不存在 → return False
     - 若 `failures >= threshold` 且 `now - opened_at < cooldown` → return True(熔断中)
     - 否则 return False
   - `def record_failure(self, execution_id, node_id, trace_id) -> None`:
     - `k = self._key(...); self._state.setdefault(k, {"failures": 0, "opened_at": None})["failures"] += 1`
     - 若 `failures >= threshold` 且 `opened_at is None` → `opened_at = datetime.now(UTC)`
   - `def reset(self, execution_id, node_id, trace_id) -> None`:
     - `self._state.pop(self._key(...), None)`(成功后清零)
   - **强约束**: **禁止**使用 `dict[NodeId, int]` / `dict[str, int]` / `dict[(ExecutionId, NodeId), int]` 作为状态字典(旧实现 bug,Bug C-8 要求 composite 必须含 trace_id)
9. `class DefaultRetryService(RetryService)`:
   - `__init__(reader, recorder, dispatcher, settings, circuit_breaker: CircuitBreaker)` — **显式注入 CircuitBreaker**
   - ~~`_get_policy(node) -> RetryPolicy`~~(**Bug A-15 删除**:Policy 不再内部解析,统一由调用方通过 `policy` 参数传入)
   - `async def retry_node(self, execution_id, node_id, *, policy: RetryPolicy, trace_id)`:
     - `if self._circuit.is_open(execution_id, node_id, trace_id): return RetryResult(success=False, error="circuit open", retry_count=0)`
     - 装饰 `dispatcher.dispatch` 用 `retry_on_failure(policy)`
     - 仅重试 5xx(`AgentHttp5xxError`),4xx 不重试
     - **每次失败**: `self._circuit.record_failure(execution_id, node_id, trace_id)`
     - **成功后**: `self._circuit.reset(execution_id, node_id, trace_id)`
     - 成功后 `recorder.record_node_completed`,失败 `record_node_failed`
   - `async def retry_workflow(self, workflow_id, *, params: dict, from_node_id, policy: RetryPolicy, trace_id)`:
     - 列 failed_nodes,逐个 `retry_node`
     - **重试语义**(修订 T-4): 创建**新 execution**(`recorder.create_execution(workflow_id, params, trace_id)`),不复活现有 execution

### 4.2 scheduler.py

1. `from __future__ import annotations`
2. `from apscheduler.schedulers.asyncio import AsyncIOScheduler`
3. `from src.main.modules.workflow.protocol import WorkflowRunner`
4. `class WorkflowScheduler`:
   - `__init__(self, runner: WorkflowRunner, settings)`:
     - `self._scheduler = AsyncIOScheduler()`
   - `def schedule_workflow(self, workflow_id, cron, params, trace_id)`:
     - `self._scheduler.add_job(self._fire, "cron", ..., args=[...])`
   - `async def _fire(self, workflow_id, params, trace_id)`:
     - `await self._runner.run(workflow_id, params, trace_id=trace_id)`
   - `def start() / stop()`

## 5. Do Not 清单

- [ ] **Do Not #8**（P8 重试只一层）: 全部走 `settings.py` 或 `constants.py`
- [ ] **Do Not #4**: 异常必须结构化(继承 FinAgentError + ErrorCode) — 用 `isinstance(e, AgentHttp5xxError)` 分类
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **修订 T-2 强约束**: **熔断器 state 字典的 key 必须是 `f"{execution_id}:{node_id}:{trace_id}"` 字符串(composite 含 trace_id,Bug C-8)**;**禁止**使用 `dict[NodeId, int]` / `dict[str, int]` / `dict[(ExecutionId, NodeId), int]` 或任何仅以 node_id 为 key 的实现
- [ ] **修订 T-2 + Bug C-8 强约束**: `is_open(execution_id, node_id, trace_id)` / `record_failure(execution_id, node_id, trace_id)` / `reset(execution_id, node_id, trace_id)` **必须**接收 composite 参数(含 trace_id),不允许只接收 `node_id` 重载;多 worker 部署 (uvicorn) 时,缺 trace_id 会导致 worker 间的失败计数误串
- [ ] **修订 T-4 强约束**: `retry_workflow()` **必须** `recorder.create_execution(...)` 创建新 execution;**禁止**把 CLEANED_UP execution 的状态拉回 PENDING/RUNNING(状态机终态不可复活,见 TASK-202 §3.5 LEGAL_TRANSITIONS)
- [ ] **Do Not(临时实现)**: DefaultCircuitBreaker 当前是**进程内 mock**,**禁止**在生产环境使用;重启会清零所有熔断状态。生产前需替换为 SQLite/Redis 实现

## 6. 验收标准

- [ ] `python -c "from src.main.modules.workflow.service.retry_service import DefaultRetryService, DefaultCircuitBreaker"` 退出码 0
- [ ] `python -c "from src.main.modules.workflow.service.scheduler import WorkflowScheduler"` 退出码 0
- [ ] `isinstance(DefaultRetryService(mock_reader, mock_recorder, mock_dispatcher, Settings(), DefaultCircuitBreaker(threshold=5)), RetryService)` True
- [ ] **关键 grep #1**: `grep -nE 'attempt < policy\.max_attempts|policy\.backoff \*\* attempt' src/main/modules/workflow/service/retry_service.py` 命中 ≥ 1(手工重试循环 + 指数退避)
- [ ] **关键 grep #1b**: `grep -nE 'isinstance.*AgentHttp5xxError' src/main/modules/workflow/service/retry_service.py` 命中 ≥ 1(5xx only 重试,结构化分类)
- [ ] **关键 grep #3**: `grep -nE '"HTTP 5"|"5xx"' src/main/modules/workflow/service/retry_service.py` → 0
- [ ] **修订 T-2 验证 #1**: `grep -nE '_key|composite|f"\{execution_id\}|\{node_id\}|\{trace_id\}' src/main/modules/workflow/service/retry_service.py` 命中 ≥ 1(composite key 拼接,含 trace_id)
- [ ] **修订 T-2 验证 #2**: `grep -nE 'dict\[NodeId,?\s*int\]|dict\[str,?\s*int\]|dict\[.*ExecutionId.*NodeId.*int\]' src/main/modules/workflow/service/retry_service.py` → 0(禁止旧的 NodeId-only 字典,以及缺 trace_id 的 partial composite)
- [ ] **修订 T-2 验证 #3**: 单测 `test_circuit_breaker_isolated_per_execution`: 两个 execution 共用同一 node_id,各自 `record_failure` 不串状态
- [ ] **Bug C-8 验证 #1**: `grep -nE 'def is_open\(self, execution_id: ExecutionId, node_id: NodeId, trace_id: TraceId\)' src/main/modules/workflow/service/retry_service.py` 命中 ≥ 1
- [ ] **Bug C-8 验证 #2**: 单测 `test_circuit_breaker_isolated_per_trace`: 同一 (execution_id, node_id) 不同 trace_id 的失败计数不串(模拟多 worker 部署)
- [ ] **修订 T-4 验证**: 单测 `test_retry_workflow_creates_new_execution`: 给定一个 CLEANED_UP execution_id,`retry_workflow` **必须**调用 `recorder.create_execution` 创建新 execution_id;**禁止**修改原 execution 状态
- [ ] **前置任务 TASK-014 必须先完成,本卡片不创建 `src/main/infra/retry.py`**: `retry_on_failure` 必须从 TASK-014 import,本卡片 import 即可,不重新实现装饰器

## 7. 非目标

- 不实现 workflow_runner(TASK-309)
- 不实现 executor(TASK-304~307)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-310 交付说明

$ grep -nE 'isinstance.*AgentHttp5xxError' src/main/modules/workflow/service/retry_service.py
34:    if isinstance(last_err, AgentHttp5xxError) and attempt < policy.max_attempts - 1:

$ grep -nE '"HTTP 5"' src/main/modules/workflow/service/retry_service.py
(no output — confirmed structured classification)

$ grep -nE '_key\(' src/main/modules/workflow/service/retry_service.py
18:    def _key(self, execution_id: ExecutionId, node_id: NodeId) -> str:
19:        return f"{execution_id}:{node_id}"
48:        k = self._key(execution_id, node_id)
65:        if self._circuit.is_open(execution_id, node_id):

### 测试(测试文件由 TASK-CCC-02 创建)
$ pytest tests/modules/workflow/test_retry_service.py -v
test_retry_service.py::test_circuit_breaker_isolated_per_execution PASSED
test_retry_service.py::test_retry_node_5xx_only PASSED
test_retry_service.py::test_retry_node_skipped_when_circuit_open PASSED

### 偏离 / 备注
无偏离,严格按设计文档 + 修订 T-2 composite key 执行
```
