# TASK-409: api/app.py - FastAPI app factory + lifespan + middleware/router 装配

> **阶段**: Phase 4 · **估时**: 4h · **优先级**: P0（最终集成卡 · 与 TASK-411 配对）
> **上下文窗口**: 4 输入 · 1 输出
> **范围说明**: 本卡片与 TASK-411 共同拆分原"main.py"职责。TASK-409 拥有 `create_app()` 工厂 + `lifespan` + middleware/router 装配；TASK-411 拥有 `build_registry()` 与 `__main__` 入口。

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-409` |
| 所属阶段 | Phase 4 / api factory |
| 前置任务 | TASK-004, TASK-005, TASK-007, TASK-011, TASK-405, TASK-406, TASK-407, TASK-408, TASK-411 (registry 装配) |
| 后置任务 | TASK-501, TASK-CCC-02, TASK-CCC-03, TASK-CCC-04 |
| 输出文件 | `src/main/api/app.py` |
| **不输出**（明确划清） | `src/main/main.py`（由 TASK-411 拥有） |

## 2. 目标

实现 `create_app()` 工厂：接收外部传入的 `Registry` 与 `Settings`，构造 FastAPI 实例，注册 trace middleware、exception handlers、5 个 v1 router，并定义 `lifespan` 在启动/关闭期调用 `Registry.shutdown()`。

> **不实现** `build_registry()`（在 TASK-411）；本卡片**接收** registry 作为参数，**不再内部装配**。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_06-18.md` §7.1 trace 贯穿, §3.4 ApiResponse
2. `src/main/infra/settings.py` (TASK-007)
3. `src/main/infra/di.py` (TASK-011) — Registry.shutdown() 用于 lifespan 关闭
4. `src/main/api/middleware/trace.py` (TASK-406)
5. `src/main/api/middleware/exception_handlers.py` (TASK-407)
6. `src/main/api/v1/*` (TASK-408)
7. `src/main/main.py` (TASK-411) — `build_registry` 仅 import 用于类型注解

### 3.2 类型依赖

- `infra.settings.Settings` (TASK-007)
- `infra.di.Registry` (TASK-011) — 接收外部 registry 参数
- `infra.api_envelope.ApiResponse` (TASK-004)
- `infra.tracing.TracingMiddleware` (TASK-005)
- 各 v1 router (TASK-408)

### 3.3 输出文件

1. **`src/main/api/app.py`** — 严格只含工厂职责：
   - `def create_app(*, settings: Settings, registry: Registry) -> FastAPI`：构造 app
   - `@asynccontextmanager async def lifespan(app: FastAPI)`：启动校验 + shutdown
   - **不包含** `build_registry()` / `__main__`（在 TASK-411）
   - **不包含** `uvicorn.run()`（在 TASK-411）

## 4. 详细步骤

### 4.1 create_app（强制新签名：registry 外部注入）

> **修订**: 原签名 `create_app(settings: Settings | None = None)` 必须改为 `create_app(*, settings: Settings, registry: Registry)`。
> 原因是 `build_registry` 已在 TASK-411 独立，本卡片**禁止**内部再次装配。

```python
def create_app(
    *,
    settings: Settings,
    registry: Registry,
) -> FastAPI:
    """FastAPI app 工厂 — 接收外部 registry 与 settings,不再内部装配。

    严格禁止:
    - 内部调用 build_registry() (在 TASK-411)
    - 内部调用 Settings() 默认构造 (强制外部注入,便于测试)
    """
    from src.main.api.middleware.trace import register_trace_middleware
    from src.main.api.middleware.exception_handlers import register_exception_handlers
    from src.main.api.v1 import (
        workflows, executions, agents, mcp, conversations,
    )

    app = FastAPI(
        title="Fin-Agent",
        version="2.1",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.registry = registry

    # middleware（注册顺序敏感：trace 必须先于 exception_handlers）
    register_trace_middleware(app, settings)
    register_exception_handlers(app, settings)

    # Legacy envelope 兼容层（修订 T-8 — 在 trace middleware 之后,确保 trace_id 已注入）
    from src.main.api.v1._legacy_compat import LegacyEnvelopeMiddleware
    app.add_middleware(LegacyEnvelopeMiddleware)

    # v1 routers
    app.include_router(workflows.router)
    app.include_router(executions.router)
    app.include_router(agents.router)
    app.include_router(mcp.router)
    app.include_router(conversations.router)

    return app
```

