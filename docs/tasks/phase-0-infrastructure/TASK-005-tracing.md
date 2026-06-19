# TASK-005: infra/tracing.py - trace_id 上下文传播

> **阶段**: Phase 0 · **估时**: 4h · **优先级**: P0
> **上下文窗口**: 1 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-005` |
| 所属阶段 | Phase 0 / infra |
| 前置任务 | TASK-002, TASK-003 |
| 后置任务 | TASK-006, 406, TASK-CCC-03 |
| 输出文件 | `src/main/infra/tracing.py` |

## 2. 目标

实现 trace_id 的生成、跨函数 / 跨 Task 传播,以及完整性校验。这是 v2.1 修订中§7.6 的核心实现。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §7.1, §7.2, §7.5, §7.6

### 3.2 类型依赖

- `infra.domain.TraceId` (TASK-002)
- `infra.errors.TraceLostError` (TASK-003)

### 3.3 输出文件

1. `src/main/infra/tracing.py` - 含:
   - 模块级 `_trace_id_var: ContextVar[TraceId]`,默认 `TraceId("tr-unbound")`
   - `new_trace_id() -> TraceId`: 生成 `tr-{uuid4().hex[:16]}`
   - `current_trace_id() -> TraceId`: 返回 var 当前值
   - `bind(tid: TraceId) -> Token`: `_trace_id_var.set(tid)`
   - `reset(token: Token) -> None`: `_trace_id_var.reset(token)`
   - `assert_trace_bound() -> None`: 若 var 值 == "tr-unbound" raise `TraceLostError`
   - `class TracingMiddleware`: 实现 ASGI 接口,从 `X-Trace-Id` header 读或 new_trace_id,scope 里设置,response header 回写
   - `format_trace_id(tid: TraceId) -> str`: 返回 `str(tid)`(便于日志字段)

## 4. 详细步骤

1. `from __future__ import annotations`
2. `from contextvars import ContextVar, Token` + `from uuid import uuid4`
3. `from src.main.infra.domain import TraceId`
4. `from src.main.infra.errors import TraceLostError`
5. 模块顶部: `_trace_id_var: ContextVar[TraceId] = ContextVar("trace_id", default=TraceId("tr-unbound"))`
6. `new_trace_id()`: `return TraceId(f"tr-{uuid4().hex[:16]}")`
7. `current_trace_id()`: `return _trace_id_var.get()`
8. `bind` 与 `reset` 直接转发 ContextVar 方法
9. `assert_trace_bound()`: 若 `current_trace_id() == TraceId("tr-unbound")` raise TraceLostError
10. `class TracingMiddleware`:
    - `__init__(self, app, header_name: str = "X-Trace-Id")`
    - `async def __call__(self, scope, receive, send)`:
      - 仅处理 `scope["type"] == "http"`,其他类型 pass through
      - `headers = dict(scope.get("headers") or [])`
      - `tid_bytes = headers.get(header_name.lower().encode())`
      - `tid = TraceId(tid_bytes.decode()) if tid_bytes else new_trace_id()`
      - `token = bind(tid)`
      - try: 调用下游 app,在 send 之前包装 send 以注入 header
      - finally: `reset(token)`

## 5. Do Not 清单

- [ ] **Do Not #18**（v2.1 新增）: ContextVar 在跨 Task 调度时只继承调度时刻快照,子 Task 的 set 不会回写;一旦污染,日志 trace_id 错乱且不可复现 — 本卡片只提供基础设施,具体 worker 必须显式接 `trace_id` 参数（这是调用方约定,本卡片不强制）
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol — （本卡片不 import 任何 `_xxx`）
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **Do Not #新增**: TracingMiddleware 不得捕获异常或 `try/except Exception: pass`

## 6. 验收标准

- [ ] `python -c "from src.main.infra.tracing import new_trace_id, current_trace_id, bind, reset, assert_trace_bound, TracingMiddleware"` 退出码 0
- [ ] `new_trace_id().startswith("tr-")` 为 True
- [ ] `bind(TraceId("tr-test")); assert current_trace_id() == TraceId("tr-test"); reset(token)` 行为正确
- [ ] 两次连续 `new_trace_id()` 返回值不同
- [ ] 未 bind 时 `current_trace_id() == TraceId("tr-unbound")`
- [ ] `assert_trace_bound()` 在 unbound 时抛 `TraceLostError`
- [ ] `assert_trace_bound()` 在 bind 后不抛

## 7. 非目标

- 不实现 FastAPI middleware 集成（TASK-406）
- 不实现 structlog bind_contextvars（TASK-006）
- 不写 pytest 用例（跨切卡片 TASK-CCC-03）

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-005 交付说明

$ python -c "
from src.main.infra.tracing import new_trace_id, current_trace_id, bind, reset, assert_trace_bound
from src.main.infra.errors import TraceLostError
print('unbound:', current_trace_id())
try: assert_trace_bound()
except TraceLostError as e: print('caught:', e.message)
t = new_trace_id()
token = bind(t)
print('bound:', current_trace_id())
assert_trace_bound()
print('ok')
reset(token)
"
unbound: tr-unbound
caught: trace_id not bound
bound: tr-aabbccdd11223344
ok
```
