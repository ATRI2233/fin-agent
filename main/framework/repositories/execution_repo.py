"""Repository for workflow execution and execution node persistence."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from main.framework.models.database import SessionLocal
from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution


class ExecutionRepository:
    """Encapsulates all DB operations for WorkflowExecution and ExecutionNode."""

    def __init__(self, session_factory=SessionLocal):
        self._sf = session_factory

    # ------------------------------------------------------------------
    # WorkflowExecution
    # ------------------------------------------------------------------

    def list_executions(
        self,
        workflow_id: str | None = None,
        status: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """List executions with optional filters. Returns (items, total)."""
        with self._sf() as db:
            q = db.query(WorkflowExecution)
            if workflow_id:
                q = q.filter(WorkflowExecution.workflow_id == workflow_id)
            if status:
                q = q.filter(WorkflowExecution.status == status)
            total = q.count()
            rows = (
                q.order_by(WorkflowExecution.started_at.desc())
                .offset(offset)
                .limit(limit)
                .all()
            )
            items = []
            for ex in rows:
                nodes = (
                    db.query(ExecutionNode)
                    .filter(ExecutionNode.execution_id == ex.id)
                    .all()
                )
                completed = sum(1 for n in nodes if n.status == "completed")
                failed = sum(1 for n in nodes if n.status == "failed")
                duration = None
                if ex.started_at and ex.completed_at:
                    duration = (ex.completed_at - ex.started_at).total_seconds()
                items.append({
                    "id": ex.id,
                    "workflow_id": ex.workflow_id,
                    "status": ex.status,
                    "started_at": ex.started_at.isoformat() if ex.started_at else None,
                    "completed_at": ex.completed_at.isoformat() if ex.completed_at else None,
                    "duration_seconds": duration,
                    "node_count": len(nodes),
                    "completed_nodes": completed,
                    "failed_nodes": failed,
                })
            return items, total

    def get_execution_timeline(self, execution_id: str) -> list[dict]:
        """Get node-level timeline for an execution."""
        with self._sf() as db:
            nodes = (
                db.query(ExecutionNode)
                .filter(ExecutionNode.execution_id == execution_id)
                .order_by(ExecutionNode.started_at.asc())
                .all()
            )
            timeline = []
            for n in nodes:
                duration = None
                if n.started_at and n.completed_at:
                    duration = (n.completed_at - n.started_at).total_seconds()
                timeline.append({
                    "node_id": n.node_id,
                    "agent": n.agent,
                    "status": n.status,
                    "started_at": n.started_at.isoformat() if n.started_at else None,
                    "completed_at": n.completed_at.isoformat() if n.completed_at else None,
                    "duration_seconds": duration,
                    "hapi_session_id": n.hapi_session_id,
                    "retry_count": n.retry_count or 0,
                })
            return timeline

    def create_execution(self, workflow_id: str, **kwargs: Any) -> WorkflowExecution:
        with self._sf() as db:
            exec_ = WorkflowExecution(workflow_id=workflow_id, **kwargs)
            db.add(exec_)
            db.commit()
            db.refresh(exec_)
            return exec_

    def get_execution(self, execution_id: str) -> WorkflowExecution | None:
        with self._sf() as db:
            return db.query(WorkflowExecution).get(execution_id)

    def update_execution(self, execution_id: str, **kwargs: Any) -> None:
        with self._sf() as db:
            exec_ = db.query(WorkflowExecution).get(execution_id)
            if exec_:
                for k, v in kwargs.items():
                    setattr(exec_, k, v)
                db.commit()

    # ------------------------------------------------------------------
    # ExecutionNode
    # ------------------------------------------------------------------

    def create_node(
        self, execution_id: str, node_id: str, agent: str, **kwargs: Any
    ) -> ExecutionNode:
        with self._sf() as db:
            node = ExecutionNode(
                execution_id=execution_id,
                node_id=node_id,
                agent=agent,
                **kwargs,
            )
            db.add(node)
            db.commit()
            db.refresh(node)
            return node

    def get_node(
        self, node_id: str, execution_id: str
    ) -> ExecutionNode | None:
        with self._sf() as db:
            return (
                db.query(ExecutionNode)
                .filter(
                    ExecutionNode.execution_id == execution_id,
                    ExecutionNode.node_id == node_id,
                )
                .first()
            )

    def update_node(
        self, node_id: str, execution_id: str, **kwargs: Any
    ) -> None:
        with self._sf() as db:
            node = (
                db.query(ExecutionNode)
                .filter(
                    ExecutionNode.execution_id == execution_id,
                    ExecutionNode.node_id == node_id,
                )
                .first()
            )
            if node:
                for k, v in kwargs.items():
                    setattr(node, k, v)
                db.commit()

    def get_execution_nodes(self, execution_id: str) -> list[ExecutionNode]:
        with self._sf() as db:
            return (
                db.query(ExecutionNode)
                .filter(ExecutionNode.execution_id == execution_id)
                .all()
            )

    def get_failed_nodes(self, execution_id: str) -> list[ExecutionNode]:
        with self._sf() as db:
            return (
                db.query(ExecutionNode)
                .filter(
                    ExecutionNode.execution_id == execution_id,
                    ExecutionNode.status == "failed",
                )
                .all()
            )

    def mark_node_completed(
        self, node_id: str, execution_id: str, output: dict, session_id: str = ""
    ) -> None:
        self.update_node(
            node_id,
            execution_id,
            status="completed",
            output=output,
            completed_at=datetime.now(timezone.utc),
            hapi_session_id=session_id,
        )

    def mark_node_failed(
        self, node_id: str, execution_id: str, error: str
    ) -> None:
        self.update_node(node_id, execution_id, status="failed", error=error)
