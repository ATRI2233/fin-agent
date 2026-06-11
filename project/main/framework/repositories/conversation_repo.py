"""Repository for Conversation and Message persistence.

Extends BaseRepository[Conversation] with domain-specific queries
for messages and conversation management.

Supports two modes:
- **Legacy** (default): `session_factory` creates a fresh session per
  operation and commits internally — fully backward-compatible.
- **DI**: pass `db=` from an external caller who owns transaction
  boundaries (Unit-of-Work style).
"""

from __future__ import annotations

import builtins
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import cast

from main.framework.models.conversation import Conversation, Message
from main.framework.models.database import SessionLocal
from main.framework.repositories.base import BaseRepository
from sqlalchemy.orm import Session


class ConversationRepository(BaseRepository[Conversation]):
    """CRUD + domain queries for Conversation and Message.

    Supports two modes:
    - **Legacy** (default): `session_factory` creates a fresh session per
      operation and commits internally — fully backward-compatible.
    - **DI**: pass `db=` from an external caller who owns transaction
      boundaries (Unit-of-Work style).
    """

    def __init__(self, session_factory=SessionLocal, db: Session | None = None):
        # Backward compat: if a Session is passed as first arg, treat as DI mode
        if isinstance(session_factory, Session):
            self._sf = SessionLocal
            self._db = session_factory
            self._is_di = True
        else:
            self._sf = session_factory
            self._db = db
            self._is_di = db is not None
        self._model = Conversation

    # ------------------------------------------------------------------
    # Session helper (dual-mode)
    # ------------------------------------------------------------------

    @contextmanager
    def _session(self) -> Iterator[Session]:
        """Yield a usable DB session — DI or factory-created."""
        if self._is_di:
            yield cast(Session, self._db)
        else:
            with self._sf() as db:
                yield db

    # ------------------------------------------------------------------
    # BaseRepository CRUD overrides (dual-mode aware)
    # ------------------------------------------------------------------

    def get(self, id: str) -> Conversation | None:
        """Get conversation by primary key."""
        with self._session() as db:
            return db.get(Conversation, id)

    def list(self, limit: int = 100, offset: int = 0, **filters) -> builtins.list[Conversation]:
        """List conversations with optional filters."""
        with self._session() as db:
            query = db.query(Conversation)
            for key, value in filters.items():
                if hasattr(Conversation, key):
                    query = query.filter(getattr(Conversation, key) == value)
            return query.limit(limit).offset(offset).all()

    def create(self, **kwargs) -> Conversation:
        """Create new conversation."""
        with self._session() as db:
            entity = Conversation(**kwargs)
            db.add(entity)
            db.commit()
            db.refresh(entity)
            return entity

    def update(self, id: str, **kwargs) -> Conversation | None:
        """Update conversation by id."""
        with self._session() as db:
            entity = db.get(Conversation, id)
            if entity is None:
                return None
            for key, value in kwargs.items():
                if hasattr(entity, key):
                    setattr(entity, key, value)
            db.commit()
            return entity

    def delete(self, id: str) -> bool:
        """Delete conversation by id."""
        with self._session() as db:
            entity = db.get(Conversation, id)
            if entity is None:
                return False
            db.delete(entity)
            db.commit()
            return True

    def count(self, **filters) -> int:
        """Count conversations matching filters."""
        with self._session() as db:
            query = db.query(Conversation)
            for key, value in filters.items():
                if hasattr(Conversation, key):
                    query = query.filter(getattr(Conversation, key) == value)
            return query.count()

    def exists(self, id: str) -> bool:
        """Check if conversation exists."""
        with self._session() as db:
            return db.query(Conversation).filter_by(id=id).first() is not None

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
        with self._session() as db:
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
            db.add(msg)
            db.flush()
            return msg

    def get_messages(self, conv_id: str) -> builtins.list[Message]:
        """Return all messages for a conversation, ordered by creation time."""
        with self._session() as db:
            return db.query(Message).filter(Message.conversation_id == conv_id).order_by(Message.created_at.asc()).all()

    # ------------------------------------------------------------------
    # Conversation queries
    # ------------------------------------------------------------------

    def get_recent(self, limit: int = 20) -> builtins.list[Conversation]:
        """Return most recently updated conversations."""
        with self._session() as db:
            return db.query(Conversation).order_by(Conversation.updated_at.desc()).limit(limit).all()

    def delete_with_messages(self, conv_id: str) -> bool:
        """Delete a conversation and all its messages (cascade). Returns True if found."""
        with self._session() as db:
            conv = db.get(Conversation, conv_id)
            if conv is None:
                return False
            db.delete(conv)
            db.commit()
            return True
