"""Conversation and Message models."""

from datetime import UTC, datetime, timezone

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from main.framework.models.database import Base


class Conversation(Base):
    """User conversation with persistent agent session."""

    __tablename__ = "conversations"

    id = Column(String, primary_key=True)
    title = Column(String, default="New Conversation")
    session_id = Column("hapi_session_id", String, nullable=True)  # Agent session ID
    current_agent = Column(String, default="fin-orchestrator")
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))

    # Relationships
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")
    executions = relationship("WorkflowExecution", back_populates="conversation", cascade="all, delete-orphan")


class Message(Base):
    """Message in a conversation."""

    __tablename__ = "messages"

    id = Column(String, primary_key=True)
    conversation_id = Column(String, ForeignKey("conversations.id"), nullable=False)
    role = Column(String, nullable=False)  # user, assistant, system, workflow
    content = Column(Text, nullable=False)
    agent = Column(String, nullable=True)  # Which agent responded
    workflow_id = Column(String, nullable=True)  # If from workflow execution
    execution_id = Column(String, nullable=True)  # If from workflow execution
    extra_data = Column(JSON, nullable=True)  # Extra data (tools used, etc.)
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))

    # Relationships
    conversation = relationship("Conversation", back_populates="messages")