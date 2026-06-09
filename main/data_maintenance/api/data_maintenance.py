"""Data maintenance API — CRUD for tasks, data query, manual trigger."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from main.data_maintenance.core.data_maintenance import DataMaintenanceService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/data-maintenance", tags=["data-maintenance"])


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
async def list_tasks():
    """List all maintenance tasks."""
    return {"tasks": DataMaintenanceService.list_tasks()}


@router.get("/tasks/{task_id}")
async def get_task(task_id: str):
    """Get task detail with latest data preview."""
    task = DataMaintenanceService.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Include latest 10 data records
    data = DataMaintenanceService.get_task_data(task_id, limit=10)
    logs = DataMaintenanceService.get_task_logs(task_id, limit=5)

    return {**task, "latest_data": data, "recent_logs": logs}


@router.post("/tasks", status_code=201)
async def create_task(payload: TaskCreate):
    """Create a new maintenance task."""
    task = DataMaintenanceService.create_task(payload.model_dump())
    # Re-sync scheduler
    DataMaintenanceService.sync_scheduled_tasks()
    return task


@router.put("/tasks/{task_id}")
async def update_task(task_id: str, payload: TaskUpdate):
    """Update task configuration."""
    data = payload.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    task = DataMaintenanceService.update_task(task_id, data)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Re-sync scheduler after config change
    DataMaintenanceService.sync_scheduled_tasks()
    return task


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(task_id: str):
    """Delete a maintenance task and its data."""
    if not DataMaintenanceService.delete_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")


@router.post("/tasks/{task_id}/run")
async def run_task(task_id: str):
    """Manually trigger a maintenance task."""
    task = DataMaintenanceService.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await DataMaintenanceService.execute_task(task_id)
    return result


@router.get("/tasks/{task_id}/data")
async def get_task_data(
    task_id: str,
    limit: int = 50,
    data_key: str | None = None,
):
    """Get stored data for a task."""
    task = DataMaintenanceService.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    data = DataMaintenanceService.get_task_data(task_id, limit=limit, data_key=data_key)
    return {"task_id": task_id, "data": data, "count": len(data)}


@router.get("/tasks/{task_id}/logs")
async def get_task_logs(task_id: str, limit: int = 20):
    """Get execution logs for a task."""
    task = DataMaintenanceService.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    logs = DataMaintenanceService.get_task_logs(task_id, limit=limit)
    return {"task_id": task_id, "logs": logs}


@router.get("/status")
async def get_status():
    """Get overview of all maintenance tasks."""
    tasks = DataMaintenanceService.list_tasks()
    total = len(tasks)
    enabled = sum(1 for t in tasks if t["enabled"])
    healthy = sum(
        1 for t in tasks if t["enabled"] and t["last_status"] != "failed"
    )
    failed = sum(
        1 for t in tasks if t["enabled"] and t["last_status"] == "failed"
    )

    return {
        "total_tasks": total,
        "enabled_tasks": enabled,
        "healthy_tasks": healthy,
        "failed_tasks": failed,
        "tasks": tasks,
    }
