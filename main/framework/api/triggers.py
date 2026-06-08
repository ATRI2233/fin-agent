"""Workflow trigger and execution status APIs."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel
from typing import Optional

from main.framework.models.database import SessionLocal
from main.framework.models.workflow import Workflow
from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution

router = APIRouter(prefix="/api", tags=["triggers"])


class TriggerRequest(BaseModel):
    params: dict = {}


class TriggerResponse(BaseModel):
    execution_id: str


class NodeStatus(BaseModel):
    node_id: str
    agent: str
    status: str
    output: Optional[dict] = None
    error: Optional[str] = None


class ExecutionStatusResponse(BaseModel):
    execution_id: str
    workflow_id: str
    status: str
    nodes: list[NodeStatus]


class ExecutionResultResponse(BaseModel):
    execution_id: str
    workflow_id: str
    status: str
    results: dict[str, dict]


def _get_execution_or_404(execution_id: str) -> WorkflowExecution:
    """Fetch execution or raise 404."""
    db = SessionLocal()
    try:
        execution = (
            db.query(WorkflowExecution)
            .filter(WorkflowExecution.id == execution_id)
            .first()
        )
        if not execution:
            raise HTTPException(status_code=404, detail="Execution not found")
        return execution
    finally:
        db.close()


def _get_workflow_or_404(workflow_id: str) -> Workflow:
    """Fetch workflow or raise 404."""
    db = SessionLocal()
    try:
        workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return workflow
    finally:
        db.close()


async def _run_workflow_async(workflow_id: str, params: dict, execution_id: str, container):
    """Background task to execute workflow."""
    engine = container.create_workflow_engine(workflow_id, params)
    engine.execution_id = execution_id
    try:
        await engine.execute()
    except Exception:
        db = SessionLocal()
        try:
            execution = (
                db.query(WorkflowExecution)
                .filter(WorkflowExecution.id == execution_id)
                .first()
            )
            if execution and str(execution.status) == "running":
                execution.status = "failed"
                db.commit()
        finally:
            db.close()


@router.post("/workflows/{workflow_id}/trigger", status_code=status.HTTP_202_ACCEPTED)
async def trigger_workflow(workflow_id: str, payload: TriggerRequest, request: Request):
    """Trigger a workflow execution asynchronously."""
    _get_workflow_or_404(workflow_id)
    container = request.app.state.container

    db = SessionLocal()
    try:
        execution = WorkflowExecution(workflow_id=workflow_id, status="pending")
        db.add(execution)
        db.commit()

        import asyncio

        exec_id = str(execution.id)
        asyncio.create_task(
            _run_workflow_async(workflow_id, payload.params, exec_id, container)
        )

        return TriggerResponse(execution_id=exec_id)
    finally:
        db.close()


@router.get("/executions/{execution_id}/status", response_model=ExecutionStatusResponse)
async def get_execution_status(execution_id: str):
    """Get current execution status including all node statuses."""
    execution = _get_execution_or_404(execution_id)

    db = SessionLocal()
    try:
        nodes = (
            db.query(ExecutionNode)
            .filter(ExecutionNode.execution_id == execution_id)
            .all()
        )
        return ExecutionStatusResponse(
            execution_id=str(execution.id),
            workflow_id=str(execution.workflow_id),
            status=str(execution.status),
            nodes=[
                NodeStatus(
                    node_id=str(n.node_id),
                    agent=str(n.agent),
                    status=str(n.status),
                    output=dict(n.output) if n.output is not None else None,
                    error=str(n.error) if n.error is not None else None,
                )
                for n in nodes
            ],
        )
    finally:
        db.close()


@router.get("/executions/{execution_id}/result", response_model=ExecutionResultResponse)
async def get_execution_result(execution_id: str):
    """Get full execution result with all node outputs."""
    execution = _get_execution_or_404(execution_id)

    if str(execution.status) not in ("completed", "failed"):
        raise HTTPException(
            status_code=400,
            detail=f"Execution not yet completed (status: {execution.status})",
        )

    db = SessionLocal()
    try:
        nodes = (
            db.query(ExecutionNode)
            .filter(ExecutionNode.execution_id == execution_id)
            .all()
        )
        results = {
            str(n.node_id): dict(n.output) if n.output else {}
            for n in nodes
            if n.output
        }
        return ExecutionResultResponse(
            execution_id=str(execution.id),
            workflow_id=str(execution.workflow_id),
            status=str(execution.status),
            results=results,
        )
    finally:
        db.close()
