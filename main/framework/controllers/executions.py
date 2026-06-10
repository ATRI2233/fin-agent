"""Execution HTTP routes — thin handlers that delegate to ExecutionQueryService.

Each endpoint is a thin shell:
  1. Call one ``ExecutionQueryService`` method.
  2. Translate ``NotFoundError`` → 404, ``ServiceError`` → 400.
  3. For retry / abort: schedule async side-effects (engine spawn / session
     cleanup) using the DI container.

Business logic lives in:
  - ``ExecutionQueryService`` — read-only query + state transitions
  - Async engine spawn / session cleanup orchestrated by this controller

The router defines 5 routes (paths / methods preserved exactly):
  GET    ""                              (list_executions,        200)
  GET    "/{execution_id}"               (get_execution,          200)
  GET    "/{execution_id}/timeline"      (get_execution_timeline, 200)
  POST   "/{execution_id}/retry"         (retry_execution,        200)
  DELETE "/{execution_id}"               (abort_execution,        200)

The re-export shim at ``api/executions.py`` re-publishes this ``router``
under the original import path so ``main.py`` and any other consumer keep
working unchanged.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from main.framework.core.container import get_service
from main.framework.core.session_cleanup import cleanup_workflow_sessions
from main.framework.services.exceptions import NotFoundError, ServiceError
from main.framework.services.execution_query_service import (
    ExecutionListResponse,
    ExecutionQueryService,
    RetryResponse,
    TimelineResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/executions", tags=["executions"])


# ---------------------------------------------------------------------------
# Async retry runner — drives the new workflow execution out-of-band.
# ---------------------------------------------------------------------------


async def _run_retry_async(
    workflow_id: str,
    params: dict,
    execution_id: str,
    container,
) -> None:
    """Background task that drives the retry workflow execution.

    Mirrors the legacy ``api/executions.py::_run`` but pulls everything
    from the DI container so the task participates in test
    dependency-overrides.
    """
    try:
        engine = container.create_workflow_engine(
            workflow_id,
            params,
            execution_id=execution_id,
        )
        await engine.execute()
    except Exception as e:  # noqa: BLE001 — last-resort guard for the background task
        logger.error("Retry execution failed: %s", e, exc_info=True)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=ExecutionListResponse)
async def list_executions(
    workflow_id: str | None = None,
    status: str | None = None,
    limit: int = 20,
    offset: int = 0,
    service: ExecutionQueryService = Depends(get_service(ExecutionQueryService)),
):
    """List all execution records with optional filters."""
    return service.list_executions(
        workflow_id=workflow_id,
        status=status,
        limit=limit,
        offset=offset,
    )


@router.get("/{execution_id}")
async def get_execution(
    execution_id: str,
    service: ExecutionQueryService = Depends(get_service(ExecutionQueryService)),
):
    """Get execution detail with all node statuses."""
    try:
        return service.get_execution(execution_id)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Execution not found") from err


@router.get("/{execution_id}/timeline", response_model=TimelineResponse)
async def get_execution_timeline(
    execution_id: str,
    service: ExecutionQueryService = Depends(get_service(ExecutionQueryService)),
):
    """Get node-level execution timeline."""
    try:
        return service.get_timeline(execution_id)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Execution not found") from err


@router.post("/{execution_id}/retry", response_model=RetryResponse)
async def retry_execution(
    execution_id: str,
    request: Request,
    service: ExecutionQueryService = Depends(get_service(ExecutionQueryService)),
):
    """Retry a failed execution. Creates a new execution for the same workflow.

    The service creates the new execution row + nodes synchronously; this
    handler then schedules the async engine runner via the container so
    the work runs out-of-band.
    """
    try:
        result = service.retry_execution(execution_id)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Execution not found") from err
    except ServiceError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    container = request.app.state.container
    asyncio.create_task(
        _run_retry_async(
            workflow_id=result["workflow_id"],
            params=result["params"],
            execution_id=result["execution_id"],
            container=container,
        )
    )
    return RetryResponse(execution_id=result["execution_id"], status=result["status"])


@router.delete("/{execution_id}")
async def abort_execution(
    execution_id: str,
    request: Request,
    service: ExecutionQueryService = Depends(get_service(ExecutionQueryService)),
):
    """Abort a running execution and cleanup its sessions.

    The service marks the execution as failed synchronously; this handler
    then runs ``cleanup_workflow_sessions`` against the container's
    backend so the HAPI sessions attached to the execution are torn down.
    """
    try:
        result = service.abort_execution(execution_id)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Execution not found") from err
    except ServiceError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    container = request.app.state.container
    cleanup_workflow_sessions(execution_id, backend=container.backend)
    return result
