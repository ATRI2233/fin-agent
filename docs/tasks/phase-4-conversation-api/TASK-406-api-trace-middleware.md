# TASK-406: api/middleware/trace.py - ASGI middleware 集成

> **阶段**: Phase 4 · **估时**: 2h · **优先级**: P1
> **上下文窗口**: 2 输入 · 2 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-406` |
| 所属阶段 | Phase 4 / api |
| 前置任务 | TASK-005, TASK-007 |
| 后置任务 | TASK-411 |
| 输出文件 | `src/main/api/middleware/__init__.py`, `src/main/api/middleware/trace.py` |

## 2. 目标

把 `infra.tracing.TracingMiddleware` 用 FastAPI `add_middleware` 注册。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §7.1
2. `src/main/infra/tracing.py` (TASK-005), `src/main/infra/settings.py` (TASK-007)

### 3.2 类型依赖

- `infra.tracing.TracingMiddleware` (TASK-005)
- `infra.settings.Settings` (TASK-007)
- `fastapi.FastAPI`

### 3.3 输出文件

1. `src/main/api/middleware/__init__.py`(空)
2. `src/main/api/middleware/trace.py` - 含:
   - `def register_trace_middleware(app: FastAPI, settings: Settings) -> None`:
     - `app.add_middleware(TracingMiddleware, header_name=settings.TRACE_ID_HEADER)`

## 4. 详细步骤

1. `from fastapi import FastAPI`
2. `from src.main.infra.tracing import TracingMiddleware`
3. `from src.main.infra.settings import Settings`
4. `def register_trace_middleware(app, settings)`:
   - `app.add_middleware(TracingMiddleware, header_name=settings.TRACE_ID_HEADER)`

## 5. Do Not 清单

- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry

## 6. 验收标准

- [ ] `python -c "from src.main.api.middleware.trace import register_trace_middleware"` 退出码 0
- [ ] 用 FastAPI test client 测:`TestClient(app).get("/", headers={"X-Trace-Id": "tr-test"})` 响应 header 含 `X-Trace-Id: tr-test`
- [ ] 不带 header 时响应 header 含 `X-Trace-Id: tr-{16 hex chars}`

## 7. 非目标

- 不实现 app factory(TASK-409 范围)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-406 交付说明

$ python -c "
from fastapi import FastAPI
from fastapi.testclient import TestClient
from src.main.api.middleware.trace import register_trace_middleware
from src.main.infra.settings import Settings
app = FastAPI()
app.get('/')(lambda: {'ok': True})
register_trace_middleware(app, Settings())
c = TestClient(app)
r = c.get('/')
print(r.headers.get('X-Trace-Id'))
print(r.json())
"
tr-aabbccdd11223344
{'ok': True}
```
