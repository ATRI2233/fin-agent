"""SQLAlchemy implementation of ``ConversationService`` (async).

All write methods open a fresh ``UnitOfWork`` via the injected
``UoWFactory`` and operate on the ORM session inside the ``with`` block.
The UoW ``__exit__`` handles commit/rollback automatically — successful
exit commits, raised exceptions roll back. Read methods also use the
UoW session to ensure a single, consistent view (matching the pattern
established by ``SqlAlchemyExecutionRecorder``).

Design contract:
    - All 5 Protocol methods are ``async`` (matches
      ``ConversationService`` Protocol from TASK-401).
    - Write methods wrap any ``SQLAlchemyError`` in
      :class:`src.main.infra.errors.DatabaseError` and re-raise so the
      caller (TASK-404 service layer) sees it.
    - ``MessageId`` is a forward ref on the domain ``Message`` dataclass
      (TASK-402). Until ``infra.domain`` exports ``MessageId`` we mint
      IDs as plain UUID4 strings and pass them straight through, so the
      domain ``Message.id`` slot remains a forward ref string at runtime.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import NewType

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from src.main.infra.domain import AgentReference, ConversationId
from src.main.infra.errors import DatabaseError
from src.main.infra.uow import UoWFactory
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

    Constructed with a :class:`UoWFactory`; every method opens its own
    UoW so each write is a discrete transaction. Read methods use the
    UoW session directly (no ``expire_on_commit`` issue because we map
    to dataclasses before the UoW exits).
    """

    def __init__(self, uow_factory: UoWFactory) -> None:
        self._uow = uow_factory

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

        Args:
            agent: Owning Agent reference (only ``name`` is persisted).
            title: Optional user/system-supplied title.

        Returns:
            The newly created :class:`Conversation` domain entity.

        Raises:
            DatabaseError: on any underlying SQLAlchemy failure.
        """
        conversation_id = ConversationId(_new_id())
        now = _now()
        with self._uow.begin() as uow:
            try:
                orm_row = ConversationORM(
                    id=str(conversation_id),
                    agent_name=agent.name,
                    title=title,
                    created_at=now,
                    updated_at=now,
                )
                uow.session.add(orm_row)
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
        """Fetch a single conversation by id.

        Args:
            conversation_id: Target conversation ID.

        Returns:
            The matching :class:`Conversation`, or ``None`` if no row
            exists.

        Raises:
            DatabaseError: on any underlying SQLAlchemy failure.
        """
        with self._uow.begin() as uow:
            try:
                session: Session = uow.session
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
        """List conversations, newest first.

        Results are ordered by ``updated_at`` descending (most recently
        changed first), which is the most useful ordering for a chat UI.

        Args:
            limit: Maximum number of rows to return.
            offset: Number of rows to skip (pagination).

        Returns:
            List of :class:`Conversation` (possibly empty).

        Raises:
            DatabaseError: on any underlying SQLAlchemy failure.
        """
        with self._uow.begin() as uow:
            try:
                session: Session = uow.session
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

        Both writes happen in the same UoW so the message and the
        updated timestamp land atomically — readers can never observe a
        message without the corresponding ``updated_at`` bump.

        Args:
            conversation_id: Owning conversation ID.
            role: Message role (user / assistant / system).
            content: Message body text.

        Returns:
            The newly appended :class:`Message` domain entity.

        Raises:
            DatabaseError: on any underlying SQLAlchemy failure.
        """
        message_id = MessageId(_new_id())  # type: ignore[valid-type]
        now = _now()
        with self._uow.begin() as uow:
            try:
                session: Session = uow.session
                # Refresh parent so the updated_at bump lands atomically
                # with the new message row.
                parent = (
                    session.query(ConversationORM)
                    .filter(ConversationORM.id == str(conversation_id))
                    .one_or_none()
                )
                if parent is None:
                    # No row to bump; the FK on messages.conversation_id
                    # would surface this as an IntegrityError, but we
                    # raise a clear error first for better diagnostics.
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
        """List messages for one conversation, oldest first.

        Results are ordered by ``created_at`` ascending so callers get a
        coherent transcript order. Messages whose ``conversation_id``
        does not match are filtered out (defensive — FK prevents the
        insert from happening in the first place).

        Args:
            conversation_id: Owning conversation ID.
            limit: Maximum number of rows to return.
            offset: Number of rows to skip (pagination).

        Returns:
            List of :class:`Message` (possibly empty).

        Raises:
            DatabaseError: on any underlying SQLAlchemy failure.
        """
        with self._uow.begin() as uow:
            try:
                session: Session = uow.session
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