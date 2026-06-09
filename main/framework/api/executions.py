"""Execution query and retry API."""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/executions", tags=["executions"])


# ---- Response models ----


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


# ---- Endpoints ----


@router.get("", response_model=ExecutionListResponse)
async def list_executions(
    request: Request,
    workflow_id: str | None = None,
    status: str | None = None,
    limit: int = 20,
    offset: int = 0,
):
    """List all execution records with optional filters."""
    container = request.app.state.container
    repo = container.execution_repo
    items, total = repo.list_executions(
        workflow_id=workflow_id,
        status=status,
        limit=limit,
        offset=offset,
    )

    # Enrich with workflow names
    wf_ids = list({item["workflow_id"] for item in items})
    if wf_ids:
        workflow_names = repo.get_workflow_names(wf_ids)
        for item in items:
            item["workflow_name"] = workflow_names.get(item["workflow_id"])

    return ExecutionListResponse(
        executions=items,
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/{execution_id}")
async def get_execution(execution_id: str, request: Request):
    """Get execution detail with all node statuses."""
    container = request.app.state.container
    repo = container.execution_repo
    execution, nodes, workflow = repo.get_execution_detail(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")

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


@router.get("/{execution_id}/timeline", response_model=TimelineResponse)
async def get_execution_timeline(execution_id: str, request: Request):
    """Get node-level execution timeline."""
    container = request.app.state.container
    repo = container.execution_repo
    execution, _, workflow = repo.get_execution_detail(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")

    timeline = repo.get_execution_timeline(execution_id)

    total_duration = None
    if execution.started_at and execution.completed_at:
        total_duration = (execution.completed_at - execution.started_at).total_seconds()

    return TimelineResponse(
        execution_id=execution_id,
        workflow_id=execution.workflow_id,
        workflow_name=workflow.name if workflow else None,
        total_duration_seconds=total_duration,
        nodes=timeline,
    )


@router.post("/{execution_id}/retry", response_model=RetryResponse)
async def retry_execution(execution_id: str, request: Request):
    """Retry a failed execution. Creates a new execution for the same workflow."""
    container = request.app.state.container
    repo = container.execution_repo

    execution = repo.get_execution(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")

    if execution.status not in ("failed", "completed"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot retry execution with status '{execution.status}'",
        )

    workflow_id = execution.workflow_id

    # Get original params from the first node's input
    params = repo.get_first_node_input(execution_id)

    # Get workflow nodes definition
    workflow = repo.get_workflow(workflow_id)
    nodes_data = workflow.nodes if workflow and workflow.nodes else []

    # Create new execution and nodes atomically
    exec_id, _ = repo.create_execution_with_nodes(workflow_id, nodes_data, params)

    # Run engine in background
    async def _run():
        try:
            engine = container.create_workflow_engine(workflow_id, params, execution_id=exec_id)
            await engine.execute()
        except Exception as e:
            logger.error(f"Retry execution failed: {e}", exc_info=True)

    asyncio.create_task(_run())

    return RetryResponse(
        execution_id=exec_id,
        status="pending",
    )


@router.delete("/{execution_id}")
async def abort_execution(execution_id: str, request: Request):
    """Abort a running execution and cleanup its sessions."""
    container = request.app.state.container
    repo = container.execution_repo

    execution = repo.get_execution(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")

    if execution.status not in ("pending", "running"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot abort execution with status '{execution.status}'",
        )

    # Mark execution as failed
    repo.update_execution(execution_id, status="failed")

    # Cleanup sessions
    from main.framework.core.session_cleanup import cleanup_workflow_sessions

    container = request.app.state.container
    cleanup_workflow_sessions(execution_id, backend=container.backend)

    return {"execution_id": execution_id, "status": "aborted"}
