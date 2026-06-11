"""Data maintenance HTTP routes — thin handlers that delegate to MaintenanceQueryService.

Each endpoint is a thin shell:
  1. Validate the request via Pydantic schemas.
  2. Call one ``MaintenanceQueryService`` method.
  3. Translate ``NotFoundError`` → 404.
  4. Surface 503 when the underlying maintenance core is not initialised.

Business logic lives in:
  - ``MaintenanceQueryService``  — CRUD, manual run, data/log/status queries
  - ``DataMaintenanceService``   — scheduler integration, agent dispatch
  - ``core.data_maintenance``    — async task execution, result storage

The router defines 9 routes under ``/api/v1/data-maintenance``:

  GET    /tasks                  (list,        200)
  GET    /tasks/{task_id}        (detail,      200)
  POST   /tasks                  (create,      201)
  PUT    /tasks/{task_id}        (update,      200)
  DELETE /tasks/{task_id}        (delete,      204)
  POST   /tasks/{task_id}/run    (manual run,  200)
  GET    /tasks/{task_id}/data   (data,        200)
  GET    /tasks/{task_id}/logs   (logs,        200)
  GET    /status                 (overview,    200)

The re-export shim at ``api/data_maintenance.py`` re-publishes this ``router``
under the original import path so ``main.py`` and any other consumer keep
working unchanged.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from main.data_maintenance.services.maintenance_query_service import (
    MaintenanceQueryService,
)
from main.framework.core.container import get_service
from main.framework.services.exceptions import NotFoundError
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/data-maintenance", tags=["data-maintenance"])


# ---------------------------------------------------------------------------
# Dependency factory — preserves the legacy 503 "not initialised" behaviour.
#
# The pre-refactor handler resolved the core service from
# ``request.app.state.maintenance_service`` and returned 503 when it was
# absent.  We keep the same contract here: if the container has no
# ``MaintenanceQueryService`` (or the wrapped core is not ready), we surface
# 503 instead of letting the framework turn a ``ValueError`` into a 500.
# ---------------------------------------------------------------------------


def _get_query_service() -> MaintenanceQueryService:
    """Resolve ``MaintenanceQueryService`` from the DI container.

    Raises ``HTTPException(503)`` when the service is not registered or
    the wrapped core service has no dispatcher wired in.
    """
    try:
        svc = get_service(MaintenanceQueryService)()
    except (ValueError, RuntimeError) as err:
        raise HTTPException(
            status_code=503,
            detail="MaintenanceQueryService not initialised",
        ) from err
    if not svc.is_ready():
        raise HTTPException(
            status_code=503,
            detail="MaintenanceQueryService not initialised",
        )
    return svc


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class TaskCreate(BaseModel):
    name: str = Field(..., max_length=100)
    description: str = Field(default="", max_length=500)
    agent: str
    prompt: str = Field(..., max_length=5000)
    schedule: str | None = None  # cron: "*/5 9-15 * * 1-5"
    enabled: bool = True
    trigger_type: str = "cron"  # cron | manual | interval
    interval_seconds: int | None = None


class TaskUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    agent: str | None = None
    prompt: str | None = None
    schedule: str | None = None
    enabled: bool | None = None
    trigger_type: str | None = None
    interval_seconds: int | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/tasks")
async def list_tasks(
    svc: MaintenanceQueryService = Depends(_get_query_service),
):
    """List all maintenance tasks."""
    return svc.list_tasks()


@router.get("/tasks/{task_id}")
async def get_task(
    task_id: str,
    svc: MaintenanceQueryService = Depends(_get_query_service),
):
    """Get task detail with latest data preview."""
    try:
        return svc.get_task_detail(task_id)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Task not found") from err


@router.post("/tasks", status_code=201)
async def create_task(
    payload: TaskCreate,
    svc: MaintenanceQueryService = Depends(_get_query_service),
):
    """Create a new maintenance task."""
    return svc.create_task(payload.model_dump())


@router.put("/tasks/{task_id}")
async def update_task(
    task_id: str,
    payload: TaskUpdate,
    svc: MaintenanceQueryService = Depends(_get_query_service),
):
    """Update task configuration."""
    data = payload.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        return svc.update_task(task_id, data)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Task not found") from err


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(
    task_id: str,
    svc: MaintenanceQueryService = Depends(_get_query_service),
):
    """Delete a maintenance task and its data."""
    try:
        svc.delete_task(task_id)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Task not found") from err


@router.post("/tasks/{task_id}/run")
async def run_task(
    task_id: str,
    svc: MaintenanceQueryService = Depends(_get_query_service),
):
    """Manually trigger a maintenance task."""
    try:
        return await svc.run_task(task_id)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Task not found") from err


@router.get("/tasks/{task_id}/data")
async def get_task_data(
    task_id: str,
    limit: int = 50,
    data_key: str | None = None,
    svc: MaintenanceQueryService = Depends(_get_query_service),
):
    """Get stored data for a task."""
    try:
        return svc.get_task_data(task_id, limit=limit, data_key=data_key)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Task not found") from err


@router.get("/tasks/{task_id}/logs")
async def get_task_logs(
    task_id: str,
    limit: int = 20,
    svc: MaintenanceQueryService = Depends(_get_query_service),
):
    """Get execution logs for a task."""
    try:
        return svc.get_task_logs(task_id, limit=limit)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Task not found") from err


@router.get("/status")
async def get_status(
    svc: MaintenanceQueryService = Depends(_get_query_service),
):
    """Get overview of all maintenance tasks."""
    return svc.get_status()
