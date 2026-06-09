from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from main.framework.core.workflow_parser import validate_dag
from main.framework.models.database import get_db
from main.framework.models.workflow import Workflow
from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution

router = APIRouter(prefix="/api/v1/workflows", tags=["workflows"])

MAX_NODES = 50


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


class WorkflowResponse(BaseModel):
    id: str
    name: str
    description: str | None
    nodes: list[dict]
    edges: list[dict]
    trigger_type: str
    config: dict
    status: str
    created_at: str | None
    updated_at: str | None

    class Config:
        from_attributes = True


class WorkflowListItem(BaseModel):
    id: str
    name: str
    status: str
    node_count: int
    created_at: str | None

    class Config:
        from_attributes = True


class WorkflowExecutionResponse(BaseModel):
    execution_id: str

    class Config:
        from_attributes = True


def _workflow_response(workflow: Workflow) -> dict:
    return {
        "id": workflow.id,
        "name": workflow.name,
        "description": workflow.description,
        "nodes": workflow.nodes or [],
        "edges": workflow.edges or [],
        "trigger_type": getattr(workflow, "trigger_type", "manual"),
        "config": getattr(workflow, "config", {}),
        "status": workflow.status,
        "created_at": workflow.created_at.isoformat() if workflow.created_at else None,
        "updated_at": workflow.updated_at.isoformat() if workflow.updated_at else None,
    }


def _workflow_list_item(workflow: Workflow) -> dict:
    return {
        "id": workflow.id,
        "name": workflow.name,
        "status": workflow.status,
        "node_count": len(workflow.nodes) if workflow.nodes else 0,
        "created_at": workflow.created_at.isoformat() if workflow.created_at else None,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_workflow(payload: WorkflowCreate, db: Session = Depends(get_db)):
    """Create a new workflow."""
    # Validate node count
    if len(payload.nodes) > MAX_NODES:
        raise HTTPException(
            status_code=400, detail=f"Workflow cannot have more than {MAX_NODES} nodes"
        )

    # Validate DAG
    if not validate_dag(payload.nodes, payload.edges):
        raise HTTPException(status_code=400, detail="Invalid DAG: cycle detected")

    workflow = Workflow(
        name=payload.name,
        description=payload.description,
        nodes=payload.nodes,
        edges=payload.edges,
        trigger_type=payload.trigger_type,
        config=payload.config,
        status="draft",
    )
    db.add(workflow)
    db.commit()
    db.refresh(workflow)
    return _workflow_response(workflow)


@router.get("")
async def list_workflows(db: Session = Depends(get_db)):
    """List all workflows."""
    workflows = db.query(Workflow).order_by(Workflow.created_at.desc()).all()
    return [_workflow_list_item(w) for w in workflows]


@router.get("/stats")
async def get_workflow_stats(db: Session = Depends(get_db)):
    """Get aggregated workflow execution statistics."""
    # Count executions by status
    rows = (
        db.query(WorkflowExecution.status, func.count(WorkflowExecution.id))
        .group_by(WorkflowExecution.status)
        .all()
    )
    counts: dict[str, int] = {status: cnt for status, cnt in rows}

    running = counts.get("running", 0)
    completed = counts.get("completed", 0)
    failed = counts.get("failed", 0)

    # Success rate = completed / (completed + failed), avoid division by zero
    terminal = completed + failed
    success_rate: float | None = (
        round(completed / terminal * 100, 1) if terminal > 0 else None
    )

    return {
        "running": running,
        "completed": completed,
        "failed": failed,
        "successRate": success_rate,
    }


@router.get("/{workflow_id}/executions")
async def list_workflow_executions(
    workflow_id: str,
    offset: int = 0,
    limit: int = 20,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    """List execution history for a specific workflow."""
    # Verify workflow exists
    workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Build query
    query = db.query(WorkflowExecution).filter(
        WorkflowExecution.workflow_id == workflow_id
    )

    # Apply status filter
    if status:
        query = query.filter(WorkflowExecution.status == status)

    # Get total count
    total = query.count()

    # Get paginated results, ordered by started_at descending
    executions = (
        query.order_by(WorkflowExecution.started_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    # Get node summaries for the fetched executions
    execution_ids = [e.id for e in executions]

    node_summary_map: dict[str, dict[str, int]] = {}
    if execution_ids:
        node_counts = (
            db.query(
                ExecutionNode.execution_id,
                func.count(ExecutionNode.id).label("total"),
                func.sum(case((ExecutionNode.status == "completed", 1), else_=0)).label(
                    "completed"
                ),
                func.sum(case((ExecutionNode.status == "failed", 1), else_=0)).label(
                    "failed"
                ),
            )
            .filter(ExecutionNode.execution_id.in_(execution_ids))
            .group_by(ExecutionNode.execution_id)
            .all()
        )
        node_summary_map = {
            row.execution_id: {
                "total": row.total,
                "completed": row.completed,
                "failed": row.failed,
            }
            for row in node_counts
        }

    # Build response
    execution_list = []
    for e in executions:
        duration_ms = None
        if e.started_at and e.completed_at:
            delta = e.completed_at - e.started_at
            duration_ms = int(delta.total_seconds() * 1000)

        execution_list.append(
            {
                "id": e.id,
                "workflow_id": e.workflow_id,
                "status": e.status,
                "started_at": e.started_at.isoformat() if e.started_at else None,
                "completed_at": e.completed_at.isoformat() if e.completed_at else None,
                "duration_ms": duration_ms,
                "nodes_summary": node_summary_map.get(
                    e.id, {"total": 0, "completed": 0, "failed": 0}
                ),
            }
        )

    return {
        "executions": execution_list,
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@router.get("/{workflow_id}")
async def get_workflow(workflow_id: str, db: Session = Depends(get_db)):
    """Get a workflow by ID."""
    workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return _workflow_response(workflow)


@router.put("/{workflow_id}")
async def update_workflow(
    workflow_id: str, payload: WorkflowUpdate, db: Session = Depends(get_db)
):
    """Update a workflow."""
    workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Update fields if provided
    if payload.name is not None:
        workflow.name = payload.name
    if payload.description is not None:
        workflow.description = payload.description
    if payload.nodes is not None:
        workflow.nodes = payload.nodes
    if payload.edges is not None:
        workflow.edges = payload.edges
    if payload.trigger_type is not None:
        workflow.trigger_type = payload.trigger_type
    if payload.config is not None:
        workflow.config = payload.config

    # Re-validate DAG if nodes or edges changed
    if payload.nodes is not None or payload.edges is not None:
        if len(workflow.nodes) > MAX_NODES:
            raise HTTPException(
                status_code=400,
                detail=f"Workflow cannot have more than {MAX_NODES} nodes",
            )
        if not validate_dag(workflow.nodes, workflow.edges):
            raise HTTPException(status_code=400, detail="Invalid DAG: cycle detected")

    db.commit()
    db.refresh(workflow)
    return _workflow_response(workflow)


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(workflow_id: str, db: Session = Depends(get_db)):
    """Delete a workflow and all its executions."""
    workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Delete executions first
    db.query(WorkflowExecution).filter(
        WorkflowExecution.workflow_id == workflow_id
    ).delete()

    db.delete(workflow)
    db.commit()
