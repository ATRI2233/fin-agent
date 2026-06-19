"""SQLAlchemy-backed implementation of :class:`ConversationService`.

This is a thin wrapper that delegates every call to the injected
:class:`SqlAlchemyConversationRepository`. The service layer exists to
satisfy the Protocol boundary and to leave room for cross-cutting
concerns (logging, trace_id injection, etc.) without polluting the
repository.

Design contract:
    - All 5 Protocol methods are ``async`` and delegate straight to
      ``self.repo``; no I/O happens here.
    - The service does **not** open or close database sessions — that
      is the repository's responsibility (Do Not #5).
    - No cross-module ``from X import _xxx`` reaches into repo internals
      (Do Not #1).
"""

from __future__ import annotations

from src.main.infra.domain import AgentReference, ConversationId
from src.main.modules.conversation.domain.conversation import Conversation
from src.main.modules.conversation.domain.message import Message, MessageRole
from src.main.modules.conversation.protocol import ConversationService
from src.main.modules.conversation.repo.conversation_repo import (
    SqlAlchemyConversationRepository,
)


class DefaultConversationService(ConversationService):
    """Thin Protocol-conforming facade over a conversation repository.

    Args:
        repo: The async repository to delegate every call to.
    """

    def __init__(self, repo: SqlAlchemyConversationRepository) -> None:
        self.repo = repo

    async def create(
        self,
        agent: AgentReference,
        title: str | None,
    ) -> Conversation:
        """Create a new conversation (delegates to ``repo.create``)."""
        return await self.repo.create(agent, title)

    async def list(
        self,
        *,
        limit: int,
        offset: int,
    ) -> list[Conversation]:
        """List conversations, newest first (delegates to ``repo.list``)."""
        return await self.repo.list(limit=limit, offset=offset)

    async def get(
        self,
        conversation_id: ConversationId,
    ) -> Conversation | None:
        """Fetch one conversation by id (delegates to ``repo.get``)."""
        return await self.repo.get(conversation_id)

    async def append_message(
        self,
        conversation_id: ConversationId,
        role: MessageRole,
        content: str,
    ) -> Message:
        """Append a message to a conversation (delegates to ``repo.append_message``)."""
        return await self.repo.append_message(conversation_id, role, content)

    async def get_messages(
        self,
        conversation_id: ConversationId,
        *,
        limit: int,
        offset: int,
    ) -> list[Message]:
        """List messages for a conversation (delegates to ``repo.get_messages``)."""
        return await self.repo.get_messages(
            conversation_id,
            limit=limit,
            offset=offset,
        )


__all__ = ["DefaultConversationService"]
