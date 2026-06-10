"""Repository for Workflow persistence."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, cast

from sqlalchemy.orm import Session

from main.framework.models.database import SessionLocal
from main.framework.models.workflow import Workflow


class WorkflowRepository:
    """Encapsulates all DB operations for Workflow records.

    Supports two modes (matches ``ExecutionRepository`` / ``ConversationRepository``):
    - **Legacy** (default): ``session_factory`` creates a fresh session per
      operation and commits internally — fully backward-compatible.
    - **DI**: pass ``db=`` from an external caller who owns transaction
      boundaries (Unit-of-Work style).
    """

    def __init__(self, session_factory=SessionLocal, db: Session | None = None):
        self._sf = session_factory
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

    def get(self, workflow_id: str) -> Workflow | None:
        """Get workflow by id."""
        with self._session() as db:
            return db.query(Workflow).get(workflow_id)

    def list(
        self,
        limit: int = 100,
        offset: int = 0,
        status: str | None = None,
    ) -> list[Workflow]:
        """List workflows with optional status filter."""
        with self._session() as db:
            q = db.query(Workflow)
            if status:
                q = q.filter(Workflow.status == status)
            return q.order_by(Workflow.created_at.desc()).offset(offset).limit(limit).all()

    def create(self, name: str, **kwargs: Any) -> Workflow:
        """Create a new workflow. Commits immediately."""
        with self._session() as db:
            workflow = Workflow(name=name, **kwargs)
            db.add(workflow)
            db.commit()
            db.refresh(workflow)
            return workflow

    def update(self, workflow_id: str, **kwargs: Any) -> Workflow | None:
        """Update a workflow by id. Commits immediately."""
        with self._session() as db:
            workflow = db.query(Workflow).get(workflow_id)
            if workflow is None:
                return None
            for k, v in kwargs.items():
                setattr(workflow, k, v)
            db.commit()
            db.refresh(workflow)
            return workflow

    def delete(self, workflow_id: str) -> bool:
        """Delete a workflow by id. Returns True if deleted."""
        with self._session() as db:
            workflow = db.query(Workflow).get(workflow_id)
            if workflow is None:
                return False
            db.delete(workflow)
            db.commit()
            return True

    def exists(self, workflow_id: str) -> bool:
        """Check if workflow exists."""
        with self._session() as db:
            return db.query(Workflow).filter_by(id=workflow_id).first() is not None
