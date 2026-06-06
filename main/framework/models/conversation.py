"""Conversation and Message models."""

from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, JSON, ForeignKey, Integer
from sqlalchemy.orm import relationship
from main.framework.models.database import Base


class Conversation(Base):
    """User conversation with persistent HAPI session."""

    __tablename__ = "conversations"

    id = Column(String, primary_key=True)
    title = Column(String, default="New Conversation")
    hapi_session_id = Column(String, nullable=True)  # Persistent HAPI session
    current_agent = Column(String, default="fin-orchestrator")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

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
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    conversation = relationship("Conversation", back_populates="messages")