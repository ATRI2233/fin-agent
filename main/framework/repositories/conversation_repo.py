"""Repository for Conversation and Message persistence.

Extends BaseRepository[Conversation] with domain-specific queries
for messages and conversation management.
"""

from __future__ import annotations

import uuid
from typing import List

from sqlalchemy.orm import Session

from main.framework.models.conversation import Conversation, Message
from main.framework.repositories.base import BaseRepository


class ConversationRepository(BaseRepository[Conversation]):
    """CRUD + domain queries for Conversation and Message."""

    def __init__(self, db: Session) -> None:
        super().__init__(Conversation, db)

    # ------------------------------------------------------------------
    # Message operations
    # ------------------------------------------------------------------

    def add_message(
        self,
        conv_id: str,
        role: str,
        content: str,
        *,
        agent: str | None = None,
        workflow_id: str | None = None,
        execution_id: str | None = None,
        extra_data: dict | None = None,
    ) -> Message:
        """Create a message attached to *conv_id*. Does NOT commit."""
        msg = Message(
            id=str(uuid.uuid4()),
            conversation_id=conv_id,
            role=role,
            content=content,
            agent=agent,
            workflow_id=workflow_id,
            execution_id=execution_id,
            extra_data=extra_data,
        )
        self._db.add(msg)
        self._db.flush()
        return msg

    def get_messages(self, conv_id: str) -> List[Message]:
        """Return all messages for a conversation, ordered by creation time."""
        return (
            self._db.query(Message).filter(Message.conversation_id == conv_id).order_by(Message.created_at.asc()).all()
        )

    # ------------------------------------------------------------------
    # Conversation queries
    # ------------------------------------------------------------------

    def get_recent(self, limit: int = 20) -> List[Conversation]:
        """Return most recently updated conversations."""
        return self._db.query(Conversation).order_by(Conversation.updated_at.desc()).limit(limit).all()

    def delete_with_messages(self, conv_id: str) -> bool:
        """Delete a conversation and all its messages (cascade). Returns True if found."""
        conv = self.get(conv_id)
        if conv is None:
            return False
        self._db.delete(conv)
        self._db.flush()
        return True
