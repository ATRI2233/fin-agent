# TASK-410: api/v1/_legacy_compat.py — webui envelope 破坏性变更兼容层

> **阶段**: Phase 4 子任务 4.3 · **估时**: 12h · **优先级**: P0（Gate 4.5）
> **上下文窗口**: 2 输入 · 1 输出 + webui env var 配置
> **关联修订**: REVISION_NOTES_2026-06-18.md 修订 **T-8**（webui envelope 破坏性变更需要兼容层）

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-410` |
| 所属阶段 | Phase 4 / api compat |
| 前置任务 | TASK-002, TASK-004, TASK-407 (exception handlers), TASK-409 (api/v1 routers 装配) |
| 后置任务 | TASK-501 (cleanup) — `_legacy_compat.py` 在 Phase 5 末删除 |
| 输出文件 | `src/main/api/v1/_legacy_compat.py`, `src/main/api/v1/__init__.py`(修改) |

## 2. 目标

实现 FastAPI 中间件/装饰器,当请求 header `X-Api-Version: legacy` 时,**响应体**降级为旧 FastAPI `{detail, ...}` 形状,避免 webui 在 1 个 sprint 内被迫同步切换前端 axios 拦截器。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.4 ApiResponse, §10 验收清单
2. `docs/architecture/REVISION_NOTES_2026-06-18.md` 修订 T-8
3. `src/main/infra/api_envelope.py` (TASK-004) — 新信封形状
4. `src/main/api/v1/*.py` (TASK-407/408/409) — 现有路由

### 3.2 类型依赖

- `infra.api_envelope.ApiResponse` (TASK-004)
- `infra.domain.TraceId` (TASK-002)
- FastAPI `Request`, `Response`, `JSONResponse`

### 3.3 输出文件

1. **`src/main/api/v1/_legacy_compat.py`** — 兼容层中间件 + 转换工具
2. **修改** `src/main/api/v1/__init__.py` — 在 router 装配处注册中间件

## 4. 详细步骤

### 4.1 _legacy_compat.py

1. `from __future__ import annotations`
2. `from starlette.middleware.base import BaseHTTPMiddleware`
3. `from starlette.requests import Request`
4. `from starlette.responses import JSONResponse, Response`
5. `from src.main.infra.api_envelope import ApiResponse`
6. `LEGACY_HEADER = "X-Api-Version"` (常量)
7. `LEGACY_VALUE = "legacy"`

#### 4.1.1 响应转换工具

```python
def _new_to_legacy(payload: dict) -> dict:
    """把 {code, message, data, trace_id} 转 {detail, code, trace_id}。
    
    旧 FastAPI shape 是 {detail: <error msg>, ...} ;我们折中:
    - 成功: {detail: null, code: <int>, data: <original>, trace_id}
    - 失败: {detail: <message>, code: <int>, trace_id} — data 字段折叠进 detail
    """
    code = payload.get("code", 0)
    message = payload.get("message", "")
    data = payload.get("data")
    trace_id = payload.get("trace_id")
    if code == 0:
        # 成功: data 放 detail 是反直觉,改用 status 字段
        return {"status": "ok", "code": code, "data": data, "trace_id": trace_id}
    return {"detail": message, "code": code, "trace_id": trace_id, "data": data}
```

#### 4.1.2 Middleware

```python
class LegacyEnvelopeMiddleware(BaseHTTPMiddleware):
    """当 X-Api-Version: legacy 时,把 ApiResponse 形状降级为旧 FastAPI 形状。

    仅在 webui 设置 VITE_API_VERSION=legacy 时生效,1 sprint 后删除。
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        is_legacy = request.headers.get(LEGACY_HEADER) == LEGACY_VALUE
        response = await call_next(request)
        if not is_legacy:
            return response

        # 只处理 application/json
        ctype = response.headers.get("content-type", "")
        if "application/json" not in ctype:
            return response

        # 解析 body → 转 legacy → 重建
        body = b""
        async for chunk in response.body_iterator:
            body += chunk if isinstance(chunk, bytes) else chunk.encode()
        try:
            payload = json.loads(body)
        except Exception:
            return response  # 不是 JSON,不动

        legacy = _new_to_legacy(payload)
        return JSONResponse(
            content=legacy,
            status_code=response.status_code,
            headers={k: v for k, v in response.headers.items()
                     if k.lower() not in ("content-length", "content-type")},
        )
```

### 4.2 __init__.py 修改

在 `app.add_middleware(...)` 链中插入:

```python
from src.main.api.v1._legacy_compat import LegacyEnvelopeMiddleware

def build_app():
    app = FastAPI(...)
    app.add_middleware(LegacyEnvelopeMiddleware)  # 必须在 trace middleware 之后
    # ... routers
```

**位置约束**: 必须在 `TracingMiddleware`(TASK-406)之后注册,这样 `X-Trace-Id` 已在 response.headers 中;legacy 响应转换不会丢 trace。

### 4.3 双形状 e2e 测试

在 `tests/api/test_legacy_compat.py` 写 4 个 test:

| Test | 验证 |
|---|---|
| `test_new_shape_default` | 不带 X-Api-Version header → 响应是新 `{code, message, data, trace_id}` |
| `test_legacy_shape_with_header` | 带 `X-Api-Version: legacy` → 响应是 `{status, code, data, trace_id}` 或 `{detail, code, trace_id, data}` |
| `test_legacy_trace_id_preserved` | legacy 模式下响应仍含 `trace_id` 字段 |
| `test_legacy_non_json_passthrough` | legacy 模式但响应非 JSON → 不转换 |

### 4.4 webui 切换文档

在 `webui/README.md`(若存在)或本卡片输出追加一段:

```markdown
## 切换到新 envelope(默认)

默认 webui 已适配 `{code, message, data, trace_id}` 形状。

## 回退到 legacy 形状(1 sprint 缓冲)

若前端尚未迁移,在 `webui/.env.local` 设置:
VITE_API_VERSION=legacy

后端中间件自动降级响应形状。1 sprint 后删除 `VITE_API_VERSION` 与 `_legacy_compat.py`。
```

## 5. Do Not 清单

- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError — 解析失败抛 500 或透传
- [ ] **Do Not #6**: 重构期一次性切换;不允许共存 — `_legacy_compat.py` 标注 `@deprecated`,1 sprint 后必删(由 TASK-501 收尾)
- [ ] **Do Not #16**: 任何 agent 层异常必须 catch 后包成 `AgentTimeoutError`/`AgentHttp5xxError`/`McpServerError` 之一
- [ ] **修订 T-8 强约束**: **禁止**将 legacy 兼容逻辑散落到各 router 内;必须集中在 `_legacy_compat.py`
- [ ] **修订 T-8 强约束**: **禁止**让 legacy 模式影响非 JSON 响应(如文件下载)

## 6. 验收标准

- [ ] `python -c "from src.main.api.v1._legacy_compat import LegacyEnvelopeMiddleware"` 退出码 0
- [ ] `pytest tests/api/test_legacy_compat.py -v` 全绿(4 个 test)
- [ ] **关键 grep #1**: `grep -nE '_new_to_legacy|LEGACY_HEADER' src/main/api/v1/_legacy_compat.py` 命中 ≥ 1
- [ ] **关键 grep #2**: `grep -nE 'LegacyEnvelopeMiddleware' src/main/api/v1/__init__.py` 命中 ≥ 1(已注册)
- [ ] **集成验证**: `curl -H "X-Api-Version: legacy" http://127.0.0.1:8000/api/v1/workflows` 返回 `{detail, code, trace_id}` 形状
- [ ] **集成验证 #2**: 不带 header 时 `curl http://127.0.0.1:8000/api/v1/workflows` 返回 `{code, message, data, trace_id}` 形状

## 7. 非目标

- 不修改 webui 实际 axios 拦截器(留 webui 团队)
- 不实现 `X-Api-Version: v2` / `v3` 等未来版本(只做 legacy → new 一次性桥接)
- 不修改 OpenAPI schema(legacy 模式仅影响响应体,不影响 OpenAPI 描述)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-410 交付说明

### 双形状 e2e 测试
$ pytest tests/api/test_legacy_compat.py -v
test_legacy_compat.py::test_new_shape_default PASSED
test_legacy_compat.py::test_legacy_shape_with_header PASSED
test_legacy_compat.py::test_legacy_trace_id_preserved PASSED
test_legacy_compat.py::test_legacy_non_json_passthrough PASSED

### 集成验证
$ curl -s -H "X-Api-Version: legacy" http://127.0.0.1:8000/api/v1/workflows | jq 'keys'
[
  "code",
  "data",
  "detail",
  "trace_id"
]

$ curl -s http://127.0.0.1:8000/api/v1/workflows | jq 'keys'
[
  "code",
  "data",
  "message",
  "trace_id"
]

### 关联卡片引用
- TASK-501 收尾: 1 sprint 后删除 `_legacy_compat.py` 与 webui `VITE_API_VERSION=legacy`
- TASK-CCC-04 grep 验证: 加 `_legacy_compat.py` 存在性检查

### 偏离 / 备注
无偏离,严格按修订 T-8 执行
```
