"""Session management — workflow boundaries and conversation-to-session mapping."""

from __future__ import annotations

import logging

from main.framework.core.protocols import AgentBackend

logger = logging.getLogger(__name__)


class SessionManager:
    def __init__(self, backend: AgentBackend):
        self._backend = backend
        self._boundaries: dict[str, set[str]] = {}
        self._node_to_boundary: dict[str, str] = {}

    def create_session_boundary(self, node_ids: list[int | str]) -> str:
        boundary_id = f"boundary_{len(self._boundaries) + 1}"
        self._boundaries[boundary_id] = set(str(n) for n in node_ids)
        for node_id in node_ids:
            self._node_to_boundary[str(node_id)] = boundary_id
        return boundary_id

    def get_boundary_sessions(self) -> dict[str, set[str]]:
        return dict(self._boundaries)

    def get_session_for_node(self, node_id: int | str) -> str | None:
        boundary_id = self._node_to_boundary.get(str(node_id))
        if boundary_id:
            return boundary_id
        return None

    async def cleanup_session(self, session_id: str) -> dict:
        return await self._backend.cleanup_sessions([session_id])

    async def cleanup_all_sessions(self) -> dict:
        all_boundary_ids = list(self._boundaries.keys())
        results = {}
        if all_boundary_ids:
            results = await self._backend.cleanup_sessions(all_boundary_ids)
        self._boundaries.clear()
        self._node_to_boundary.clear()
        return results


class ConvSessionManager:
    """Manages the mapping between conversations and agent sessions."""

    def __init__(self, backend: AgentBackend):
        self._backend = backend
        self._session_ids: dict[str, str] = {}  # conversation_id -> session_id

    async def get_or_create_session(
        self, conversation_id: str, agent: str = "opencode", db=None
    ) -> tuple[str, AgentBackend]:
        """Get or create a session for a conversation."""
        from main.framework.models.conversation import Conversation

        if conversation_id in self._session_ids:
            return self._session_ids[conversation_id], self._backend

        # Check DB for persisted session
        if db is not None:
            conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
            if conversation and conversation.session_id:
                self._session_ids[conversation_id] = conversation.session_id
                return conversation.session_id, self._backend

        # Create new session with the target agent
        session_id = await self._backend.create_session(agent=agent)

        if db is not None:
            conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
            if conversation:
                conversation.session_id = session_id
                db.commit()

        self._session_ids[conversation_id] = session_id
        return session_id, self._backend

    async def cleanup_session(self, conversation_id: str, db=None) -> str | None:
        """Delete session for a conversation."""
        from main.framework.models.conversation import Conversation

        session_id = self._session_ids.pop(conversation_id, None)

        if not session_id and db is not None:
            conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
            if conversation:
                session_id = conversation.session_id

        if not session_id:
            return None

        try:
            await self._backend.cleanup_sessions([session_id])
        except Exception as e:
            logger.warning(f"Failed to cleanup session {session_id}: {e}")

        return session_id

    def get_session_id(self, conversation_id: str) -> str | None:
        return self._session_ids.get(conversation_id)
