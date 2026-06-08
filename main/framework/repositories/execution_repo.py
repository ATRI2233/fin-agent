"""Repository for workflow execution and execution node persistence."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from main.framework.models.database import SessionLocal
from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution


class ExecutionRepository:
    """Encapsulates all DB operations for WorkflowExecution and ExecutionNode."""

    def __init__(self, session_factory=SessionLocal):
        self._sf = session_factory

    # ------------------------------------------------------------------
    # WorkflowExecution
    # ------------------------------------------------------------------

    def create_execution(self, workflow_id: str, **kwargs: Any) -> WorkflowExecution:
        with self._sf() as db:
            exec_ = WorkflowExecution(workflow_id=workflow_id, **kwargs)
            db.add(exec_)
            db.commit()
            db.refresh(exec_)
            return exec_

    def get_execution(self, execution_id: str) -> WorkflowExecution | None:
        with self._sf() as db:
            return db.query(WorkflowExecution).get(execution_id)

    def update_execution(self, execution_id: str, **kwargs: Any) -> None:
        with self._sf() as db:
            exec_ = db.query(WorkflowExecution).get(execution_id)
            if exec_:
                for k, v in kwargs.items():
                    setattr(exec_, k, v)
                db.commit()

    # ------------------------------------------------------------------
    # ExecutionNode
    # ------------------------------------------------------------------

    def create_node(
        self, execution_id: str, node_id: str, agent: str, **kwargs: Any
    ) -> ExecutionNode:
        with self._sf() as db:
            node = ExecutionNode(
                execution_id=execution_id,
                node_id=node_id,
                agent=agent,
                **kwargs,
            )
            db.add(node)
            db.commit()
            db.refresh(node)
            return node

    def get_node(
        self, node_id: str, execution_id: str
    ) -> ExecutionNode | None:
        with self._sf() as db:
            return (
                db.query(ExecutionNode)
                .filter(
                    ExecutionNode.execution_id == execution_id,
                    ExecutionNode.node_id == node_id,
                )
                .first()
            )

    def update_node(
        self, node_id: str, execution_id: str, **kwargs: Any
    ) -> None:
        with self._sf() as db:
            node = (
                db.query(ExecutionNode)
                .filter(
                    ExecutionNode.execution_id == execution_id,
                    ExecutionNode.node_id == node_id,
                )
                .first()
            )
            if node:
                for k, v in kwargs.items():
                    setattr(node, k, v)
                db.commit()

    def get_execution_nodes(self, execution_id: str) -> list[ExecutionNode]:
        with self._sf() as db:
            return (
                db.query(ExecutionNode)
                .filter(ExecutionNode.execution_id == execution_id)
                .all()
            )

    def get_failed_nodes(self, execution_id: str) -> list[ExecutionNode]:
        with self._sf() as db:
            return (
                db.query(ExecutionNode)
                .filter(
                    ExecutionNode.execution_id == execution_id,
                    ExecutionNode.status == "failed",
                )
                .all()
            )

    def mark_node_completed(
        self, node_id: str, execution_id: str, output: dict, session_id: str = ""
    ) -> None:
        self.update_node(
            node_id,
            execution_id,
            status="completed",
            output=output,
            completed_at=datetime.utcnow(),
            hapi_session_id=session_id,
        )

    def mark_node_failed(
        self, node_id: str, execution_id: str, error: str
    ) -> None:
        self.update_node(node_id, execution_id, status="failed", error=error)
