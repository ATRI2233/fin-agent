"""ASGI middleware registration for trace_id propagation.

Registers the infra.tracing.TracingMiddleware with a FastAPI application,
using the header name configured in Settings.TRACE_ID_HEADER.
"""

from __future__ import annotations

from fastapi import FastAPI

from src.main.infra.settings import Settings
from src.main.infra.tracing import TracingMiddleware


def register_trace_middleware(app: FastAPI, settings: Settings) -> None:
    """Register TracingMiddleware on a FastAPI app.

    Args:
        app: The FastAPI application instance.
        settings: Application settings; TRACE_ID_HEADER controls the header name.
    """
    app.add_middleware(TracingMiddleware, header_name=settings.TRACE_ID_HEADER)
