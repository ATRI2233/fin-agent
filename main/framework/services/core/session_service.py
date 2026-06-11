"""SessionService — session listing, lookup, and cleanup.

Extracted from ``api/sessions.py`` so the controller layer stays thin.
All DB access goes through ``ExecutionRepository`` and ``ConversationRepository``;
the service never imports ``SessionLocal`` or ORM models directly.
"""

from __future__ import annotations

import logging
from typing import Any

from main.framework.repositories.conversation_repo import ConversationRepository
from main.framework.repositories.execution_repo import ExecutionRepository
from main.framework.services.patterns.exceptions import NotFoundError, ServiceError

logger = logging.getLogger(__name__)


class SessionService:
    """Business logic for session management.

    Dependencies are injected via constructor — no direct DB access.
    """

    def __init__(
        self,
        exec_repo: ExecutionRepository,
        conv_repo: ConversationRepository,
        backend: Any = None,
    ) -> None:
        self._exec_repo = exec_repo
        self._conv_repo = conv_repo
        self._backend = backend

    # ------------------------------------------------------------------
    # Listing & lookup
    # ------------------------------------------------------------------

    def list_sessions(self) -> dict[str, Any]:
        """List all known sessions from workflow executions and conversations.

        Returns dict with ``sessions``, ``total``, and ``active_count``.
        """
        sessions: list[dict[str, Any]] = []

        # Sessions from workflow execution nodes
        with self._exec_repo._session() as db:
            from main.framework.models.workflow_execution import ExecutionNode

            nodes = (
                db.query(ExecutionNode)
                .filter(ExecutionNode.session_id.isnot(None))
                .filter(ExecutionNode.session_id != "")
                .all()
            )
            for n in nodes:
                sessions.append(
                    {
                        "session_id": n.session_id,
                        "source": "workflow",
                        "execution_id": n.execution_id,
                        "node_id": n.node_id,
                        "agent": n.agent,
                        "status": _map_node_status(n.status),
                        "created_at": n.started_at.isoformat() if n.started_at else None,
                    }
                )

        # Sessions from conversations
        with self._conv_repo._session() as db:
            from main.framework.models.conversation import Conversation

            convos = (
                db.query(Conversation)
                .filter(Conversation.session_id.isnot(None))
                .filter(Conversation.session_id != "")
                .all()
            )
            for c in convos:
                sessions.append(
                    {
                        "session_id": c.session_id,
                        "source": "conversation",
                        "execution_id": None,
                        "node_id": None,
                        "agent": c.current_agent,
                        "status": "active",
                        "created_at": c.created_at.isoformat() if c.created_at else None,
                    }
                )

        active_count = sum(1 for s in sessions if s["status"] == "active")
        return {
            "sessions": sessions,
            "total": len(sessions),
            "active_count": active_count,
        }

    def get_session(self, session_id: str) -> dict[str, Any]:
        """Get details for a specific session.

        Raises ``NotFoundError`` if not found.
        """
        # Check execution nodes
        with self._exec_repo._session() as db:
            from main.framework.models.workflow_execution import ExecutionNode

            node = db.query(ExecutionNode).filter(ExecutionNode.session_id == session_id).first()
            if node:
                return {
                    "session_id": session_id,
                    "source": "workflow",
                    "execution_id": node.execution_id,
                    "node_id": node.node_id,
                    "agent": node.agent,
                    "status": _map_node_status(node.status),
                    "created_at": node.started_at.isoformat() if node.started_at else None,
                }

        # Check conversations
        with self._conv_repo._session() as db:
            from main.framework.models.conversation import Conversation

            convo = db.query(Conversation).filter(Conversation.session_id == session_id).first()
            if convo:
                return {
                    "session_id": session_id,
                    "source": "conversation",
                    "execution_id": None,
                    "node_id": None,
                    "agent": convo.current_agent,
                    "status": "active",
                    "created_at": convo.created_at.isoformat() if convo.created_at else None,
                }

        raise NotFoundError(f"Session {session_id} not found")

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    async def cleanup_session(self, session_id: str) -> dict[str, str]:
        """Cleanup a specific session.

        Returns ``{"session_id": ..., "status": "cleaned"}``.
        Raises ``ServiceError`` if cleanup fails.
        """
        if self._backend is None:
            raise ServiceError("Backend not available for session cleanup")

        result = await self._backend.cleanup_sessions([session_id])
        status = result.get(session_id, "unknown")
        if status.startswith("failed"):
            raise ServiceError(f"Cleanup failed: {status}")

        # Mark nodes as cleaned up
        with self._exec_repo._session() as db:
            from main.framework.models.workflow_execution import ExecutionNode

            nodes = db.query(ExecutionNode).filter(ExecutionNode.session_id == session_id).all()
            for n in nodes:
                n.status = "cleaned_up"
            db.commit()

        return {"session_id": session_id, "status": "cleaned"}

    async def bulk_cleanup(
        self,
        execution_id: str | None = None,
        all_expired: bool = False,
    ) -> dict[str, Any]:
        """Bulk cleanup sessions by execution_id or all expired.

        Returns ``{"cleaned": int, "failed": int, "details": dict}``.
        Raises ``ServiceError`` if no valid filter provided.
        """
        if not execution_id and not all_expired:
            raise ServiceError("Provide execution_id or set all_expired=true")

        cleaned = 0
        failed = 0
        details: dict[str, str] = {}

        if execution_id:
            from main.framework.core.session_cleanup import cleanup_workflow_sessions

            result = cleanup_workflow_sessions(execution_id, backend=self._backend)
            for sid, status in result.items():
                details[sid] = status
                if status == "cleaned":
                    cleaned += 1
                else:
                    failed += 1

        elif all_expired:
            if self._backend is None:
                raise ServiceError("Backend not available for session cleanup")

            with self._exec_repo._session() as db:
                from main.framework.models.workflow_execution import ExecutionNode

                nodes = (
                    db.query(ExecutionNode)
                    .filter(ExecutionNode.session_id.isnot(None))
                    .filter(ExecutionNode.session_id != "")
                    .filter(ExecutionNode.status.notin_(["cleaned_up", "pending", "running"]))
                    .all()
                )
                session_ids = list({n.session_id for n in nodes})
                if session_ids:
                    result = await self._backend.cleanup_sessions(session_ids)
                    for sid, status in result.items():
                        details[sid] = status
                        if status == "cleaned":
                            cleaned += 1
                            for n in nodes:
                                if n.session_id == sid:
                                    n.status = "cleaned_up"
                        else:
                            failed += 1
                    db.commit()

        return {"cleaned": cleaned, "failed": failed, "details": details}


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------


def _map_node_status(node_status: str) -> str:
    """Map ExecutionNode status to session status."""
    if node_status in ("pending", "running"):
        return "active"
    if node_status == "completed":
        return "inactive"
    if node_status == "cleaned_up":
        return "cleaned_up"
    return "unknown"
