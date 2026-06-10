"""Workflow HTTP routes — thin handlers that delegate to WorkflowQueryService.

Each endpoint is a thin shell:
  1. Validate the request via Pydantic schemas.
  2. Call one (or a few) ``WorkflowQueryService`` methods.
  3. Let the global RFC 7807 handlers in ``main.py`` map service-layer
     ``NotFoundError`` → 404 and ``ServiceError`` → 500 / 400.

Business logic lives in:
  - ``WorkflowQueryService``     — CRUD, stats, trigger (this controller)
  - ``WorkflowEngine``           — async DAG execution (spawned by trigger)

The router defines 7 routes:
  POST   /                       (create,         201)
  GET    /                       (list,           200)
  GET    /stats                  (get_stats,      200)
  GET    /{workflow_id}          (get,            200)
  PUT    /{workflow_id}          (update,         200)
  DELETE /{workflow_id}          (delete,         204)
  POST   /{workflow_id}/trigger  (trigger,        202)

The re-export shim at ``api/workflows.py`` re-publishes this ``router`` under
the original import path so ``main.py`` and any other consumer keep working
unchanged.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from main.framework.core.container import get_service
from main.framework.models.database import get_db
from main.framework.services.workflow_query_service import WorkflowQueryService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/workflows", tags=["workflows"])


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class WorkflowCreate(BaseModel):
    name: str
    description: str | None = None
    nodes: list[dict] = []
    edges: list[dict] = []
    trigger_type: str | None = "manual"
    config: dict | None = {}


class WorkflowUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    nodes: list[dict] | None = None
    edges: list[dict] | None = None
    trigger_type: str | None = None
    config: dict | None = None


class WorkflowTrigger(BaseModel):
    params: dict | None = {}


# ---------------------------------------------------------------------------
# Async trigger runner — used by the trigger endpoint
# ---------------------------------------------------------------------------


async def _run_workflow_async(
    workflow_id: str,
    params: dict,
    execution_id: str,
    container,
) -> None:
    """Background task that drives workflow execution.

    Mirrors the legacy ``api/triggers.py::_run_workflow_async`` but pulls
    everything from the DI container (so it participates in test
    dependency-overrides and future container-managed resources).
    """
    wf_repo = container.workflow_repo
    exec_repo = container.execution_repo
    try:
        workflow = wf_repo.get(workflow_id)
        if not workflow:
            return

        with contextlib.suppress(Exception):
            exec_repo.update_execution(execution_id, status="running")

        for node in workflow.nodes or []:
            agent = node.get("agent", "")
            if not agent:
                data = node.get("data", {})
                if isinstance(data, dict):
                    agent = data.get("agentType", "") or data.get("label", "")
            with contextlib.suppress(Exception):
                exec_repo.create_node(
                    execution_id=execution_id,
                    node_id=node["id"],
                    agent=agent,
                    status="pending",
                    input=params,
                )

        engine = container.create_workflow_engine(workflow_id, params, execution_id=execution_id)
        await engine.execute()
    except Exception as e:  # noqa: BLE001 — last-resort guard for the background task
        logger.error("Workflow execution failed: %s", e, exc_info=True)
        with contextlib.suppress(Exception):
            exec_repo.update_execution(execution_id, status="failed")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_workflow(
    payload: WorkflowCreate,
    db: Session = Depends(get_db),
    service: WorkflowQueryService = Depends(get_service(WorkflowQueryService)),
):
    """Create a new workflow. Returns the created workflow (full detail)."""
    return service.create_workflow(payload.model_dump(), db)


@router.get("")
async def list_workflows(
    skip: int = 0,
    limit: int = 1000,
    db: Session = Depends(get_db),
    service: WorkflowQueryService = Depends(get_service(WorkflowQueryService)),
):
    """List workflows (summary view, newest first)."""
    return service.list_workflows(db, skip=skip, limit=limit)


@router.get("/stats")
async def get_workflow_stats(
    db: Session = Depends(get_db),
    service: WorkflowQueryService = Depends(get_service(WorkflowQueryService)),
):
    """Get aggregated workflow execution statistics."""
    return service.get_workflow_stats(db)


@router.get("/{workflow_id}")
async def get_workflow(
    workflow_id: str,
    db: Session = Depends(get_db),
    service: WorkflowQueryService = Depends(get_service(WorkflowQueryService)),
):
    """Get a workflow by id. 404 via the global NotFoundError handler."""
    return service.get_workflow(workflow_id, db)


@router.put("/{workflow_id}")
async def update_workflow(
    workflow_id: str,
    payload: WorkflowUpdate,
    db: Session = Depends(get_db),
    service: WorkflowQueryService = Depends(get_service(WorkflowQueryService)),
):
    """Update a workflow. Re-validates the DAG if nodes/edges change."""
    return service.update_workflow(workflow_id, payload.model_dump(exclude_none=True), db)


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(
    workflow_id: str,
    db: Session = Depends(get_db),
    service: WorkflowQueryService = Depends(get_service(WorkflowQueryService)),
):
    """Delete a workflow and cascade-delete its executions."""
    service.delete_workflow(workflow_id, db)
    return None


@router.post("/{workflow_id}/trigger", status_code=status.HTTP_202_ACCEPTED)
async def trigger_workflow(
    workflow_id: str,
    payload: WorkflowTrigger,
    request: Request,
    db: Session = Depends(get_db),
    service: WorkflowQueryService = Depends(get_service(WorkflowQueryService)),
):
    """Trigger a workflow execution asynchronously.

    The service creates the pending ``WorkflowExecution`` row and returns the
    id; this handler then schedules the async runner via the container's
    ``create_workflow_engine`` factory so the work runs out-of-band.
    """
    params = payload.params or {}
    execution_id = service.trigger_workflow(workflow_id, params, db)
    container = request.app.state.container
    asyncio.create_task(_run_workflow_async(workflow_id, params, execution_id, container))
    return {"execution_id": execution_id}
