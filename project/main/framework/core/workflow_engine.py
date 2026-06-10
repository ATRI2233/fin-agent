"""WorkflowEngine — thin wrapper around WorkflowService.

Backward-compatible: same constructor signature, same execute() API.
Delegates to WorkflowService for orchestration + NodeExecutorRegistry for dispatch.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any

from main.framework.core.retry_handler import WorkflowRetryHandler  # noqa: F401 — still needed
from main.framework.core.workflow.node_executors.registry import default_registry
from main.framework.services.workflow_graph import (
    build_predecessors,
    find_downstream,
    is_leaf,
    is_only_successor,
)
from main.framework.services.workflow_service import WorkflowService

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from main.framework.core.agent_dispatcher import AgentDispatcher

logger = logging.getLogger(__name__)

StatusCallback = Callable[[str, str, str], Awaitable[None]]


# ------------------------------------------------------------------
# Lightweight protocol adapters for WorkflowService dependencies
# ------------------------------------------------------------------


class _WorkflowRepoAdapter:
    """Wraps a SQLAlchemy session to satisfy WorkflowRepositoryProtocol."""

    def __init__(self, db: Any) -> None:
        self._db = db

    def get(self, workflow_id: str) -> Any:
        from main.framework.models.workflow import Workflow

        return self._db.query(Workflow).filter(Workflow.id == workflow_id).first()


class _ExecServiceAdapter:
    """Wraps a SQLAlchemy session to satisfy ExecutionServiceProtocol."""

    def __init__(self, db: Any) -> None:
        self._db = db

    def create_execution_for_workflow(
        self,
        workflow: Any,
        params: dict[str, Any],
        db: Any = None,
    ) -> Any:
        from main.framework.models.workflow_execution import (
            ExecutionNode,
            WorkflowExecution,
        )

        db = db or self._db
        execution = WorkflowExecution(
            workflow_id=str(workflow.id),
            status="pending",
        )
        db.add(execution)
        db.flush()
        for node in workflow.nodes or []:
            agent = node.get("agent", "")
            if not agent:
                data = node.get("data", {})
                if isinstance(data, dict):
                    agent = data.get("agentType", "") or data.get("label", "")
            db.add(
                ExecutionNode(
                    execution_id=execution.id,
                    node_id=node["id"],
                    agent=agent,
                    status="pending",
                    input=params,
                )
            )
        db.flush()
        return execution

    def mark_downstream_skipped(
        self,
        node_id: str,
        edges: list[dict],
        db: Any = None,
    ) -> list[str]:
        from datetime import UTC, datetime

        from main.framework.models.workflow_execution import ExecutionNode

        db = db or self._db
        downstream_ids = find_downstream(node_id, edges)
        if not downstream_ids:
            return []
        rows = db.query(ExecutionNode).filter(ExecutionNode.node_id.in_(downstream_ids)).all()
        for row in rows:
            row.status = "skipped"
            row.completed_at = datetime.now(UTC)
        db.flush()
        return downstream_ids


# ------------------------------------------------------------------
# WorkflowEngine
# ------------------------------------------------------------------


class WorkflowEngine:
    """Executes workflow DAG with topological ordering and parallel execution.

    Thin wrapper: delegates orchestration to :class:`WorkflowService` and
    node dispatch to the :class:`NodeExecutorRegistry`.  The constructor
    signature and public API are unchanged for backward compatibility.
    """

    def __init__(
        self,
        workflow_id: str,
        params: dict[str, Any],
        dispatcher: AgentDispatcher,
        db: Any = None,
        status_callback: StatusCallback | None = None,
        execution_id: str | None = None,
        exec_repo: Any = None,
        workflow_repo: Any = None,
    ):
        self.workflow_id = workflow_id
        self.params = params
        self._dispatcher = dispatcher
        self.db = db
        self._status_callback = status_callback or self._noop_callback
        self.execution_id: str | None = execution_id
        self.nodes: list[dict] = []
        self.edges: list[dict] = []
        self._results: dict[str, Any] = {}
        self._failed_nodes: set[str] = set()
        self._skipped_nodes: set[str] = set()
        self._chain_sessions: dict[str, str] = {}
        self._exec_repo = exec_repo
        self._workflow_repo = workflow_repo
        self._service: WorkflowService | None = None

    # ------------------------------------------------------------------
    # Service lifecycle
    # ------------------------------------------------------------------

    def _get_service(self) -> WorkflowService:
        """Return (lazily created) WorkflowService with protocol adapters."""
        if self._service is None:
            wf_repo = self._workflow_repo or _WorkflowRepoAdapter(self.db)
            exec_svc = self._exec_repo or _ExecServiceAdapter(self.db)
            self._service = WorkflowService(
                workflow_repo=wf_repo,
                exec_service=exec_svc,
                registry=default_registry,
                dispatcher=self._dispatcher,
            )
        return self._service

    def _sync_from_service(self, service: WorkflowService) -> None:
        """Copy service state back for collect_results / cleanup compat."""
        self._results = service._results
        self._failed_nodes = service._failed_nodes
        self._skipped_nodes = service._skipped_nodes
        self._chain_sessions = service._chain_sessions
        self.execution_id = service.execution_id
        self.nodes = service.nodes
        self.edges = service.edges

    @staticmethod
    async def _noop_callback(_status: str, _msg: str, _agent: str) -> None:
        pass

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    async def execute(
        self,
        db: Any = None,
        status_callback: StatusCallback | None = None,
        execution_id: str | None = None,
    ) -> dict[str, Any]:
        """Execute the workflow DAG.  Delegates to WorkflowService.run().

        Backward-compatible: callers that pass no args still work (values
        fall back to the constructor-provided defaults).
        """
        service = self._get_service()
        result = await service.run(
            workflow_id=self.workflow_id,
            params=self.params,
            db=db or self.db,
            status_callback=status_callback or self._status_callback,
            execution_id=execution_id or self.execution_id,
        )
        self._sync_from_service(service)
        return result

    # ------------------------------------------------------------------
    # Node execution — registry lookup + delegate
    # ------------------------------------------------------------------

    async def execute_node(self, node_id: str) -> dict[str, Any]:
        """Execute a single node via registry lookup + delegate to service."""
        service = self._get_service()
        exec_id = self.execution_id or ""
        return await service.execute_node(node_id, exec_id, self.db)

    # ------------------------------------------------------------------
    # Failure handling — delegate to service
    # ------------------------------------------------------------------

    async def handle_failure(self, node_id: str, error: Exception) -> None:
        """Record failure and cascade skip to downstream nodes."""
        service = self._get_service()
        await service.handle_failure(node_id, error, self.db)

    # ------------------------------------------------------------------
    # Session cleanup (thin wrapper)
    # ------------------------------------------------------------------

    async def _cleanup_sessions(self) -> None:
        """Abort all sessions created during this execution."""
        session_ids = list(set(self._chain_sessions.values()))
        if not session_ids:
            return
        try:
            results = await self._dispatcher.backend.cleanup_sessions(session_ids)
            failed = [k for k, v in results.items() if v != "cleaned"]
            if failed:
                logger.warning(f"Some sessions failed to clean up: {failed}")
        except Exception as e:
            logger.warning(f"Session cleanup failed: {e}")

    # ------------------------------------------------------------------
    # Graph helpers — delegate to workflow_graph module
    # ------------------------------------------------------------------

    def _build_predecessors(self) -> dict[str, list[str]]:
        return build_predecessors(self.edges)

    def _find_downstream(self, node_id: str) -> list[str]:
        return find_downstream(node_id, self.edges)

    def _is_leaf(self, node_id: str) -> bool:
        return is_leaf(node_id, self.edges)

    def _is_only_successor(self, node_id: str, pred_id: str) -> bool:
        return is_only_successor(node_id, pred_id, self.edges)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _get_agent_name(node: dict) -> str:
        """Get agent name from node, with fallback to data.agentType / data.label."""
        agent = node.get("agent", "")
        if agent:
            return agent
        data = node.get("data", {})
        if isinstance(data, dict):
            return data.get("agentType", "") or data.get("label", "")
        return ""

    def collect_results(self) -> dict[str, Any]:
        """Return a serialisable summary of the execution."""
        return {
            "execution_id": self.execution_id,
            "workflow_id": self.workflow_id,
            "status": "failed" if self._failed_nodes else "completed",
            "results": self._results,
            "failed_nodes": list(self._failed_nodes),
            "skipped_nodes": list(self._skipped_nodes),
        }

    def _find_node(self, node_id: str) -> dict | None:
        for node in self.nodes:
            if node.get("id") == node_id:
                return node
        return None
