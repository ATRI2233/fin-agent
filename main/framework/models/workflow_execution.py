from uuid import uuid4

from sqlalchemy import Column, String, DateTime, JSON, Integer, ForeignKey
from sqlalchemy.orm import relationship

from main.framework.models.database import Base
from datetime import datetime, timezone


class WorkflowExecution(Base):
    __tablename__ = "workflow_executions"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    workflow_id = Column(String, nullable=False)
    conversation_id = Column(String, ForeignKey("conversations.id"), nullable=True)
    status = Column(String, default="pending")
    started_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime, nullable=True)
    results = Column(JSON, default=dict)
    errors = Column(JSON, default=list)

    # Relationships
    conversation = relationship("Conversation", back_populates="executions")


class ExecutionNode(Base):
    __tablename__ = "execution_nodes"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    execution_id = Column(String, nullable=False)
    node_id = Column(String, nullable=False)
    agent = Column(String, nullable=False)
    status = Column(String, default="pending")
    session_id = Column("hapi_session_id", String, nullable=True)
    input = Column(JSON, default=dict)
    output = Column(JSON, default=dict)
    error = Column(String, nullable=True)
    retry_count = Column(Integer, default=0)
    started_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime, nullable=True)