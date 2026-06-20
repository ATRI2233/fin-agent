"""API v1 版本路由。

Middleware 装配 (修订 T-8):
- ``TracingMiddleware``: 生成/传播 trace_id,放在最外层。
- ``LegacyEnvelopeMiddleware``: legacy 响应形状降级,放在 trace 之后
  (这样 ``X-Trace-Id`` 已写入 response.headers,降级时不会丢 trace 信息)。
"""

from __future__ import annotations

from fastapi import FastAPI

from src.main.api.v1._legacy_compat import LegacyEnvelopeMiddleware
from src.main.infra.settings import Settings
from src.main.infra.tracing import TracingMiddleware

__all__ = ["build_v1_app", "router"]


def build_v1_app(parent: FastAPI, settings: Settings) -> FastAPI:
    """把 v1 路由 + 中间件挂载到父 app。

    Args:
        parent: 已创建好的 FastAPI 主应用。
        settings: 应用配置(预留扩展)。

    Returns:
        同一个 ``parent`` 实例,便于链式调用。
    """
    # trace 中间件放最外层,确保 trace_id 先生在上下文
    parent.add_middleware(TracingMiddleware)
    # legacy 降级放 trace 之后,这样降级响应能透传 X-Trace-Id header
    parent.add_middleware(LegacyEnvelopeMiddleware)
    return parent
