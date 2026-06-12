"""Scheduler HTTP routes — thin handlers that delegate to SchedulerService.

Each endpoint is a thin shell:
  1. Validate the request via Pydantic schemas.
  2. Call one ``SchedulerService`` method.
  3. Translate validation/runtime errors to the appropriate HTTPException.

Business logic lives in ``SchedulerService`` (APScheduler wrapper for cron-based
workflow execution, with DB persistence of cron state on the ``Workflow`` row).

The router defines 3 routes (sharing the ``/api/v1/workflows`` prefix with
``controllers/workflows.py`` — see ``main.py:64-66`` for the registration-order
comment that documents why this router is mounted BEFORE the workflows router):

  POST   /{workflow_id}/schedule  (schedule,      201)
  DELETE /{workflow_id}/schedule  (unschedule,    204)
  GET    /scheduled                (list,          200)

The re-export shim at ``api/scheduler_routes.py`` re-publishes this ``router``
under the original import path so ``main.py`` keeps working unchanged.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from main.framework.core.infrastructure.container import get_service
from main.framework.services.scheduler_service import SchedulerService
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/workflows", tags=["scheduler"])


class ScheduleRequest(BaseModel):
    cron_expression: str


@router.post("/{workflow_id}/schedule", status_code=status.HTTP_201_CREATED)
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


@router.delete("/{workflow_id}/schedule", status_code=status.HTTP_204_NO_CONTENT)
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
