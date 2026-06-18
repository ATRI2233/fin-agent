"""Session API schemas — request/response models for the sessions controller.

These Pydantic V2 models were originally declared inline in
``controllers/sessions.py`` and are now extracted here as part of the
PHASE 5 directory reorganization. Field names, types, defaults, and
validators are preserved verbatim — only the import path changes.

Endpoints served by these schemas (see ``controllers/sessions.py``):

* ``GET /api/v1/sessions`` → ``SessionListResponse``
* ``GET /api/v1/sessions/{session_id}`` → ``SessionInfo``
* ``DELETE /api/v1/sessions/{session_id}`` → dict (no response model)
* ``POST /api/v1/sessions/cleanup`` → body ``CleanupRequest``,
  response ``CleanupResponse``
"""

from __future__ import annotations

from pydantic import BaseModel


class SessionInfo(BaseModel):
    session_id: str
    source: str # "workflow" | "conversation"
    execution_id: str | None = None
    node_id: str | None = None
    agent: str | None = None
    status: str # "active" | "inactive" | "cleaned_up" | "unknown"
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
