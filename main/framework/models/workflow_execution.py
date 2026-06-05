from uuid import uuid4

from sqlalchemy import Column, String, DateTime, JSON, Integer

from main.framework.models.database import Base
from datetime import datetime


class WorkflowExecution(Base):
    __tablename__ = "workflow_executions"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    workflow_id = Column(String, nullable=False)
    status = Column(String, default="pending")
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    results = Column(JSON, default={})
    errors = Column(JSON, default=[])


class ExecutionNode(Base):
    __tablename__ = "execution_nodes"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    execution_id = Column(String, nullable=False)
    node_id = Column(String, nullable=False)
    agent = Column(String, nullable=False)
    status = Column(String, default="pending")
    hapi_session_id = Column(String, nullable=True)
    input = Column(JSON, default={})
    output = Column(JSON, default={})
    error = Column(String, nullable=True)
    retry_count = Column(Integer, default=0)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
