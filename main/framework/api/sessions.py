"""Session management API — view and cleanup agent sessions."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from main.framework.core.container import get_service
from main.framework.models.workflow_execution import ExecutionNode
from main.framework.models.conversation import Conversation
from main.framework.repositories.execution_repo import ExecutionRepository
from main.framework.repositories.conversation_repo import ConversationRepository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/sessions", tags=["sessions"])


# ---- Response models ----


class SessionInfo(BaseModel):
    session_id: str
    source: str  # "workflow" | "conversation"
    execution_id: Optional[str] = None
    node_id: Optional[str] = None
    agent: Optional[str] = None
    status: str  # "active" | "inactive" | "cleaned_up" | "unknown"
    created_at: Optional[str] = None


class SessionListResponse(BaseModel):
    sessions: list[SessionInfo]
    total: int
    active_count: int


class CleanupRequest(BaseModel):
    execution_id: Optional[str] = None
    all_expired: bool = False


class CleanupResponse(BaseModel):
    cleaned: int
    failed: int
    details: dict[str, str]


# ---- Endpoints ----


@router.get("", response_model=SessionListResponse)
async def list_sessions(
    request: Request,
    exec_repo: ExecutionRepository = Depends(get_service(ExecutionRepository)),
    conv_repo: ConversationRepository = Depends(get_service(ConversationRepository)),
):
    """List all known sessions from workflow executions and conversations."""
    sessions: list[SessionInfo] = []

    # Sessions from workflow execution nodes
    with exec_repo._session() as db:
        nodes = (
            db.query(ExecutionNode)
            .filter(ExecutionNode.session_id.isnot(None))
            .filter(ExecutionNode.session_id != "")
            .all()
        )
        for n in nodes:
            sessions.append(
                SessionInfo(
                    session_id=n.session_id,
                    source="workflow",
                    execution_id=n.execution_id,
                    node_id=n.node_id,
                    agent=n.agent,
                    status=_map_node_status(n.status),
                    created_at=n.started_at.isoformat() if n.started_at else None,
                )
            )

    # Sessions from conversations
    with conv_repo._session() as db:
        convos = (
            db.query(Conversation)
            .filter(Conversation.session_id.isnot(None))
            .filter(Conversation.session_id != "")
            .all()
        )
        for c in convos:
            sessions.append(
                SessionInfo(
                    session_id=c.session_id,
                    source="conversation",
                    execution_id=None,
                    node_id=None,
                    agent=c.current_agent,
                    status="active",  # conversation sessions are active until deleted
                    created_at=c.created_at.isoformat() if c.created_at else None,
                )
            )

    active_count = sum(1 for s in sessions if s.status == "active")
    return SessionListResponse(
        sessions=sessions,
        total=len(sessions),
        active_count=active_count,
    )


@router.get("/{session_id}", response_model=SessionInfo)
async def get_session(
    session_id: str,
    request: Request,
    exec_repo: ExecutionRepository = Depends(get_service(ExecutionRepository)),
    conv_repo: ConversationRepository = Depends(get_service(ConversationRepository)),
):
    """Get details for a specific session."""
    # Check execution nodes
    with exec_repo._session() as db:
        node = db.query(ExecutionNode).filter(ExecutionNode.session_id == session_id).first()
        if node:
            return SessionInfo(
                session_id=session_id,
                source="workflow",
                execution_id=node.execution_id,
                node_id=node.node_id,
                agent=node.agent,
                status=_map_node_status(node.status),
                created_at=node.started_at.isoformat() if node.started_at else None,
            )

    # Check conversations
    with conv_repo._session() as db:
        convo = db.query(Conversation).filter(Conversation.session_id == session_id).first()
        if convo:
            return SessionInfo(
                session_id=session_id,
                source="conversation",
                agent=convo.current_agent,
                status="active",
                created_at=convo.created_at.isoformat() if convo.created_at else None,
            )

    raise HTTPException(status_code=404, detail=f"Session {session_id} not found")


@router.delete("/{session_id}")
async def cleanup_session(
    session_id: str,
    request: Request,
    exec_repo: ExecutionRepository = Depends(get_service(ExecutionRepository)),
):
    """Cleanup a specific session."""
    container = request.app.state.container
    backend = container.backend

    try:
        result = await backend.cleanup_sessions([session_id])
        status = result.get(session_id, "unknown")
        if status.startswith("failed"):
            raise HTTPException(status_code=500, detail=status)

        # Mark nodes as cleaned up
        with exec_repo._session() as db:
            nodes = db.query(ExecutionNode).filter(ExecutionNode.session_id == session_id).all()
            for n in nodes:
                n.status = "cleaned_up"
            db.commit()

        return {"session_id": session_id, "status": "cleaned"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cleanup", response_model=CleanupResponse)
async def bulk_cleanup(
    payload: CleanupRequest,
    request: Request,
    exec_repo: ExecutionRepository = Depends(get_service(ExecutionRepository)),
):
    """Bulk cleanup sessions by execution_id or all expired."""
    from main.framework.core.session_cleanup import cleanup_workflow_sessions

    if not payload.execution_id and not payload.all_expired:
        raise HTTPException(
            status_code=400,
            detail="Provide execution_id or set all_expired=true",
        )

    cleaned = 0
    failed = 0
    details: dict[str, str] = {}

    if payload.execution_id:
        container = request.app.state.container
        result = cleanup_workflow_sessions(payload.execution_id, backend=container.backend)
        for sid, status in result.items():
            details[sid] = status
            if status == "cleaned":
                cleaned += 1
            else:
                failed += 1

    elif payload.all_expired:
        container = request.app.state.container
        backend = container.backend
        with exec_repo._session() as db:
            nodes = (
                db.query(ExecutionNode)
                .filter(ExecutionNode.session_id.isnot(None))
                .filter(ExecutionNode.session_id != "")
                .filter(ExecutionNode.status.notin_(["cleaned_up", "pending", "running"]))
                .all()
            )
            session_ids = list({n.session_id for n in nodes})
            if session_ids:
                result = await backend.cleanup_sessions(session_ids)
                for sid, status in result.items():
                    details[sid] = status
                    if status == "cleaned":
                        cleaned += 1
                        # Mark nodes
                        for n in nodes:
                            if n.session_id == sid:
                                n.status = "cleaned_up"
                    else:
                        failed += 1
                db.commit()

    return CleanupResponse(cleaned=cleaned, failed=failed, details=details)


# ---- Helpers ----


def _map_node_status(node_status: str) -> str:
    """Map ExecutionNode status to session status."""
    if node_status in ("pending", "running"):
        return "active"
    if node_status == "completed":
        return "inactive"
    if node_status == "cleaned_up":
        return "cleaned_up"
    return "unknown"
