"""ExecutionQueryService — business logic for execution query / retry / abort.

Read-only + sync operations over ``WorkflowExecution`` / ``ExecutionNode`` /
``Workflow``.  The pre-existing ``ExecutionService`` owns the lifecycle side
(status transitions, failure cascade) — this class is the **query** surface
the executions controller delegates to.  Async side-effects (engine spawn,
session cleanup) live in the controller, mirroring the conversation split
and the Wave 2 ``controllers/workflows.py`` pattern.

Unlike ``ConversationService`` / ``WorkflowQueryService``, this service does
NOT take a per-call ``db: Session``: ``ExecutionRepository`` is dual-mode and
already manages its own session lifecycle, matching the legacy
``api/executions.py`` call sites.  The Pydantic response models that
previously lived in ``api/executions.py`` are owned here so the service is
the single source of truth for the public contract.
"""

from __future__ import annotations

from typing import Any

from main.framework.repositories.execution_repo import ExecutionRepository
from main.framework.services.exceptions import NotFoundError, ServiceError
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class ExecutionSummary(BaseModel):
    id: str
    workflow_id: str
    workflow_name: str | None = None
    status: str
    started_at: str | None = None
    completed_at: str | None = None
    duration_seconds: float | None = None
    node_count: int = 0
    completed_nodes: int = 0
    failed_nodes: int = 0


class ExecutionListResponse(BaseModel):
    executions: list[ExecutionSummary]
    total: int
    offset: int
    limit: int


class TimelineNode(BaseModel):
    node_id: str
    agent: str
    status: str
    started_at: str | None = None
    completed_at: str | None = None
    duration_seconds: float | None = None
    session_id: str | None = None
    retry_count: int = 0


class TimelineResponse(BaseModel):
    execution_id: str
    workflow_id: str
    workflow_name: str | None = None
    total_duration_seconds: float | None = None
    nodes: list[TimelineNode]


