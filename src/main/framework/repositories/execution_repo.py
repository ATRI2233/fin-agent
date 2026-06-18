"""Repository for workflow execution and execution node persistence."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any, cast

from main.framework.models.database import SessionLocal
from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution
from main.framework.repositories.base import BaseRepository
from sqlalchemy.orm import Session


class ExecutionRepository(BaseRepository[WorkflowExecution]):
    """Encapsulates all DB operations for WorkflowExecution and ExecutionNode.

    Supports two modes:
    - **Legacy** (default): ``session_factory`` creates a fresh session per
      operation and commits internally — fully backward-compatible.
    - **DI**: pass ``db=`` from an external caller who owns transaction
      boundaries (Unit-of-Work style).
    """

    def __init__(self, session_factory=SessionLocal, db: Session | None = None):
        self._sf = session_factory
        self._model = WorkflowExecution
        self._db = db
        self._is_di = db is not None

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

    def get(self, id: str) -> WorkflowExecution | None:
        """Get execution by primary key."""
        with self._session() as db:
            return db.get(WorkflowExecution, id)

    def list(self, limit: int = 100, offset: int = 0, **filters: Any) -> list[WorkflowExecution]:
        """List executions with optional filters."""
        with self._session() as db:
            query = db.query(WorkflowExecution)
            for key, value in filters.items():
                if hasattr(WorkflowExecution, key):
                    query = query.filter(getattr(WorkflowExecution, key) == value)
            return query.limit(limit).offset(offset).all()

    def create(self, **kwargs: Any) -> WorkflowExecution:
        """Create new execution."""
        with self._session() as db:
            entity = WorkflowExecution(**kwargs)
            db.add(entity)
            db.commit()
            db.refresh(entity)
            return entity

    def update(self, id: str, **kwargs: Any) -> WorkflowExecution | None:
        """Update execution by id."""
        with self._session() as db:
            entity = db.get(WorkflowExecution, id)
            if entity is None:
                return None
            for key, value in kwargs.items():
                if hasattr(entity, key):
                    setattr(entity, key, value)
            db.commit()
            return entity

    def delete(self, id: str) -> bool:
        """Delete execution by id (cascades to ExecutionNode records)."""
        with self._session() as db:
            entity = db.get(WorkflowExecution, id)
            if entity is None:
                return False
            # Delete child ExecutionNode records first
            db.query(ExecutionNode).filter(ExecutionNode.execution_id == id).delete(synchronize_session=False)
            db.delete(entity)
            db.commit()
            return True

    def count(self, **filters: Any) -> int:
        """Count executions matching filters."""
        with self._session() as db:
            query = db.query(WorkflowExecution)
            for key, value in filters.items():
                if hasattr(WorkflowExecution, key):
                    query = query.filter(getattr(WorkflowExecution, key) == value)
            return query.count()

    def exists(self, id: str) -> bool:
        """Check if execution exists."""
        with self._session() as db:
            return db.query(WorkflowExecution).filter_by(id=id).first() is not None

    # ------------------------------------------------------------------
    # v2 API (DI-friendly, caller manages transactions)
    # ------------------------------------------------------------------

    def create_execution_v2(self, db: Session, **kwargs: Any) -> WorkflowExecution:
        """Create execution with external session. Caller manages commit."""
        entity = WorkflowExecution(**kwargs)
        db.add(entity)
        db.flush()
        return entity

    # ------------------------------------------------------------------
    # WorkflowExecution (legacy API — all signatures preserved)
    # ------------------------------------------------------------------

    def list_executions(
        self,
        workflow_id: str | None = None,
        conversation_id: str | None = None,
        status: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """List executions with optional filters. Returns (items, total)."""
        with self._session() as db:
            q = db.query(WorkflowExecution)
            if workflow_id:
                q = q.filter(WorkflowExecution.workflow_id == workflow_id)
            if conversation_id:
                q = q.filter(WorkflowExecution.conversation_id == conversation_id)
            if status:
                q = q.filter(WorkflowExecution.status == status)
            total = q.count()
            rows = q.order_by(WorkflowExecution.started_at.desc()).offset(offset).limit(limit).all()
            items = []
            for ex in rows:
                nodes = db.query(ExecutionNode).filter(ExecutionNode.execution_id == ex.id).all()
                completed = sum(1 for n in nodes if n.status == "completed")
                failed = sum(1 for n in nodes if n.status == "failed")
                duration = None
                if ex.started_at and ex.completed_at:
                    duration = (ex.completed_at - ex.started_at).total_seconds()
                items.append(
                    {
                        "id": ex.id,
                        "workflow_id": ex.workflow_id,
                        "status": ex.status,
                        "started_at": (ex.started_at.isoformat() if ex.started_at else None),
                        "completed_at": (ex.completed_at.isoformat() if ex.completed_at else None),
                        "duration_seconds": duration,
                        "node_count": len(nodes),
                        "completed_nodes": completed,
                        "failed_nodes": failed,
                    }
                )
            return items, total

    def get_execution_timeline(self, execution_id: str) -> list[dict]:
        """Get node-level timeline for an execution."""
        with self._session() as db:
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
                timeline.append(
                    {
                        "node_id": n.node_id,
                        "agent": n.agent,
                        "status": n.status,
                        "started_at": (n.started_at.isoformat() if n.started_at else None),
                        "completed_at": (n.completed_at.isoformat() if n.completed_at else None),
                        "duration_seconds": duration,
                        "session_id": n.session_id,
                        "retry_count": n.retry_count or 0,
                    }
                )
            return timeline

    def create_execution(self, workflow_id: str, **kwargs: Any) -> WorkflowExecution:
        with self._session() as db:
            exec_ = WorkflowExecution(workflow_id=workflow_id, **kwargs)
            db.add(exec_)
            db.commit()
            db.refresh(exec_)
            return exec_

    def get_execution(self, execution_id: str) -> WorkflowExecution | None:
        with self._session() as db:
            return db.query(WorkflowExecution).get(execution_id)

    def update_execution(self, execution_id: str, **kwargs: Any) -> None:
        with self._session() as db:
            exec_ = db.query(WorkflowExecution).get(execution_id)
            if exec_:
                for k, v in kwargs.items():
                    setattr(exec_, k, v)
                db.commit()

    # ------------------------------------------------------------------
    # ExecutionNode
    # ------------------------------------------------------------------

    def create_node(self, execution_id: str, node_id: str, agent: str, **kwargs: Any) -> ExecutionNode:
        with self._session() as db:
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

    def get_node(self, node_id: str, execution_id: str) -> ExecutionNode | None:
        with self._session() as db:
            return (
                db.query(ExecutionNode)
                .filter(
                    ExecutionNode.execution_id == execution_id,
                    ExecutionNode.node_id == node_id,
                )
                .first()
            )

    def update_node(self, node_id: str, execution_id: str, **kwargs: Any) -> None:
        with self._session() as db:
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
        with self._session() as db:
            return db.query(ExecutionNode).filter(ExecutionNode.execution_id == execution_id).all()

    def get_failed_nodes(self, execution_id: str) -> list[ExecutionNode]:
        with self._session() as db:
            return (
                db.query(ExecutionNode)
                .filter(
                    ExecutionNode.execution_id == execution_id,
                    ExecutionNode.status == "failed",
                )
                .all()
            )

    def mark_node_completed(self, node_id: str, execution_id: str, output: dict, session_id: str = "") -> None:
        self.update_node(
            node_id,
            execution_id,
            status="completed",
            output=output,
            completed_at=datetime.now(UTC),
            session_id=session_id,
        )

    def mark_node_failed(self, node_id: str, execution_id: str, error: str) -> None:
        self.update_node(node_id, execution_id, status="failed", error=error)

    # ------------------------------------------------------------------
    # Workflow helpers (used by executions API)
    # ------------------------------------------------------------------

    def get_workflow_names(self, workflow_ids: list[str]) -> dict[str, str]:
        """Return {workflow_id: name} for the given IDs."""
        from main.framework.models.workflow import Workflow

        with self._session() as db:
            rows = db.query(Workflow).filter(Workflow.id.in_(workflow_ids)).all()
            return {str(w.id): str(w.name) for w in rows}

    def get_execution_detail(self, execution_id: str) -> tuple[WorkflowExecution | None, list[ExecutionNode], Any]:
        """Return (execution, nodes, workflow) in one call.

        ``workflow`` may be ``None`` if the referenced workflow no longer
        exists.
        """
        from main.framework.models.workflow import Workflow

        with self._session() as db:
            execution = db.get(WorkflowExecution, execution_id)
            if execution is None:
                return None, [], None
            nodes = db.query(ExecutionNode).filter(ExecutionNode.execution_id == execution_id).all()
            workflow = db.get(Workflow, execution.workflow_id)
            return execution, nodes, workflow

    def get_first_node_input(self, execution_id: str) -> dict[str, Any]:
        """Return the ``input`` payload of the first node (or ``{}``)."""
        with self._session() as db:
            node = db.query(ExecutionNode).filter(ExecutionNode.execution_id == execution_id).first()
            if node is not None and node.input: # type: ignore[truthy-bool]
                return dict(node.input) # type: ignore[arg-type]
            return {}

    def get_workflow(self, workflow_id: str) -> Any:
        """Return the Workflow ORM instance (or ``None``)."""
        from main.framework.models.workflow import Workflow

        with self._session() as db:
            return db.get(Workflow, workflow_id)

    def create_execution_with_nodes(
        self,
        workflow_id: str,
        nodes_data: list[dict[str, Any]],
        params: dict[str, Any],
    ) -> tuple[str, list[ExecutionNode]]:
        """Atomically create a pending execution and its nodes.

        Returns ``(execution_id, nodes)``.
        """
        with self._session() as db:
            execution = WorkflowExecution(workflow_id=workflow_id, status="pending")
            db.add(execution)
            db.flush() # populate execution.id
            exec_id = str(execution.id)

            nodes: list[ExecutionNode] = []
            for node_data in nodes_data:
                agent = node_data.get("agent", "")
                if not agent:
                    data = node_data.get("data", {})
                    if isinstance(data, dict):
                        agent = data.get("agentType", "") or data.get("label", "")
                exec_node = ExecutionNode(
                    execution_id=exec_id,
                    node_id=node_data["id"],
                    agent=agent,
                    status="pending",
                    input=params,
                )
                db.add(exec_node)
                nodes.append(exec_node)
            db.commit()
            return exec_id, nodes
