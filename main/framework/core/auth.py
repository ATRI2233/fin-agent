from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware

from main.framework.config import settings


class APIKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Skip auth if no API key configured
        if not settings.API_KEY:
            return await call_next(request)

        # Skip auth for localhost
        client_host = request.client.host if request.client else ""
        if client_host in ("127.0.0.1", "::1", "localhost"):
            return await call_next(request)

        # Check API key
        api_key = request.headers.get("X-API-Key")
        if api_key != settings.API_KEY:
            raise HTTPException(status_code=401, detail="Invalid API Key")

        return await call_next(request)
