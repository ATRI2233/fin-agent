"""Execution status / result APIs.

The workflow *trigger* endpoint (``POST /api/v1/workflows/{id}/trigger``) used
to live here but has moved to ``controllers/workflows.py`` as part of the Wave
2 pilot (it is a workflow-management concern, not an execution-status concern).
This module retains the execution-lifecycle read APIs:

  GET /api/v1/executions/{id}/status
  GET /api/v1/executions/{id}/result
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from main.framework.core.container import get_service
from main.framework.repositories.execution_repo import ExecutionRepository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["triggers"])


# ---- Response models ----


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
):
    """Fetch execution or raise 404."""
    execution = exec_repo.get_execution(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    return execution


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
