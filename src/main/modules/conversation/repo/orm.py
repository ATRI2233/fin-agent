"""SQLAlchemy ORM models for the conversation module.

Defines two ORM classes (one-to-many):

- ``ConversationORM``: maps to ``conversations`` (one row per
  conversation/session).
- ``MessageORM``: maps to ``messages`` (one row per chat message
  belonging to a conversation; FK to ``conversations``).

Both inherit from :class:`src.main.infra.db.Base` and use UUID strings
for primary keys, consistent with the rest of the project (see
``src.main.modules.execution.repo.orm`` for the same convention).
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.main.infra.db import Base

if TYPE_CHECKING:
    pass


class ConversationORM(Base):
    """ORM for a single conversation (chat session).

    Corresponds to the domain
    :class:`src.main.modules.conversation.domain.conversation.Conversation`.
    """

    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    agent_name: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, index=True
    )

    messages: Mapped[list["MessageORM"]] = relationship(
        "MessageORM",
        back_populates="conversation",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class MessageORM(Base):
    """ORM for a single chat message within a conversation.

    Corresponds to the domain
    :class:`src.main.modules.conversation.domain.message.Message`.
    """

    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    conversation: Mapped["ConversationORM"] = relationship(
        "ConversationORM",
        back_populates="messages",
        lazy="selectin",
    )