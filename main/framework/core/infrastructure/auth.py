from fastapi import HTTPException, Request
from main.framework.config import settings
from starlette.middleware.base import BaseHTTPMiddleware


class APIKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Skip auth if no API key configured
        if not settings.API_KEY:
            return await call_next(request)

        # Skip auth for localhost only when explicitly allowed (default: not allowed behind proxy)
        client_host = request.client.host if request.client else ""
        if settings.AUTH_SKIP_LOCALHOST and client_host in ("127.0.0.1", "::1", "localhost"):
            return await call_next(request)

        # Check API key — header (normal requests) or query param (SSE EventSource
        # cannot send custom headers).
        api_key = request.headers.get("X-API-Key") or request.query_params.get("api_key")
        if api_key != settings.API_KEY:
            raise HTTPException(status_code=401, detail="Invalid API Key")

        return await call_next(request)
