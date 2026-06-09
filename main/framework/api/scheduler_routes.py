"""Scheduler API endpoints for workflow cron scheduling."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from main.framework.core.container import get_service
from main.framework.services.scheduler_service import SchedulerService

router = APIRouter(prefix="/api/v1/workflows", tags=["scheduler"])


class ScheduleRequest(BaseModel):
    cron_expression: str


@router.post("/{workflow_id}/schedule", status_code=201)
async def schedule_workflow(
    workflow_id: str,
    payload: ScheduleRequest,
    scheduler: SchedulerService = Depends(get_service(SchedulerService)),
):
    """Schedule a workflow with a cron expression."""
    try:
        scheduler.add_workflow_job(workflow_id, payload.cron_expression)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "workflow_id": workflow_id,
        "cron_expression": payload.cron_expression,
        "status": "scheduled",
    }


@router.delete("/{workflow_id}/schedule", status_code=204)
async def unschedule_workflow(
    workflow_id: str,
    scheduler: SchedulerService = Depends(get_service(SchedulerService)),
):
    """Remove a scheduled workflow job."""
    removed = scheduler.remove_workflow_job(workflow_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Scheduled job not found")
    return None


@router.get("/scheduled")
async def list_scheduled_workflows(
    scheduler: SchedulerService = Depends(get_service(SchedulerService)),
):
    """List all scheduled workflow jobs."""
    return scheduler.list_scheduled_workflows()