class RetryResponse(BaseModel):
    execution_id: str
    status: str


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class ExecutionQueryService:
    """Business-logic facade for execution query / retry / abort.

    Public surface (5 methods, all sync):
      list_executions, get_execution, get_timeline,
      retry_execution, abort_execution
    """

    def __init__(self, exec_repo: ExecutionRepository) -> None:
        self._exec_repo = exec_repo

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _enrich_with_workflow_names(self, items: list[dict[str, Any]]) -> None:
        """Mutate ``items`` in place, adding ``workflow_name`` via the repo."""
        if not items:
            return
        wf_ids = list({item["workflow_id"] for item in items})
        workflow_names = self._exec_repo.get_workflow_names(wf_ids)
        for item in items:
            item["workflow_name"] = workflow_names.get(item["workflow_id"])

    @staticmethod
    def _execution_detail_dict(execution, nodes, workflow) -> dict[str, Any]:
        """Build the response dict for ``get_execution``."""
        return {
            "execution_id": execution.id,
            "workflow_id": execution.workflow_id,
            "workflow_name": workflow.name if workflow else None,
            "status": execution.status,
            "started_at": execution.started_at.isoformat() if execution.started_at else None,
            "completed_at": execution.completed_at.isoformat() if execution.completed_at else None,
            "nodes": [
                {
                    "node_id": n.node_id,
                    "agent": n.agent,
                    "status": n.status,
                    "output": n.output,
                    "error": n.error,
                    "session_id": n.session_id,
                    "retry_count": n.retry_count or 0,
                }
                for n in nodes
            ],
        }

    # ------------------------------------------------------------------
    # List
    # ------------------------------------------------------------------

    def list_executions(
        self,
        workflow_id: str | None = None,
        status: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> ExecutionListResponse:
        """List all execution records with optional filters.

        Response is enriched with ``workflow_name`` looked up in a single
        batch query for any distinct ``workflow_id`` present in the page.
        """
        items, total = self._exec_repo.list_executions(
            workflow_id=workflow_id,
            status=status,
            limit=limit,
            offset=offset,
        )
        self._enrich_with_workflow_names(items)
        # Pydantic v1 coerces dicts → ExecutionSummary at runtime; static type is invariant.
        return ExecutionListResponse(
            executions=items,  # type: ignore[arg-type]
            total=total,
            offset=offset,
            limit=limit,
        )

    # ------------------------------------------------------------------
    # Detail
    # ------------------------------------------------------------------

    def get_execution(self, execution_id: str) -> dict[str, Any]:
        """Get execution detail with all node statuses.

        Raises :class:`NotFoundError` if the execution does not exist.
        """
        execution, nodes, workflow = self._exec_repo.get_execution_detail(execution_id)
        if execution is None:
            raise NotFoundError("Execution", execution_id)
        return self._execution_detail_dict(execution, nodes, workflow)

    # ------------------------------------------------------------------
    # Timeline
    # ------------------------------------------------------------------

    def get_timeline(self, execution_id: str) -> TimelineResponse:
        """Get node-level execution timeline.

        Raises :class:`NotFoundError` if the execution does not exist.
        """
        execution, _, workflow = self._exec_repo.get_execution_detail(execution_id)
        if execution is None:
            raise NotFoundError("Execution", execution_id)

        timeline = self._exec_repo.get_execution_timeline(execution_id)
        total_duration = None
        if execution.started_at and execution.completed_at:  # type: ignore[truthy-bool]
            total_duration = (execution.completed_at - execution.started_at).total_seconds()  # type: ignore[operator]

        return TimelineResponse(
            execution_id=execution_id,
            workflow_id=execution.workflow_id,  # type: ignore[arg-type]
            workflow_name=workflow.name if workflow else None,
            total_duration_seconds=total_duration,
            nodes=timeline,  # type: ignore[arg-type]
        )

    # ------------------------------------------------------------------
    # Retry
    # ------------------------------------------------------------------

    def retry_execution(self, execution_id: str) -> dict[str, Any]:
        """Retry a failed/completed execution by creating a fresh row.

        Returns ``{"execution_id", "workflow_id", "params", "status"}`` so
        the controller can spawn the async engine runner with the right
        parameters.  Raises :class:`NotFoundError` if the execution does
        not exist, or :class:`ServiceError` if its status is not in
        ``{"failed", "completed"}``.
        """
        execution = self._exec_repo.get_execution(execution_id)
        if execution is None:
            raise NotFoundError("Execution", execution_id)
        if execution.status not in ("failed", "completed"):
            raise ServiceError(f"Cannot retry execution with status '{execution.status}'")

        workflow_id = execution.workflow_id  # type: ignore[assignment]
        params = self._exec_repo.get_first_node_input(execution_id)
        workflow = self._exec_repo.get_workflow(workflow_id)  # type: ignore[arg-type]
        nodes_data = workflow.nodes if workflow and workflow.nodes else []

        exec_id, _ = self._exec_repo.create_execution_with_nodes(
            workflow_id,  # type: ignore[arg-type]
            nodes_data,
            params,
        )
        return {
            "execution_id": exec_id,
            "workflow_id": workflow_id,
            "params": params,
            "status": "pending",
        }

    # ------------------------------------------------------------------
    # Abort
    # ------------------------------------------------------------------

    def abort_execution(self, execution_id: str) -> dict[str, Any]:
        """Mark a running execution as ``"failed"`` and return the result.

        Raises :class:`NotFoundError` if the execution does not exist, or
        :class:`ServiceError` if its status is not in
        ``{"pending", "running"}``.  Session cleanup is the controller's
        responsibility.
        """
        execution = self._exec_repo.get_execution(execution_id)
        if execution is None:
            raise NotFoundError("Execution", execution_id)
        if execution.status not in ("pending", "running"):
            raise ServiceError(f"Cannot abort execution with status '{execution.status}'")

        self._exec_repo.update_execution(execution_id, status="failed")
        return {"execution_id": execution_id, "status": "aborted"}


__all__ = [
    "ExecutionQueryService",
    "ExecutionSummary",
    "ExecutionListResponse",
    "TimelineNode",
    "TimelineResponse",
    "RetryResponse",
]
