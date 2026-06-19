"""API key + localhost authentication.

Provides ``verify_request`` which FastAPI middleware or route guards can
call to reject unauthenticated requests.

Intentionally no OAuth / JWT — those belong in a higher layer.
"""

from __future__ import annotations

from fastapi import Request

from src.main.infra.errors import ValidationError
from src.main.infra.settings import Settings


def verify_request(request: Request, settings: Settings) -> None:
    """Authenticate *request* against *settings*.

    Two success paths (checked in order):

    1. ``settings.AUTH_SKIP_LOCALHOST`` is ``True`` and the client IP is
       ``127.0.0.1`` or ``::1`` → pass.
    2. The ``X-API-Key`` header matches ``settings.API_KEY`` → pass.

    Otherwise raises :class:`ValidationError` with message ``"unauthorized"``.
    """
    # ── Localhost bypass ──
    if settings.AUTH_SKIP_LOCALHOST:
        client_host = request.client.host if request.client else None
        if client_host in ("127.0.0.1", "::1"):
            return

    # ── API key check ──
    if request.headers.get("X-API-Key") == settings.API_KEY:
        return

    raise ValidationError("unauthorized")
