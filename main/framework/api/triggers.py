"""Workflow trigger and execution status APIs."""

from __future__ import annotations

import contextlib
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from main.framework.core.container import get_service
from main.framework.models.workflow import Workflow
from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution
from main.framework.repositories.execution_repo import ExecutionRepository
from main.framework.repositories.workflow_repo import WorkflowRepository

router = APIRouter(prefix="/api/v1", tags=["triggers"])


class TriggerRequest(BaseModel):
    params: dict = {}


class TriggerResponse(BaseModel):
    execution_id: str


class NodeStatus(BaseModel):
    node_id: str
    agent: str
    status: str
    output: dict | None = None
    error: str | None = None


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


def _get_execution_or_404(
    execution_id: str,
    exec_repo: ExecutionRepository,
) -> WorkflowExecution:
    """Fetch execution or raise 404."""
    execution = exec_repo.get_execution(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    return execution


def _get_workflow_or_404(
    workflow_id: str,
    wf_repo: WorkflowRepository,
) -> Workflow:
    """Fetch workflow or raise 404."""
    workflow = wf_repo.get(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow


async def _run_workflow_async(workflow_id: str, params: dict, execution_id: str, container):
    """Background task to execute workflow."""
    wf_repo = container.workflow_repo
    exec_repo = container.execution_repo

    try:
        workflow = wf_repo.get(workflow_id)
        if not workflow:
            return

        # Update execution status
        exec_repo.update_execution(execution_id, status="running")

        # Create all ExecutionNode records
        for node in workflow.nodes or []:
            agent = node.get("agent", "")
            if not agent:
                data = node.get("data", {})
                if isinstance(data, dict):
                    agent = data.get("agentType", "") or data.get("label", "")
            exec_repo.create_node(
                execution_id=execution_id,
                node_id=node["id"],
                agent=agent,
                status="pending",
                input=params,
            )

        engine = container.create_workflow_engine(workflow_id, params, execution_id=execution_id)
        await engine.execute()

    except Exception as e:
        logger.error(f"Workflow execution failed: {e}", exc_info=True)
        with contextlib.suppress(Exception):
            exec_repo.update_execution(execution_id, status="failed")


@router.post("/workflows/{workflow_id}/trigger", status_code=status.HTTP_202_ACCEPTED)
async def trigger_workflow(
    workflow_id: str,
    payload: TriggerRequest,
    request: Request,
    wf_repo: WorkflowRepository = Depends(get_service(WorkflowRepository)),
    exec_repo: ExecutionRepository = Depends(get_service(ExecutionRepository)),
):
    """Trigger a workflow execution asynchronously."""
    _get_workflow_or_404(workflow_id, wf_repo)
    container = request.app.state.container

    execution = exec_repo.create_execution(workflow_id, status="pending")
    exec_id = str(execution.id)

    import asyncio

    asyncio.create_task(_run_workflow_async(workflow_id, payload.params, exec_id, container))

    return TriggerResponse(execution_id=exec_id)


@router.get("/executions/{execution_id}/status", response_model=ExecutionStatusResponse)
async def get_execution_status(
    execution_id: str,
    exec_repo: ExecutionRepository = Depends(get_service(ExecutionRepository)),
):
    """Get current execution status including all node statuses."""
    execution = _get_execution_or_404(execution_id, exec_repo)
    nodes = exec_repo.get_execution_nodes(execution_id)

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


@router.get("/executions/{execution_id}/result", response_model=ExecutionResultResponse)
async def get_execution_result(
    execution_id: str,
    exec_repo: ExecutionRepository = Depends(get_service(ExecutionRepository)),
):
    """Get full execution result with all node outputs."""
    execution = _get_execution_or_404(execution_id, exec_repo)

    if str(execution.status) not in ("completed", "failed"):
        raise HTTPException(
            status_code=400,
            detail=f"Execution not yet completed (status: {execution.status})",
        )

    nodes = exec_repo.get_execution_nodes(execution_id)
    results = {str(n.node_id): dict(n.output) if n.output else {} for n in nodes if n.output}
    return ExecutionResultResponse(
        execution_id=str(execution.id),
        workflow_id=str(execution.workflow_id),
        status=str(execution.status),
        results=results,
    )
