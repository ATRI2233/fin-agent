"""FastAPI app factory + lifespan + middleware/router 装配.

TASK-409: 工厂职责严格划清 — 接收外部注入的 Settings 与 Registry,
不在内部装配任何服务依赖。所有 v1 router 由本模块统一 include。

范围约束:
    - 依赖注入容器的组装职责由 TASK-411 拥有,本模块不实现
    - 进程启动入口由 TASK-411 拥有,本模块不实现
    - 不实现 settings 校验(在 TASK-411 调用,本卡片接收已校验的 settings)
    - 不实现 webui envelope 兼容层(在 TASK-410,本卡片仅 add_middleware)

中间件注册顺序敏感(修订 T-8):
    1. Trace 注入 — 先注入 trace_id
    2. 异常处理 — 再注册全局异常包装
    3. 旧版信封降级 — 最后做 legacy 降级

Do Not #3: 任何异常必须向上抛或转为 FinAgentError,
Settings 的 validate 失败必须传播(在 TASK-411 入口处显式调用)。
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from src.main.infra.di import Registry
from src.main.infra.logging import configure_logging, get_logger
from src.main.infra.settings import Settings


# ── Lifespan ──


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI 启动/关闭生命周期。

    启动期: 配置日志 + 记录启动事件。
    关闭期: 调用 registry.shutdown()(修订 T-11 显式 dispose SQLAlchemy Engine)。

    Args:
        app: FastAPI 应用实例,本函数依赖 ``create_app`` 注入的 state。

    Yields:
        控制权交还给 FastAPI runtime;关闭期在 yield 后执行。
    """
    settings: Settings = app.state.settings
    configure_logging(settings)
    get_logger().info("app.startup", version="2.1")
    yield
    await app.state.registry.shutdown()
    get_logger().info("app.shutdown")


# ── Factory ──


def create_app(
    *,
    settings: Settings,
    registry: Registry,
) -> FastAPI:
    """FastAPI app 工厂 — 接收外部 registry 与 settings,不再内部装配。

    严格禁止:
        - 内部调用依赖注入容器组装函数(在 TASK-411)
        - 内部调用 Settings() 默认构造(强制外部注入,便于测试)

    Args:
        settings: 应用配置,已通过 Settings 的 validate 校验。
        registry: 外部注入的 DI Registry,装载全部 service 单例。

    Returns:
        配置完毕的 FastAPI 实例(含 5 个 v1 router、3 个中间件、
        lifespan 启动/关闭钩子)。
    """
    from src.main.api.middleware.exception_handlers import register_exception_handlers
    from src.main.api.middleware.trace import register_trace_middleware
    from src.main.api.v1 import (
        agents,
        conversations,
        executions,
        mcp,
        workflows,
    )
    from src.main.api.v1._legacy_compat import LegacyEnvelopeMiddleware

    app = FastAPI(
        title="Fin-Agent",
        version="2.1",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.registry = registry

    # ── Middleware (注册顺序敏感) ──
    # 1. TracingMiddleware 先注入 trace_id
    register_trace_middleware(app, settings)
    # 2. ExceptionHandlers 包装 FinAgentError / Validation / Exception
    register_exception_handlers(app, settings)
    # 3. LegacyEnvelopeMiddleware 最后做 legacy 降级(修订 T-8)
    app.add_middleware(LegacyEnvelopeMiddleware)

    # ── v1 routers ──
    app.include_router(workflows.router)
    app.include_router(executions.router)
    app.include_router(agents.router)
    app.include_router(mcp.router)
    app.include_router(conversations.router)

    return app
