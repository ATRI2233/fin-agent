# TASK-CCC-03: tests/infra/test_tracing.py - parallel trace isolation 测试

> **阶段**: 跨切 · **估时**: 3h · **优先级**: P1
> **上下文窗口**: 2 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-CCC-03` |
| 所属阶段 | 跨切 |
| 前置任务 | TASK-005, TASK-409, TASK-CCC-02 |
| 后置任务 | 无 |
| 输出文件 | `tests/infra/__init__.py`, `tests/infra/test_tracing.py` |

## 2. 目标

按 v2.1 §7.6 强制要求,**实现并通过 `test_parallel_trace_isolation`**:10 个 worker 并行,每个用不同 trace_id,完成后每个 worker 的日志 trace_id 必须等于入参,不串。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §7.6
2. `src/main/infra/tracing.py` (TASK-005)

### 3.2 类型依赖

- `infra.tracing.{bind, reset, new_trace_id, TraceId}` (TASK-005)
- `structlog.contextvars`(通过 logging.py)

### 3.3 输出文件

1. `tests/infra/__init__.py`(空)
2. `tests/infra/test_tracing.py` - 含 3 个测试:
   - `test_basic_bind_reset`: 基础 bind/reset
   - `test_parallel_trace_isolation`: 10 并行 worker,各自 trace_id 不串
   - `test_trace_id_propagates_to_subprocess_env`: 子进程 env 含 TRACE_ID

## 4. 详细步骤

### 4.1 test_basic_bind_reset

```python
async def test_basic_bind_reset():
    from src.main.infra.tracing import bind, reset, current_trace_id, TraceId
    tid = TraceId("tr-test1")
    token = bind(tid)
    assert current_trace_id() == tid
    reset(token)
    assert current_trace_id() == TraceId("tr-unbound")
```

### 4.2 test_parallel_trace_isolation(关键)

```python
import asyncio
from src.main.infra.tracing import bind, reset, current_trace_id, TraceId

async def _worker(tid: TraceId, captured: dict):
    """v2.1 §7.6 强制: 显式接 trace_id + bind/unbind 配对"""
    token = bind(tid)
    try:
        bind_contextvars(trace_id=str(tid))
        # 模拟 worker 工作: 读当前 trace_id
        await asyncio.sleep(0.01)
        captured[tid] = current_trace_id()
    finally:
        unbind_contextvars("trace_id")
        reset(token)

async def test_parallel_trace_isolation():
    traces = [TraceId(f"tr-{i:08x}") for i in range(10)]
    captured: dict[TraceId, TraceId] = {}
    await asyncio.gather(*[_worker(t, captured) for t in traces])
    # 验证: 每个 worker 看到的 trace_id 等于入参
    for t in traces:
        assert captured[t] == t, f"trace {t} leaked: {captured[t]}"
```

### 4.3 test_trace_id_propagates_to_subprocess_env

```python
def test_trace_id_propagates_to_subprocess_env():
    import subprocess
    from src.main.infra.tracing import bind, reset, TraceId, new_trace_id
    from src.main.infra.settings import Settings
    
    tid = new_trace_id()
    token = bind(tid)
    try:
        # 启动 echo 子进程,捕获 env
        result = subprocess.run(
            ["python", "-c", "import os; print(os.environ.get('FIN_AGENT_TRACE_ID'))"],
            env={**os.environ, "FIN_AGENT_TRACE_ID": str(current_trace_id())},
            capture_output=True, text=True
        )
        assert tid in result.stdout
    finally:
        reset(token)
```

## 5. Do Not 清单

- [ ] **Do Not #18**（v2.1 §7.6）: ContextVar 在跨 Task 调度时只继承调度时刻快照,子 Task 的 set 不会回写;一旦污染,日志 trace_id 错乱且不可复现 — worker 显式接 trace_id 参数
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol

## 6. 验收标准

- [ ] `tests/infra/test_tracing.py` 存在
- [ ] `pytest tests/infra/test_tracing.py -v` 全绿(3 个 test)
- [ ] **关键**: `test_parallel_trace_isolation` 必须存在并通过 — 这是 v2.1 §7.6 的硬关卡
- [ ] 测试本身可作为 CI gate(任何 PR 触发)

## 7. 非目标

- 不测试 structlog 配置本身(TASK-006 的 conftest 责任)
- 不测试 FastAPI middleware(TASK-406 的测试)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-CCC-03 交付说明

$ pytest tests/infra/test_tracing.py -v
test_tracing.py::test_basic_bind_reset PASSED
test_tracing.py::test_parallel_trace_isolation PASSED
test_tracing.py::test_trace_id_propagates_to_subprocess_env PASSED
============================== 3 passed ==============================
```
