"""WorkflowQueryService — business logic for workflow CRUD, stats, and triggering.

Replaces the inline handlers that previously lived in ``api/workflows.py`` and
absorbs the legacy ``services/workflow_crud_service.py``. The class is
intentionally sync; async workflow execution is scheduled by the controller via
the container's ``create_workflow_engine`` factory (or the matching
``WorkflowService`` orchestration).

Session lifecycle
-----------------
Every public method accepts ``db: Session`` owned by the caller (controller /
unit-of-work). The service binds per-call repositories to that session so all
operations participate in the caller's transaction. The constructor-injected
repositories serve as templates / fallbacks when the caller passes ``db=None``.

Design notes
------------
- **DAG validation** is delegated to ``core.workflow_parser.validate_dag`` —
  this class adds the MAX_NODES guard on top and translates cycle / size
  violations into :class:`ServiceError` for the controller to surface.
- **Trigger dispatch** creates a pending ``WorkflowExecution`` row, then asks
  the controller (via the returned ``execution_id``) to schedule the async
  runner. The service itself never spawns background tasks — that is the
  controller's job (mirrors the conversation/message separation in
  ``services/conversation_service.py`` + ``message_processor.py``).
"""

from __future__ import annotations

import logging
from typing import Any

from main.framework.core.workflow_parser import validate_dag
from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution
from main.framework.repositories.conversation_repo import ConversationRepository
from main.framework.repositories.execution_repo import ExecutionRepository
from main.framework.repositories.workflow_repo import WorkflowRepository
from main.framework.services.exceptions import NotFoundError, ServiceError
from sqlalchemy import case, func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Maximum nodes allowed in a workflow DAG. Mirrors the cap in
# ``core/workflow_parser.py`` (also 50) — kept here so the service can reject
# oversized payloads before invoking the parser.
MAX_NODES = 50


