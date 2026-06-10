"""Workflow HTTP routes — thin handlers that delegate to WorkflowCrudService.

Each endpoint:
  1. Validates the request via Pydantic schemas.
  2. Calls one ``WorkflowCrudService`` method.
  3. Translates ``NotFoundError`` / ``ServiceError`` → HTTP errors.

Business logic lives in ``WorkflowCrudService``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from main.framework.core.container import get_service
from main.framework.services.exceptions import NotFoundError, ServiceError
from main.framework.services.workflow_crud_service import WorkflowCrudService

router = APIRouter(prefix="/api/v1/workflows", tags=["workflows"])


# ---- Request / Response schemas ----


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


# ---- Endpoints ----


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_workflow(
    payload: WorkflowCreate,
    service: WorkflowCrudService = Depends(get_service(WorkflowCrudService)),
):
    """Create a new workflow."""
    try:
        return service.create(payload.model_dump())
    except ServiceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("")
async def list_workflows(
    service: WorkflowCrudService = Depends(get_service(WorkflowCrudService)),
):
    """List all workflows."""
    return service.list_all()


@router.get("/stats")
async def get_workflow_stats(
    service: WorkflowCrudService = Depends(get_service(WorkflowCrudService)),
):
    """Get aggregated workflow execution statistics."""
    return service.get_stats()


@router.get("/{workflow_id}/executions")
async def list_workflow_executions(
    workflow_id: str,
    offset: int = 0,
    limit: int = 20,
    status: str | None = None,
    service: WorkflowCrudService = Depends(get_service(WorkflowCrudService)),
):
    """List execution history for a specific workflow."""
    try:
        return service.list_executions(
            workflow_id, offset=offset, limit=limit, status=status
        )
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/{workflow_id}")
async def get_workflow(
    workflow_id: str,
    service: WorkflowCrudService = Depends(get_service(WorkflowCrudService)),
):
    """Get a workflow by ID."""
    try:
        return service.get(workflow_id)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.put("/{workflow_id}")
async def update_workflow(
    workflow_id: str,
    payload: WorkflowUpdate,
    service: WorkflowCrudService = Depends(get_service(WorkflowCrudService)),
):
    """Update a workflow."""
    try:
        return service.update(workflow_id, payload.model_dump(exclude_none=True))
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ServiceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(
    workflow_id: str,
    service: WorkflowCrudService = Depends(get_service(WorkflowCrudService)),
):
    """Delete a workflow and all its executions."""
    try:
        service.delete(workflow_id)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
