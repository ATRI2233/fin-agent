"""SQLAlchemy implementation of ``ConversationService`` (async).

All methods open a fresh ``Session`` via the injected ``session_factory``
and operate inside a ``with`` block. Write methods wrap the session body in
an additional ``with session.begin():`` so commit/rollback is automatic.
Read methods use the session directly (no transaction needed).

This keeps the repository pattern consistent with
``SqlAlchemyExecutionReader`` and ``SqlAlchemyWorkflowRepository``.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Callable, NewType

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from src.main.infra.domain import AgentReference, ConversationId
from src.main.infra.errors import DatabaseError
from src.main.modules.conversation.domain.conversation import Conversation
from src.main.modules.conversation.domain.message import Message, MessageRole
from src.main.modules.conversation.repo.orm import ConversationORM, MessageORM

# Local placeholder NewType for Message.id — matches the domain forward
# ref "MessageId" declared in TASK-402. Will be replaced by the
# ``infra.domain.MessageId`` NewType once TASK-002 lands it.
MessageId = NewType("MessageId", str)


def _now() -> datetime:
    """UTC ``datetime`` for ``created_at`` / ``updated_at``."""
    return datetime.now(timezone.utc)


def _new_id() -> str:
    """Generate a fresh UUID4 string ID."""
    return str(uuid.uuid4())


def _to_conversation(row: ConversationORM) -> Conversation:
    """Convert a ``ConversationORM`` row to the domain dataclass."""
    return Conversation(
        id=ConversationId(row.id),
        agent=AgentReference(name=row.agent_name, definition_path=None),
        title=row.title,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _to_message(row: MessageORM) -> Message:
    """Convert a ``MessageORM`` row to the domain dataclass."""
    return Message(
        id=MessageId(row.id),  # type: ignore[arg-type]
        conversation_id=ConversationId(row.conversation_id),
        role=MessageRole(row.role),
        content=row.content,
        created_at=row.created_at,
    )


class SqlAlchemyConversationRepository:
    """Async SQLAlchemy repository for conversations and messages.

    Constructed with a ``session_factory``-compatible callable (``() ->
    Session``). Every method opens its own session and closes it when the
    ``with`` block exits. Write methods additionally use
    ``with session.begin():`` to enforce a transaction boundary.
    """

    def __init__(self, session_factory: Callable[[], Session] | sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    # ── helpers (private) ──

    def _wrap(self, exc: SQLAlchemyError, op: str, **details: object) -> DatabaseError:
        """Translate a SQLAlchemy failure into a structured DatabaseError."""
        return DatabaseError(
            f"conversation repository failed: {op}",
            details=details,
            cause=exc,
        )

    # ── ConversationService (5 async methods) ──

    async def create(
        self,
        agent: AgentReference,
        title: str | None,
    ) -> Conversation:
        """Insert a new ``conversations`` row and return the domain entity.

        ``created_at`` and ``updated_at`` are stamped to the same UTC
        ``datetime`` because the row is brand new (no messages yet).
        """
        conversation_id = ConversationId(_new_id())
        now = _now()
        with self._session_factory() as session:
            with session.begin():
                try:
                    orm_row = ConversationORM(
                        id=str(conversation_id),
                        agent_name=agent.name,
                        title=title,
                        created_at=now,
                        updated_at=now,
                    )
                    session.add(orm_row)
                except SQLAlchemyError as exc:
                    raise self._wrap(
                        exc,
                        "create",
                        agent_name=agent.name,
                    ) from exc
        return Conversation(
            id=conversation_id,
            agent=AgentReference(name=agent.name, definition_path=None),
            title=title,
            created_at=now,
            updated_at=now,
        )

    async def get(
        self,
        conversation_id: ConversationId,
    ) -> Conversation | None:
        """Fetch a single conversation by id."""
        with self._session_factory() as session:
            try:
                row = (
                    session.query(ConversationORM)
                    .filter(ConversationORM.id == str(conversation_id))
                    .one_or_none()
                )
                if row is None:
                    return None
                return _to_conversation(row)
            except SQLAlchemyError as exc:
                raise self._wrap(
                    exc,
                    "get",
                    conversation_id=str(conversation_id),
                ) from exc

    async def list(
        self,
        *,
        limit: int,
        offset: int,
    ) -> list[Conversation]:
        """List conversations, newest first."""
        with self._session_factory() as session:
            try:
                rows = (
                    session.query(ConversationORM)
                    .order_by(ConversationORM.updated_at.desc())
                    .offset(offset)
                    .limit(limit)
                    .all()
                )
                return [_to_conversation(r) for r in rows]
            except SQLAlchemyError as exc:
                raise self._wrap(
                    exc,
                    "list",
                    limit=limit,
                    offset=offset,
                ) from exc

    async def append_message(
        self,
        conversation_id: ConversationId,
        role: MessageRole,
        content: str,
    ) -> Message:
        """Insert a new ``messages`` row and bump the parent's ``updated_at``.

        Both writes happen in the same transaction so the message and the
        updated timestamp land atomically.
        """
        message_id = MessageId(_new_id())  # type: ignore[valid-type]
        now = _now()
        with self._session_factory() as session:
            with session.begin():
                try:
                    parent = (
                        session.query(ConversationORM)
                        .filter(ConversationORM.id == str(conversation_id))
                        .one_or_none()
                    )
                    if parent is None:
                        raise DatabaseError(
                            "conversation repository failed: append_message",
                            details={
                                "reason": "conversation_not_found",
                                "conversation_id": str(conversation_id),
                            },
                        )
                    parent.updated_at = now
                    orm_row = MessageORM(
                        id=str(message_id),
                        conversation_id=str(conversation_id),
                        role=role.value,
                        content=content,
                        created_at=now,
                    )
                    session.add(orm_row)
                except SQLAlchemyError as exc:
                    raise self._wrap(
                        exc,
                        "append_message",
                        conversation_id=str(conversation_id),
                        role=role.value,
                    ) from exc
        return Message(
            id=message_id,  # type: ignore[arg-type]
            conversation_id=conversation_id,
            role=role,
            content=content,
            created_at=now,
        )

    async def get_messages(
        self,
        conversation_id: ConversationId,
        *,
        limit: int,
        offset: int,
    ) -> list[Message]:
        """List messages for one conversation, oldest first."""
        with self._session_factory() as session:
            try:
                rows = (
                    session.query(MessageORM)
                    .filter(MessageORM.conversation_id == str(conversation_id))
                    .order_by(MessageORM.created_at.asc())
                    .offset(offset)
                    .limit(limit)
                    .all()
                )
                return [_to_message(r) for r in rows]
            except SQLAlchemyError as exc:
                raise self._wrap(
                    exc,
                    "get_messages",
                    conversation_id=str(conversation_id),
                    limit=limit,
                    offset=offset,
                ) from exc


__all__ = ["SqlAlchemyConversationRepository", "_to_conversation", "_to_message"]
