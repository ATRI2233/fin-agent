"""Data maintenance API — CRUD for tasks, data query, manual trigger."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from main.data_maintenance.core.data_maintenance import DataMaintenanceService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/data-maintenance", tags=["data-maintenance"])


# ---- Dependency ----


def _get_service(request: Request) -> DataMaintenanceService:
    """Resolve DataMaintenanceService from app.state."""
    service = getattr(request.app.state, "maintenance_service", None)
    if service is None:
        raise HTTPException(status_code=503, detail="DataMaintenanceService not initialised")
    return service


# ---- Request/Response models ----


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


# ---- Endpoints ----


@router.get("/tasks")
async def list_tasks(
    svc: DataMaintenanceService = Depends(_get_service),
):
    """List all maintenance tasks."""
    return {"tasks": svc.list_tasks()}


@router.get("/tasks/{task_id}")
async def get_task(
    task_id: str,
    svc: DataMaintenanceService = Depends(_get_service),
):
    """Get task detail with latest data preview."""
    task = svc.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Include latest 10 data records
    data = svc.get_task_data(task_id, limit=10)
    logs = svc.get_task_logs(task_id, limit=5)

    return {**task, "latest_data": data, "recent_logs": logs}


@router.post("/tasks", status_code=201)
async def create_task(
    payload: TaskCreate,
    svc: DataMaintenanceService = Depends(_get_service),
):
    """Create a new maintenance task."""
    task = svc.create_task(payload.model_dump())
    # Re-sync scheduler
    svc.sync_scheduled_tasks()
    return task


@router.put("/tasks/{task_id}")
async def update_task(
    task_id: str,
    payload: TaskUpdate,
    svc: DataMaintenanceService = Depends(_get_service),
):
    """Update task configuration."""
    data = payload.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    task = svc.update_task(task_id, data)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Re-sync scheduler after config change
    svc.sync_scheduled_tasks()
    return task


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(
    task_id: str,
    svc: DataMaintenanceService = Depends(_get_service),
):
    """Delete a maintenance task and its data."""
    if not svc.delete_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")


@router.post("/tasks/{task_id}/run")
async def run_task(
    task_id: str,
    svc: DataMaintenanceService = Depends(_get_service),
):
    """Manually trigger a maintenance task."""
    task = svc.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await svc.execute_task(task_id)
    return result


@router.get("/tasks/{task_id}/data")
async def get_task_data(
    task_id: str,
    limit: int = 50,
    data_key: str | None = None,
    svc: DataMaintenanceService = Depends(_get_service),
):
    """Get stored data for a task."""
    task = svc.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    data = svc.get_task_data(task_id, limit=limit, data_key=data_key)
    return {"task_id": task_id, "data": data, "count": len(data)}


@router.get("/tasks/{task_id}/logs")
async def get_task_logs(
    task_id: str,
    limit: int = 20,
    svc: DataMaintenanceService = Depends(_get_service),
):
    """Get execution logs for a task."""
    task = svc.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    logs = svc.get_task_logs(task_id, limit=limit)
    return {"task_id": task_id, "logs": logs}


@router.get("/status")
async def get_status(
    svc: DataMaintenanceService = Depends(_get_service),
):
    """Get overview of all maintenance tasks."""
    tasks = svc.list_tasks()
    total = len(tasks)
    enabled = sum(1 for t in tasks if t["enabled"])
    healthy = sum(1 for t in tasks if t["enabled"] and t["last_status"] != "failed")
    failed = sum(1 for t in tasks if t["enabled"] and t["last_status"] == "failed")

    return {
        "total_tasks": total,
        "enabled_tasks": enabled,
        "healthy_tasks": healthy,
        "failed_tasks": failed,
        "tasks": tasks,
    }
