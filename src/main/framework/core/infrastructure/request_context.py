"""Request-scoped context propagation for API observability.

Exposes a :class:`contextvars.ContextVar` that downstream code (logger,
error handlers, etc.) can read to correlate logs and traces with the
incoming HTTP request. The companion :class:`RequestContextMiddleware`
populates the contextvar for the lifetime of each request and echoes
the request ID back to the client via the ``X-Request-ID`` response
header.

Multi-worker note
-----------------
``ContextVar`` values are isolated per asyncio task / per thread, so
each worker process and each request gets its own copy. This is what
we want: no cross-request leakage. Under ``uvicorn --workers N`` each
worker is its own process with its own context, which is also fine —
request IDs are scoped to a single request, not a single worker.
"""

from __future__ import annotations

import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

__all__ = ["current_request_id", "get_request_id", "RequestContextMiddleware"]

#: Per-request correlation ID. ``None`` outside of an active request.
current_request_id: ContextVar[str | None] = ContextVar("current_request_id", default=None)


def get_request_id() -> str | None:
    """Return the current request's correlation ID, or ``None`` if unset."""
    return current_request_id.get()


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Assign a request ID, expose it via ``current_request_id``, echo in response."""

    HEADER_NAME = "X-Request-ID"

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get(self.HEADER_NAME) or uuid.uuid4().hex
        token = current_request_id.set(request_id)
        try:
            response = await call_next(request)
        finally:
            current_request_id.reset(token)
        response.headers[self.HEADER_NAME] = request_id
        return response
