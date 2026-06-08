"""Execution query and retry API."""

from __future__ import annotations

import logging
import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from main.framework.models.database import SessionLocal
from main.framework.models.workflow import Workflow
from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution
from main.framework.repositories.execution_repo import ExecutionRepository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/executions", tags=["executions"])

repo = ExecutionRepository()


# ---- Response models ----


class ExecutionSummary(BaseModel):
    id: str
    workflow_id: str
    workflow_name: Optional[str] = None
    status: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_seconds: Optional[float] = None
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
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_seconds: Optional[float] = None
    hapi_session_id: Optional[str] = None
    retry_count: int = 0


class TimelineResponse(BaseModel):
    execution_id: str
    workflow_id: str
    workflow_name: Optional[str] = None
    total_duration_seconds: Optional[float] = None
    nodes: list[TimelineNode]


class RetryResponse(BaseModel):
    execution_id: str
    status: str


# ---- Endpoints ----


@router.get("", response_model=ExecutionListResponse)
async def list_executions(
    request: Request,
    workflow_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
):
    """List all execution records with optional filters."""
    items, total = repo.list_executions(
        workflow_id=workflow_id,
        status=status,
        limit=limit,
        offset=offset,
    )

    # Enrich with workflow names
    db = SessionLocal()
    try:
        wf_ids = list({item["workflow_id"] for item in items})
        workflows = {
            w.id: w.name
            for w in db.query(Workflow).filter(Workflow.id.in_(wf_ids)).all()
        }
        for item in items:
            item["workflow_name"] = workflows.get(item["workflow_id"])
    finally:
        db.close()

    return ExecutionListResponse(
        executions=items,
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/{execution_id}")
async def get_execution(execution_id: str, request: Request):
    """Get execution detail with all node statuses."""
    db = SessionLocal()
    try:
        execution = db.query(WorkflowExecution).get(execution_id)
        if not execution:
            raise HTTPException(status_code=404, detail="Execution not found")

        nodes = (
            db.query(ExecutionNode)
            .filter(ExecutionNode.execution_id == execution_id)
            .all()
        )
        workflow = db.query(Workflow).get(execution.workflow_id)

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
                    "hapi_session_id": n.hapi_session_id,
                    "retry_count": n.retry_count or 0,
                }
                for n in nodes
            ],
        }
    finally:
        db.close()


@router.get("/{execution_id}/timeline", response_model=TimelineResponse)
async def get_execution_timeline(execution_id: str, request: Request):
    """Get node-level execution timeline."""
    db = SessionLocal()
    try:
        execution = db.query(WorkflowExecution).get(execution_id)
        if not execution:
            raise HTTPException(status_code=404, detail="Execution not found")

        workflow = db.query(Workflow).get(execution.workflow_id)
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
    finally:
        db.close()


@router.post("/{execution_id}/retry", response_model=RetryResponse)
async def retry_execution(execution_id: str, request: Request):
    """Retry a failed execution. Creates a new execution for the same workflow."""
    container = request.app.state.container

    db = SessionLocal()
    try:
        execution = db.query(WorkflowExecution).get(execution_id)
        if not execution:
            raise HTTPException(status_code=404, detail="Execution not found")

        if execution.status not in ("failed", "completed"):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot retry execution with status '{execution.status}'",
            )

        workflow_id = execution.workflow_id

        # Get original params from the first node's input
        first_node = (
            db.query(ExecutionNode)
            .filter(ExecutionNode.execution_id == execution_id)
            .first()
        )
        params = first_node.input if first_node and first_node.input else {}
    finally:
        db.close()

    # Create new execution via the container
    engine = container.create_workflow_engine(workflow_id, params)

    # Run in background
    async def _run():
        try:
            await engine.execute()
        except Exception as e:
            logger.error(f"Retry execution failed: {e}")

    asyncio.create_task(_run())

    return RetryResponse(
        execution_id=engine.execution_id or "",
        status="pending",
    )


@router.delete("/{execution_id}")
async def abort_execution(execution_id: str, request: Request):
    """Abort a running execution and cleanup its sessions."""
    container = request.app.state.container

    db = SessionLocal()
    try:
        execution = db.query(WorkflowExecution).get(execution_id)
        if not execution:
            raise HTTPException(status_code=404, detail="Execution not found")

        if execution.status not in ("pending", "running"):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot abort execution with status '{execution.status}'",
            )

        # Mark execution as failed
        execution.status = "failed"
        db.commit()

        # Cleanup sessions
        from main.framework.core.session_cleanup import cleanup_workflow_sessions
        cleanup_workflow_sessions(execution_id)

        return {"execution_id": execution_id, "status": "aborted"}
    finally:
        db.close()
