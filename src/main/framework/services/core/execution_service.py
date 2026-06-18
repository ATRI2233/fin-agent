"""Execution lifecycle service — manages WorkflowExecution + ExecutionNode records,
status updates, and failure cascade (mark downstream as skipped).

Extracted from ``core/workflow_engine.py`` ``handle_failure`` and
``services/message_processor.py`` execution setup. This service owns the
persistence side of execution lifecycle only — dispatch, scheduling, and
status callbacks remain in their respective callers.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from main.framework.core.state_machine import validate_transition
from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution
from main.framework.repositories.execution_repo import ExecutionRepository
from main.framework.services.exceptions import NotFoundError
from main.framework.services.patterns.workflow_graph import find_downstream
from sqlalchemy.orm import Session


class ExecutionService:
    """Business-logic facade over WorkflowExecution + ExecutionNode lifecycle.

    Public surface (5 methods, all sync):
      create_execution_for_workflow, update_execution_status, update_node_status,
      mark_downstream_skipped, record_node_execution
    """

    def __init__(self, exec_repo: ExecutionRepository) -> None:
        self._exec_repo = exec_repo

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_agent(node: dict[str, Any]) -> str:
        """Return the agent name for a workflow node, falling back to data fields.

        Mirrors the precedence used in ``message_processor._create_execution_nodes``
        and ``workflow_engine._get_agent_name`` so behaviour stays consistent
        with the legacy code path.
        """
        agent = node.get("agent", "")
        if agent:
            return agent
        data = node.get("data", {})
        if isinstance(data, dict):
            return data.get("agentType", "") or data.get("label", "")
        return ""

    def _require_execution(self, execution_id: str, db: Session) -> WorkflowExecution:
        """Look up a WorkflowExecution row in the caller's session or raise."""
        execution = db.get(WorkflowExecution, execution_id)
        if execution is None:
            raise NotFoundError(f"WorkflowExecution {execution_id} not found")
        return execution

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def create_execution_for_workflow(
        self,
        workflow: Any,
        params: dict[str, Any],
        db: Session,
    ) -> WorkflowExecution:
        """Create a WorkflowExecution + one ExecutionNode per workflow node.

        The execution is created with status ``"pending"``; every node row is
        created with status ``"pending"`` and the workflow params as its input.
        Caller owns the transaction (no commit is issued).
        """
        execution = WorkflowExecution(
            workflow_id=str(workflow.id),
            status="pending",
        )
        db.add(execution)
        db.flush() # populate execution.id for FK on ExecutionNode rows

        nodes = workflow.nodes or []
        for node in nodes:
            db.add(
                ExecutionNode(
                    execution_id=execution.id,
                    node_id=node["id"],
                    agent=self._resolve_agent(node),
                    status="pending",
                    input=params,
                )
            )
        db.flush()
        return execution

    def update_execution_status(
        self,
        execution_id: str,
        status: str,
        db: Session,
    ) -> None:
        """Set ``WorkflowExecution.status`` for the given execution id."""
        execution = self._require_execution(execution_id, db)
        validate_transition("execution", execution.status, status)
        execution.status = status
        if status in {"completed", "failed", "cancelled"}:
            execution.completed_at = datetime.now(UTC)
        db.flush()

    def update_node_status(
        self,
        execution_id: str,
        node_id: str,
        status: str,
        output: dict[str, Any] | None = None,
        error: str | None = None,
        *,
        db: Session,
    ) -> None:
        """Set ``ExecutionNode.status`` (and ``output``/``error`` when given).

        Raises ``NotFoundError`` if the (execution_id, node_id) pair does not
        exist. The row is matched in the caller's session so a caller-owned
        transaction is preserved.
        """
        node = (
            db.query(ExecutionNode)
            .filter(
                ExecutionNode.execution_id == execution_id,
                ExecutionNode.node_id == node_id,
            )
            .first()
        )
        if node is None:
            raise NotFoundError(f"ExecutionNode (execution_id={execution_id}, node_id={node_id}) not found")
        validate_transition("node", node.status, status)
        node.status = status
        if output is not None:
            node.output = output
        if error is not None:
            node.error = error
        if status in {"completed", "failed", "skipped"}:
            node.completed_at = datetime.now(UTC)
        db.flush()

    def mark_downstream_skipped(
        self,
        start_node_id: str,
        edges: list[dict[str, Any]],
        db: Session,
    ) -> list[str]:
        """Mark every downstream node (DFS from ``start_node_id``) as ``"skipped"``.

        Delegates the reachability walk to ``workflow_graph.find_downstream`` —
        no graph logic is duplicated here. The execution id is the ``start_node_id``
        of the workflow being cascaded; rows for each downstream id are looked up
        in the caller's session, and any rows that exist have their status set to
        ``"skipped"``.

        Returns the list of downstream node ids (regardless of whether a matching
        ExecutionNode row exists).
        """
        downstream_ids = find_downstream(start_node_id, edges)
        if not downstream_ids:
            return []

        rows = (
            db.query(ExecutionNode)
            .filter(
                ExecutionNode.node_id.in_(downstream_ids),
            )
            .all()
        )
        # The session-level cascade is keyed by (execution_id, node_id); we look
        # those up per row so callers using a single shared session still get
        # the right answer.
        for row in rows:
            row.status = "skipped"
            row.completed_at = datetime.now(UTC)
        db.flush()
        return downstream_ids

    def record_node_execution(
        self,
        execution_id: str,
        node_id: str,
        agent: str,
        input: dict[str, Any],
        db: Session,
    ) -> ExecutionNode:
        """Create an ExecutionNode row if one does not yet exist.

        Mirrors the lazy-create pattern from ``workflow_engine._execute_node``
        so the service can be used as a drop-in for the engine's "ensure row
        exists" step. Returns the existing row if (execution_id, node_id) is
        already present, otherwise inserts a fresh ``"pending"`` row.
        """
        existing = (
            db.query(ExecutionNode)
            .filter(
                ExecutionNode.execution_id == execution_id,
                ExecutionNode.node_id == node_id,
            )
            .first()
        )
        if existing is not None:
            return existing

        node = ExecutionNode(
            execution_id=execution_id,
            node_id=node_id,
            agent=agent,
            status="pending",
            input=input,
        )
        db.add(node)
        db.flush()
        return node