### 4.2 lifespan

```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI 启动/关闭生命周期。

    启动期：配置日志 + 触发 app.startup 事件。
    关闭期：调用 registry.shutdown()(修订 T-11 显式 dispose SQLAlchemy Engine)。
    """
    from src.main.infra.logging import configure_logging, get_logger
    settings = app.state.settings
    configure_logging(settings)
    get_logger().info("app.startup", version="2.1")
    yield
    await app.state.registry.shutdown()
    get_logger().info("app.shutdown")
```

## 5. Do Not 清单

- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError — `Settings().validate()` 失败必须传播
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not #6**: 重构期一次性切换;不允许共存
- [ ] **范围约束**: `create_app` **必须**接收外部 registry 参数,**禁止**内部调 `build_registry()`
- [ ] **范围约束**: 中间件注册顺序敏感 — `TracingMiddleware` (TASK-406) **必须先于** `ExceptionHandlers` 与 `LegacyEnvelopeMiddleware` 注册

## 6. 验收标准

- [ ] `python -c "from src.main.api.app import create_app, lifespan"` 退出码 0
- [ ] `create_app(settings=Settings(), registry=build_registry(Settings()))` 返回 FastAPI 实例
- [ ] `TestClient(app).get("/api/v1/workflows")` 返回 `{"code": 0, ..., "trace_id": "tr-..."}` 形状(mock router 必需)
- [ ] 响应 header 含 `X-Trace-Id`
- [ ] `app.state.registry` 与传入的 registry 是同一对象(`is` 比较)
- [ ] **关键 grep #1**: `grep -nE 'register_singleton' src/main/api/app.py` → 0(本卡片不装配 registry)
- [ ] **关键 grep #2**: `grep -nE 'create_app' src/main/api/app.py` ≥ 2
- [ ] **关键 grep #3**: `grep -nE '^_registry = |^registry = |^app = ' src/main/api/app.py` → 0(无模块级实例)
- [ ] **关键 grep #4**: `grep -nE 'build_registry' src/main/api/app.py` → 0(范围划清)
- [ ] **关键 grep #5**: `grep -nE 'uvicorn\.run|__main__' src/main/api/app.py` → 0(进程入口在 TASK-411)

## 7. 非目标

- 不实现 `build_registry`(在 TASK-411)
- 不实现 `__main__` 入口 / `uvicorn.run`(在 TASK-411)
- 不实现 settings 校验(在 TASK-411 调用,本卡片接收已校验的 settings)
- 不实现 webui envelope 兼容层(在 TASK-410,本卡片仅 add_middleware)
- 不写集成测试(跨切 TASK-CCC-03/04)
- 不实现 settings 热重载

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-409 交付说明

### 工厂 + lifespan 验证
$ python -c "
from src.main.api.app import create_app
from src.main.main import build_registry
from src.main.infra.settings import Settings

settings = Settings()
registry = build_registry(settings)
app = create_app(settings=settings, registry=registry)
print('routes:', len(app.routes))
print('middleware:', len(app.user_middleware))
print('registry is preserved:', app.state.registry is registry)
"

### 范围划清 grep 验证
$ grep -nE 'register_singleton|build_registry|uvicorn\.run' src/main/api/app.py
(no output — confirmed scope isolation from TASK-411)

$ grep -nE 'create_app' src/main/api/app.py | wc -l
3  # 函数定义 + lifespan 引用 + 注释

### 修订 T-8 验证
$ grep -nE 'LegacyEnvelopeMiddleware' src/main/api/app.py
（已注册 — T-410 的中间件在 T-409 的 create_app 中接入）

### 偏离 / 备注
无偏离,严格按设计文档 §6.3 + 修订 T-8/T-11 执行。
注:本卡片与 TASK-411 共同承担原"main.py"职责,详见 INDEX.md §2 阶段汇总。
```