class WorkflowQueryService:
    """Business-logic facade over Workflow + WorkflowExecution.

    Public surface (7 methods, all sync):
      list_workflows, get_workflow, get_workflow_stats,
      create_workflow, update_workflow, delete_workflow, trigger_workflow

    Plus a static helper ``validate_workflow_dag`` that the controller may use
    for dry-run validation without persisting anything.
    """

    def __init__(
        self,
        workflow_repo: WorkflowRepository,
        exec_repo: ExecutionRepository,
        conv_repo: ConversationRepository,
    ) -> None:
        # Repos are templates / fallbacks; per-call repos are bound to db.
        self._workflow_repo = workflow_repo
        self._exec_repo = exec_repo
        self._conv_repo = conv_repo

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _workflow_repo_for(db: Session | None) -> WorkflowRepository:
        """Return a WorkflowRepository bound to the caller's session."""
        if db is not None:
            return WorkflowRepository(db=db)  # type: ignore[arg-type]
        return WorkflowRepository()

    @staticmethod
    def _to_response(workflow: Any) -> dict[str, Any]:
        """Build the full response dict for a single workflow row."""
        return {
            "id": workflow.id,
            "name": workflow.name,
            "description": workflow.description,
            "nodes": workflow.nodes or [],
            "edges": workflow.edges or [],
            "trigger_type": getattr(workflow, "trigger_type", "manual"),
            "config": getattr(workflow, "config", {}),
            "status": workflow.status,
            "created_at": workflow.created_at.isoformat() if workflow.created_at else None,
            "updated_at": workflow.updated_at.isoformat() if workflow.updated_at else None,
        }

    @staticmethod
    def _to_list_item(workflow: Any) -> dict[str, Any]:
        """Build the summary view used by ``GET /api/v1/workflows``."""
        return {
            "id": workflow.id,
            "name": workflow.name,
            "status": workflow.status,
            "node_count": len(workflow.nodes) if workflow.nodes else 0,
            "created_at": workflow.created_at.isoformat() if workflow.created_at else None,
        }

    # ------------------------------------------------------------------
    # DAG validation helper (static, no side effects)
    # ------------------------------------------------------------------

    @staticmethod
    def validate_workflow_dag(nodes: list[dict], edges: list[dict]) -> bool:
        """Validate a workflow DAG without persisting it.

        Returns ``True`` if the graph is a valid DAG, ``False`` if a cycle was
        detected. Raises :class:`ServiceError` when ``len(nodes) > MAX_NODES``.
        """
        if len(nodes) > MAX_NODES:
            raise ServiceError(f"Workflow cannot have more than {MAX_NODES} nodes")
        return validate_dag(nodes, edges)

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def create_workflow(self, payload: dict[str, Any], db: Session) -> dict[str, Any]:
        """Create a new workflow after validating the DAG.

        Raises :class:`ServiceError` on validation failure.
        """
        nodes = payload.get("nodes", []) or []
        edges = payload.get("edges", []) or []

        if len(nodes) > MAX_NODES:
            raise ServiceError(f"Workflow cannot have more than {MAX_NODES} nodes")
        if not validate_dag(nodes, edges):
            raise ServiceError("Invalid DAG: cycle detected")

        workflow = self._workflow_repo.create(
            name=payload["name"],
            description=payload.get("description"),
            nodes=nodes,
            edges=edges,
            trigger_type=payload.get("trigger_type", "manual"),
            config=payload.get("config", {}),
            status="draft",
        )
        return self._to_response(workflow)

    def get_workflow(self, workflow_id: str, db: Session) -> dict[str, Any]:
        """Get a workflow by id. Raises :class:`NotFoundError` if missing."""
        repo = self._workflow_repo_for(db)
        workflow = repo.get(workflow_id)
        if workflow is None:
            raise NotFoundError(f"Workflow {workflow_id} not found")
        return self._to_response(workflow)

    def list_workflows(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        """List workflows (summary view), newest first."""
        repo = self._workflow_repo_for(db)
        workflows = repo.list(limit=limit, offset=skip)
        return [self._to_list_item(w) for w in workflows]

    def update_workflow(
        self,
        workflow_id: str,
        payload: dict[str, Any],
        db: Session,
    ) -> dict[str, Any]:
        """Update mutable fields. Re-validates DAG when nodes/edges change.

        Raises :class:`NotFoundError` if missing, :class:`ServiceError` on
        validation failure.
        """
        repo = self._workflow_repo_for(db)
        workflow = repo.get(workflow_id)
        if workflow is None:
            raise NotFoundError(f"Workflow {workflow_id} not found")

        update_fields: dict[str, Any] = {}
        for key in ("name", "description", "nodes", "edges", "trigger_type", "config"):
            if payload.get(key) is not None:
                update_fields[key] = payload[key]

        # Re-validate DAG when the topology changes.
        if "nodes" in update_fields or "edges" in update_fields:
            nodes = update_fields.get("nodes", workflow.nodes or [])
            edges = update_fields.get("edges", workflow.edges or [])
            if len(nodes) > MAX_NODES:
                raise ServiceError(f"Workflow cannot have more than {MAX_NODES} nodes")
            if not validate_dag(nodes, edges):
                raise ServiceError("Invalid DAG: cycle detected")

        updated = repo.update(workflow_id, **update_fields)
        if updated is None:
            # Race: row was deleted between the existence check and the update.
            raise NotFoundError(f"Workflow {workflow_id} not found")
        return self._to_response(updated)

    def delete_workflow(self, workflow_id: str, db: Session) -> None:
        """Delete a workflow and cascade-delete its executions.

        Raises :class:`NotFoundError` if the workflow does not exist.
        """
        repo = self._workflow_repo_for(db)
        workflow = repo.get(workflow_id)
        if workflow is None:
            raise NotFoundError(f"Workflow {workflow_id} not found")

        # Cascade: delete executions before the workflow row.
        db.query(WorkflowExecution).filter(WorkflowExecution.workflow_id == workflow_id).delete()
        db.commit()

        if not repo.delete(workflow_id):
            # Row was deleted by a concurrent request between check and delete.
            raise NotFoundError(f"Workflow {workflow_id} not found")

    # ------------------------------------------------------------------
    # Stats — aggregates over WorkflowExecution rows
    # ------------------------------------------------------------------

    def get_workflow_stats(self, db: Session) -> dict[str, Any]:
        """Return aggregated workflow execution statistics.

        Response shape (preserved for backward compatibility with the
        pre-refactor ``/stats`` endpoint):

            {
                "running":   int,
                "completed": int,
                "failed":    int,
                "successRate": float | None,  # percent, None when no terminal runs
            }
        """
        rows = (
            db.query(WorkflowExecution.status, func.count(WorkflowExecution.id))
            .group_by(WorkflowExecution.status)
            .all()
        )
        counts: dict[str, int] = {status: cnt for status, cnt in rows}

        running = counts.get("running", 0)
        completed = counts.get("completed", 0)
        failed = counts.get("failed", 0)
        terminal = completed + failed
        success_rate = round(completed / terminal * 100, 1) if terminal > 0 else None

        return {
            "running": running,
            "completed": completed,
            "failed": failed,
            "successRate": success_rate,
        }

    # ------------------------------------------------------------------
    # Trigger — create execution row; controller schedules the async runner
    # ------------------------------------------------------------------

    def trigger_workflow(self, workflow_id: str, params: dict[str, Any], db: Session) -> str:
        """Create a pending ``WorkflowExecution`` for ``workflow_id``.

        Returns the new ``execution_id``. The controller is responsible for
        kicking off the async runner (see ``controllers/workflows.py``).

        Raises :class:`NotFoundError` if the workflow does not exist.
        """
        repo = self._workflow_repo_for(db)
        workflow = repo.get(workflow_id)
        if workflow is None:
            raise NotFoundError(f"Workflow {workflow_id} not found")

        execution = WorkflowExecution(
            workflow_id=workflow_id,
            status="pending",
        )
        db.add(execution)
        db.commit()
        db.refresh(execution)
        return str(execution.id)


__all__ = ["MAX_NODES", "WorkflowQueryService"]
