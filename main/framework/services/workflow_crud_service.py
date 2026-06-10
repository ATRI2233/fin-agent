"""WorkflowCrudService — CRUD + stats for workflow management.

Extracted from ``api/workflows.py`` so the controller layer stays thin.
All DB access goes through ``WorkflowRepository`` and ``ExecutionRepository``;
the service never imports ``SessionLocal`` or ORM models directly.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import case, func

from main.framework.core.workflow_parser import validate_dag
from main.framework.repositories.conversation_repo import ConversationRepository
from main.framework.repositories.execution_repo import ExecutionRepository
from main.framework.repositories.workflow_repo import WorkflowRepository
from main.framework.services.exceptions import NotFoundError, ServiceError

logger = logging.getLogger(__name__)

MAX_NODES = 50


class WorkflowCrudService:
    """Business logic for workflow CRUD, stats, and execution listing.

    Dependencies are injected via constructor — no direct DB access.
    """

    def __init__(
        self,
        workflow_repo: WorkflowRepository,
        exec_repo: ExecutionRepository,
    ) -> None:
        self._workflow_repo = workflow_repo
        self._exec_repo = exec_repo

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Create a new workflow after validating the DAG.

        Raises ``ServiceError`` if validation fails.
        """
        nodes = payload.get("nodes", [])
        edges = payload.get("edges", [])

        if len(nodes) > MAX_NODES:
            raise ServiceError(f"Workflow cannot have more than {MAX_NODES} nodes")

        if not validate_dag(nodes, edges):
            raise ServiceError("Invalid DAG: cycle detected")

        workflow = self._workflow_repo.create(
            name=payload["name"],
            description=payload.get("description"),
            nodes=nodes,
            edges=edges,
            trigger_type=payload.get("trigger_type", "manual"),
            config=payload.get("config", {}),
            status="draft",
        )
        return self._to_response(workflow)

    def get(self, workflow_id: str) -> dict[str, Any]:
        """Get a workflow by ID.

        Raises ``NotFoundError`` if not found.
        """
        workflow = self._workflow_repo.get(workflow_id)
        if not workflow:
            raise NotFoundError(f"Workflow {workflow_id} not found")
        return self._to_response(workflow)

    def list_all(self) -> list[dict[str, Any]]:
        """List all workflows (summary view)."""
        workflows = self._workflow_repo.list(limit=1000)
        return [self._to_list_item(w) for w in workflows]

    def update(self, workflow_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Update a workflow. Re-validates DAG if nodes/edges changed.

        Raises ``NotFoundError`` if not found, ``ServiceError`` on validation failure.
        """
        workflow = self._workflow_repo.get(workflow_id)
        if not workflow:
            raise NotFoundError(f"Workflow {workflow_id} not found")

        update_fields: dict[str, Any] = {}
        for key in ("name", "description", "nodes", "edges", "trigger_type", "config"):
            if payload.get(key) is not None:
                update_fields[key] = payload[key]

        # Re-validate DAG if nodes or edges changed
        if "nodes" in update_fields or "edges" in update_fields:
            nodes = update_fields.get("nodes", workflow.nodes)
            edges = update_fields.get("edges", workflow.edges)
            if len(nodes) > MAX_NODES:
                raise ServiceError(f"Workflow cannot have more than {MAX_NODES} nodes")
            if not validate_dag(nodes, edges):
                raise ServiceError("Invalid DAG: cycle detected")

        updated = self._workflow_repo.update(workflow_id, **update_fields)
        return self._to_response(updated)

    def delete(self, workflow_id: str) -> None:
        """Delete a workflow and all its executions.

        Raises ``NotFoundError`` if not found.
        """
        workflow = self._workflow_repo.get(workflow_id)
        if not workflow:
            raise NotFoundError(f"Workflow {workflow_id} not found")

        # Delete executions first (cascade)
        with self._exec_repo._session() as db:
            from main.framework.models.workflow_execution import WorkflowExecution

            db.query(WorkflowExecution).filter(
                WorkflowExecution.workflow_id == workflow_id
            ).delete()
            db.commit()

        self._workflow_repo.delete(workflow_id)

    # ------------------------------------------------------------------
    # Stats & execution listing
    # ------------------------------------------------------------------

    def get_stats(self) -> dict[str, Any]:
        """Aggregated workflow execution statistics."""
        with self._exec_repo._session() as db:
            from main.framework.models.workflow_execution import WorkflowExecution

            rows = (
                db.query(WorkflowExecution.status, func.count(WorkflowExecution.id))
                .group_by(WorkflowExecution.status)
                .all()
            )
        counts: dict[str, int] = {status: cnt for status, cnt in rows}

        running = counts.get("running", 0)
        completed = counts.get("completed", 0)
        failed = counts.get("failed", 0)
        terminal = completed + failed
        success_rate = round(completed / terminal * 100, 1) if terminal > 0 else None

        return {
            "running": running,
            "completed": completed,
            "failed": failed,
            "successRate": success_rate,
        }

    def list_executions(
        self,
        workflow_id: str,
        offset: int = 0,
        limit: int = 20,
        status: str | None = None,
    ) -> dict[str, Any]:
        """Paginated execution history with node summaries.

        Raises ``NotFoundError`` if workflow not found.
        """
        workflow = self._workflow_repo.get(workflow_id)
        if not workflow:
            raise NotFoundError(f"Workflow {workflow_id} not found")

        with self._exec_repo._session() as db:
            from main.framework.models.workflow_execution import (
                ExecutionNode,
                WorkflowExecution,
            )

            query = db.query(WorkflowExecution).filter(
                WorkflowExecution.workflow_id == workflow_id
            )
            if status:
                query = query.filter(WorkflowExecution.status == status)

            total = query.count()
            executions = (
                query.order_by(WorkflowExecution.started_at.desc())
                .offset(offset)
                .limit(limit)
                .all()
            )

            execution_ids = [e.id for e in executions]
            node_summary_map: dict[str, dict[str, int]] = {}
            if execution_ids:
                node_counts = (
                    db.query(
                        ExecutionNode.execution_id,
                        func.count(ExecutionNode.id).label("total"),
                        func.sum(
                            case((ExecutionNode.status == "completed", 1), else_=0)
                        ).label("completed"),
                        func.sum(
                            case((ExecutionNode.status == "failed", 1), else_=0)
                        ).label("failed"),
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

    # ------------------------------------------------------------------
    # Response helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _to_response(workflow: Any) -> dict[str, Any]:
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

    @staticmethod
    def _to_list_item(workflow: Any) -> dict[str, Any]:
        return {
            "id": workflow.id,
            "name": workflow.name,
            "status": workflow.status,
            "node_count": len(workflow.nodes) if workflow.nodes else 0,
            "created_at": workflow.created_at.isoformat() if workflow.created_at else None,
        }
