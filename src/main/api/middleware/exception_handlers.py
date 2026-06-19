"""Global exception handlers for FastAPI.

Converts :class:`FinAgentError` (and Pydantic :class:`RequestValidationError`)
into the unified :class:`ApiResponse` envelope, attaches an ``X-Trace-Id``
header, and falls back to a generic 500 envelope for unhandled exceptions.

参见架构文档 §6.2。
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from src.main.infra.api_envelope import ApiResponse
from src.main.infra.errors import FinAgentError, ValidationError
from src.main.infra.logging import get_logger
from src.main.infra.settings import Settings
from src.main.infra.tracing import current_trace_id

_log = get_logger(__name__)


# ── Handlers ──


async def finagent_error_handler(request: Request, exc: FinAgentError) -> JSONResponse:
    """Handle :class:`FinAgentError` and its subclasses.

    Returns the unified envelope at ``exc.http_status`` with the
    ``X-Trace-Id`` response header.
    """
    tid = current_trace_id()
    resp = ApiResponse.from_exception(exc, tid)
    headers = {"X-Trace-Id": str(tid)}
    return JSONResponse(
        content=resp.to_dict(),
        status_code=exc.http_status,
        headers=headers,
    )


async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Handle Pydantic :class:`RequestValidationError` from FastAPI request bodies.

    Converts the Pydantic error into a :class:`ValidationError`
    (BizError, code ``VALIDATION_FAILED``, HTTP 422) and re-uses the
    same envelope returned by :func:`finagent_error_handler`.
    """
    errors_payload = exc.errors() if hasattr(exc, "errors") else []
    validation_exc = ValidationError(
        "Request validation failed",
        details={"errors": errors_payload},
    )
    tid = current_trace_id()
    resp = ApiResponse.from_exception(validation_exc, tid)
    headers = {"X-Trace-Id": str(tid)}
    return JSONResponse(
        content=resp.to_dict(),
        status_code=validation_exc.http_status,
        headers=headers,
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all handler for any unhandled :class:`Exception`.

    Logs the exception (with traceback) and returns a generic 500 envelope
    so that no error is ever silently swallowed. Do Not #3 from TASK-407.
    """
    _log.error(
        "unhandled_exception",
        exc_type=type(exc).__name__,
        exc_message=str(exc),
        exc_info=True,
    )
    tid = current_trace_id()
    generic_envelope: dict = {
        "code": 5000,
        "message": "Internal server error",
        "data": None,
        "trace_id": str(tid),
    }
    headers = {"X-Trace-Id": str(tid)}
    return JSONResponse(
        content=generic_envelope,
        status_code=500,
        headers=headers,
    )


# ── Registration ──


def register_exception_handlers(app: FastAPI, settings: Settings) -> None:
    """Register all global exception handlers on a FastAPI app.

    Args:
        app: The FastAPI application instance.
        settings: Application settings (reserved for future per-env tuning).

    Order of registration is irrelevant — FastAPI dispatches by exception
    type, not registration order. ``Exception`` is the broadest base class
    and only fires when nothing more specific matches.
    """
    app.add_exception_handler(FinAgentError, finagent_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(Exception, generic_exception_handler)