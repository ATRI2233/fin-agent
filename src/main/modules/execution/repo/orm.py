"""SQLAlchemy ORM models for the execution module.

This module defines three ORM classes:

- ``WorkflowExecutionORM``: maps to ``workflow_executions`` (one row per
  workflow execution instance).
- ``ExecutionNodeORM``: maps to ``execution_nodes`` (one row per node
  executed within a workflow execution; FK to ``workflow_executions``).
- ``ExecutionLogORM``: maps to ``execution_logs`` (v2.1 §7.4 audit/event
  stream; FK to ``workflow_executions``).

All three inherit from :class:`src.main.infra.db.Base` and use UUID
strings for primary keys so the schema is consistent with the rest of
the project. JSON-shaped fields use SQLAlchemy's ``JSON`` type, which
is transparently serialized to TEXT under SQLite.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.main.infra.db import Base


class WorkflowExecutionORM(Base):
    """ORM for a single workflow execution instance.

    Corresponds to the domain
    :class:`src.main.modules.execution.domain.execution.WorkflowExecution`.
    """

    __tablename__ = "workflow_executions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    workflow_id: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    params: Mapped[dict] = mapped_column(JSON, nullable=False)
    trace_id: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ExecutionNodeORM(Base):
    """ORM for a single node inside a workflow execution.

    Corresponds to the domain
    :class:`src.main.modules.execution.domain.execution_node.ExecutionNode`.
    """

    __tablename__ = "execution_nodes"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    execution_id: Mapped[str] = mapped_column(
        String, ForeignKey("workflow_executions.id"), nullable=False
    )
    node_id: Mapped[str] = mapped_column(String, nullable=False)
    agent: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    input: Mapped[dict] = mapped_column(JSON, nullable=False)
    output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    session_id: Mapped[str | None] = mapped_column(String, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ExecutionLogORM(Base):
    """ORM for execution_log entries (v2.1 §7.4).

    Append-only audit/event stream for workflow executions. Both
    ``node_id`` and ``agent_name`` are nullable because some events
    are execution-level rather than node-level; ``event`` and
    ``trace_id`` are always present.
    """

    __tablename__ = "execution_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    execution_id: Mapped[str] = mapped_column(
        String, ForeignKey("workflow_executions.id"), nullable=False
    )
    node_id: Mapped[str | None] = mapped_column(String, nullable=True)
    agent_name: Mapped[str | None] = mapped_column(String, nullable=True)
    event: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    trace_id: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)