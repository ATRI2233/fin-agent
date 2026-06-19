# TASK-407: api/middleware/exception_handlers.py - 全局异常处理

> **阶段**: Phase 4 · **估时**: 2h · **优先级**: P1
> **上下文窗口**: 3 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-407` |
| 所属阶段 | Phase 4 / api |
| 前置任务 | TASK-003, TASK-004, TASK-005, TASK-007 |
| 后置任务 | TASK-411 |
| 输出文件 | `src/main/api/middleware/exception_handlers.py` |

## 2. 目标

把 `FinAgentError` 转 `ApiResponse` + `JSONResponse(http_status)`,含 `X-Trace-Id` header。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.4, §6.2
2. `src/main/infra/errors.py` (TASK-003)
3. `src/main/infra/api_envelope.py` (TASK-004)
4. `src/main/infra/tracing.py` (TASK-005)

### 3.2 类型依赖

- `infra.errors.FinAgentError` (TASK-003)
- `infra.api_envelope.ApiResponse` (TASK-004)
- `infra.tracing.current_trace_id` (TASK-005)
- `infra.settings.Settings` (TASK-007)

### 3.3 输出文件

1. `src/main/api/middleware/exception_handlers.py` - 含:
   - `def register_exception_handlers(app: FastAPI, settings: Settings) -> None`:
     - 注册 `finagent_error_handler`, `validation_error_handler` (Pydantic), `generic_exception_handler`

## 4. 详细步骤

1. `from fastapi import FastAPI, Request`
2. `from fastapi.exceptions import RequestValidationError`
3. `from fastapi.responses import JSONResponse`
4. `from src.main.infra.errors import FinAgentError`
5. `from src.main.infra.api_envelope import ApiResponse`
6. `from src.main.infra.tracing import current_trace_id`
7. `from src.main.infra.errors import ValidationError`
8. `from src.main.infra.logging import get_logger`
9. `from src.main.infra.settings import Settings`
10. `async def finagent_error_handler(request: Request, exc: FinAgentError) -> JSONResponse`:
    - `tid = current_trace_id()`
    - `resp = ApiResponse.from_exception(exc, tid)`
    - `headers = {"X-Trace-Id": str(tid)}`
    - `return JSONResponse(content=resp.to_dict(), status_code=exc.http_status, headers=headers)`
11. `async def validation_error_handler(request, exc: RequestValidationError) -> JSONResponse`:
    - 转 ValidationError,同上传
12. `async def generic_exception_handler(request, exc: Exception) -> JSONResponse`:
    - log exc, return 500 通用错误
13. `def register_exception_handlers(app, settings)`:
    - `app.add_exception_handler(FinAgentError, finagent_error_handler)`
    - `app.add_exception_handler(RequestValidationError, validation_error_handler)`
    - `app.add_exception_handler(Exception, generic_exception_handler)`

## 5. Do Not 清单

- [ ] **Do Not #4**: 异常必须结构化(继承 FinAgentError + ErrorCode)
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol

## 6. 验收标准

- [ ] `python -c "from src.main.api.middleware.exception_handlers import register_exception_handlers"` 退出码 0
- [ ] FastAPI test client:raise `WorkflowNotFoundError("wf-1")` 后响应 status=404, body `{"code":1001, "message":"wf-1", ...}`, header 含 `X-Trace-Id`
- [ ] raise `Exception("oops")` 后响应 status=500, body 是 generic envelope
- [ ] **关键 grep**: `grep -nE 'except Exception: pass' src/main/api/middleware/exception_handlers.py` → 0

## 7. 非目标

- 不实现 app factory(TASK-409 范围)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-407 交付说明

$ python -c "
from fastapi import FastAPI
from fastapi.testclient import TestClient
from src.main.api.middleware.exception_handlers import register_exception_handlers
from src.main.api.middleware.trace import register_trace_middleware
from src.main.infra.settings import Settings
from src.main.infra.errors import WorkflowNotFoundError
app = FastAPI()
register_trace_middleware(app, Settings())
register_exception_handlers(app, Settings())
@app.get('/x')
def x(): raise WorkflowNotFoundError('wf-1')
c = TestClient(app)
r = c.get('/x')
print(r.status_code, r.json(), r.headers.get('X-Trace-Id'))
"
404 {'code': 1001, 'message': 'wf-1', 'data': None, 'trace_id': 'tr-...'} tr-aabb...
```
