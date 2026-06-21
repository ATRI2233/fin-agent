"""API key + localhost authentication.

Provides ``verify_request`` which FastAPI middleware or route guards can
call to reject unauthenticated requests.

Intentionally no OAuth / JWT — those belong in a higher layer.
"""

from __future__ import annotations

import ipaddress
import hmac

from fastapi import Request

from src.main.infra.errors import ValidationError
from src.main.infra.settings import Settings


def verify_request(request: Request, settings: Settings) -> None:
    """Authenticate *request* against *settings*.

    Two success paths (checked in order):

    1. ``settings.AUTH_SKIP_LOCALHOST`` is ``True`` and the client IP is a
       loopback address (IPv4, IPv6, or IPv4-mapped IPv6) → pass.
    2. The ``X-API-Key`` header matches ``settings.API_KEY`` → pass.

    Otherwise raises :class:`ValidationError` with message ``"unauthorized"``.
    """
    # ── Localhost bypass ──
    if settings.AUTH_SKIP_LOCALHOST:
        client_host = request.client.host if request.client else None
        if client_host is not None:
            try:
                addr = ipaddress.ip_address(client_host)
            except ValueError:
                # Not a valid IP address (e.g., a hostname through a proxy).
                pass
            else:
                if addr.is_loopback:
                    return

    # ── API key check ──
    # Defensive: configuration must be set, and request must carry a key.
    if not settings.API_KEY:
        raise ValidationError("unauthorized")
    api_key = request.headers.get("X-API-Key", "")
    if not api_key:
        raise ValidationError("unauthorized")
    # Constant-time comparison to defeat timing attacks.
    if hmac.compare_digest(api_key, settings.API_KEY):
        return

    raise ValidationError("unauthorized")
