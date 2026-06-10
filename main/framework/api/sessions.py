"""Session management API — thin handlers that delegate to SessionService.

Each endpoint:
  1. Validates the request via Pydantic schemas.
  2. Calls one ``SessionService`` method.
  3. Translates ``NotFoundError`` / ``ServiceError`` → HTTP errors.

Business logic lives in ``SessionService``.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from main.framework.core.container import get_service
from main.framework.services.exceptions import NotFoundError, ServiceError
from main.framework.services.session_service import SessionService

router = APIRouter(prefix="/api/v1/sessions", tags=["sessions"])


# ---- Response models ----


class SessionInfo(BaseModel):
    session_id: str
    source: str  # "workflow" | "conversation"
    execution_id: str | None = None
    node_id: str | None = None
    agent: str | None = None
    status: str  # "active" | "inactive" | "cleaned_up" | "unknown"
    created_at: str | None = None


class SessionListResponse(BaseModel):
    sessions: list[SessionInfo]
    total: int
    active_count: int


class CleanupRequest(BaseModel):
    execution_id: str | None = None
    all_expired: bool = False


class CleanupResponse(BaseModel):
    cleaned: int
    failed: int
    details: dict[str, str]


# ---- Endpoints ----


@router.get("", response_model=SessionListResponse)
async def list_sessions(
    service: SessionService = Depends(get_service(SessionService)),
):
    """List all known sessions from workflow executions and conversations."""
    return service.list_sessions()


@router.get("/{session_id}", response_model=SessionInfo)
async def get_session(
    session_id: str,
    service: SessionService = Depends(get_service(SessionService)),
):
    """Get details for a specific session."""
    try:
        return service.get_session(session_id)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.delete("/{session_id}")
async def cleanup_session(
    session_id: str,
    service: SessionService = Depends(get_service(SessionService)),
):
    """Cleanup a specific session."""
    try:
        return await service.cleanup_session(session_id)
    except ServiceError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/cleanup", response_model=CleanupResponse)
async def bulk_cleanup(
    payload: CleanupRequest,
    service: SessionService = Depends(get_service(SessionService)),
):
    """Bulk cleanup sessions by execution_id or all expired."""
    try:
        return await service.bulk_cleanup(
            execution_id=payload.execution_id,
            all_expired=payload.all_expired,
        )
    except ServiceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
