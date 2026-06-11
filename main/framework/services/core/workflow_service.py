"""WorkflowService — DAG orchestration. Replaces the outer loop of WorkflowEngine.execute(). Singleton that creates per-execution contexts."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from main.framework.core.workflow.node_executors.base import NodeContext
from main.framework.core.workflow_parser import (
    identify_parallel_branches,
    topological_sort,
)
from main.framework.services.patterns.workflow_graph import build_predecessors, find_downstream

if TYPE_CHECKING:
    # Forward reference; WorkflowEngine (W4.11) will depend on this service.
    from main.framework.core.workflow_engine import WorkflowEngine  # noqa: F401

logger = logging.getLogger(__name__)

StatusCallback = Callable[[str, str, str], Awaitable[None]]


# --------------------------------------------------------------------------
# Dependency protocols — decouple this service from the parallel W4.6/W4.9
# deliverables. The eventual concrete classes satisfy these structurally.
# --------------------------------------------------------------------------
#
# ExecutionService (W4.9) surface:
#   create_execution_for_workflow(workflow, params, db) -> WorkflowExecution
#   mark_downstream_skipped(node_id, edges, db) -> list[str]
#
# NodeExecutorRegistry (W4.6) surface:
#   get(node_type) -> NodeExecutor
#
# WorkflowRepository surface:
#   get(workflow_id) -> Workflow | None


@runtime_checkable
class ExecutionServiceProtocol(Protocol):
    def create_execution_for_workflow(self, workflow: Any, params: dict[str, Any], db: Any) -> Any: ...
    def mark_downstream_skipped(self, node_id: str, edges: list[dict], db: Any) -> list[str]: ...


@runtime_checkable
class NodeExecutorRegistryProtocol(Protocol):
    def get(self, node_type: str) -> Any: ...


@runtime_checkable
class WorkflowRepositoryProtocol(Protocol):
    def get(self, workflow_id: str) -> Any: ...


class WorkflowService:
    """Orchestrates workflow DAG execution — outer loop, level-walking, dispatch, failure cascade.

    Replaces :meth:`WorkflowEngine.execute`'s orchestration: load workflow,
    compute topological order + parallel branches, walk the graph level by
    level (running independent siblings via :func:`asyncio.gather`), and
    delegate per-node work to executors resolved from the registry. Failures
    cascade to downstream nodes via :class:`ExecutionServiceProtocol`.

    Singleton lifetime; per-execution state is built fresh inside :meth:`run`.
    """

    def __init__(
        self,
        workflow_repo: WorkflowRepositoryProtocol,
        exec_service: ExecutionServiceProtocol,
        registry: NodeExecutorRegistryProtocol,
        dispatcher: Any = None,
    ) -> None:
        self._workflow_repo = workflow_repo
        self._exec_service = exec_service
        self._registry = registry
        self._dispatcher = dispatcher  # for _cleanup_sessions

        # Per-execution state (reset by run()).
        self._results: dict[str, Any] = {}
        self._failed_nodes: set[str] = set()
        self._skipped_nodes: set[str] = set()
        self._chain_sessions: dict[str, str] = {}
        self._node_levels: dict[str, int] = {}
        self.nodes: list[dict] = []
        self.edges: list[dict] = []
        self.params: dict[str, Any] = {}
        self.execution_id: str | None = None

    # ------------------------------------------------------------------
    # Public entry point — mirrors WorkflowEngine.execute() outer loop
    # ------------------------------------------------------------------

    async def run(
        self,
        workflow_id: str,
        params: dict[str, Any],
        db: Any,
        status_callback: StatusCallback | None = None,
        execution_id: str | None = None,
    ) -> dict[str, Any]:
        """Execute the workflow DAG; return a serialisable result dict."""
        callback = status_callback or self._noop_callback
        self._reset_execution_state()
        self.params = dict(params or {})
        self.execution_id = execution_id

        try:
            with contextlib.suppress(Exception):
                db.commit()  # db may be None in unit tests

            # ---- Load workflow ----
            workflow = self._workflow_repo.get(workflow_id)
            if not workflow:
                raise ValueError(f"Workflow {workflow_id} not found")
            self.nodes = workflow.nodes or []
            self.edges = workflow.edges or []

            total_nodes = len(self.nodes)
            await callback("running", f"Workflow started with {total_nodes} node(s), executing...", "")

            # ---- Build execution plan ----
            execution_order = topological_sort(self.nodes, self.edges)
            if not execution_order:
                raise ValueError("Failed to compute topological order - possible cycle")
            parallel_branches = identify_parallel_branches(self.nodes, self.edges)
            predecessors = build_predecessors(self.edges)

            # ---- Ensure WorkflowExecution row exists ----
            if self.execution_id is None:
                execution = self._exec_service.create_execution_for_workflow(workflow, self.params, db)
                self.execution_id = str(execution.id)

            # ---- Walk the DAG ----
            await self._execute_in_order(execution_order, parallel_branches, predecessors, db, status_callback=callback)

            # ---- Final status + summary ----
            completed_count = total_nodes - len(self._failed_nodes) - len(self._skipped_nodes)
            final_status = "failed" if self._failed_nodes else "completed"
            summary = f"Workflow finished: {completed_count}/{total_nodes} nodes completed"
            if self._failed_nodes:
                summary += f", {len(self._failed_nodes)} failed"
            if self._skipped_nodes:
                summary += f", {len(self._skipped_nodes)} skipped"
            await callback(final_status, summary, "")

            return self.collect_results()
        finally:
            await self._cleanup_sessions()

    # ------------------------------------------------------------------
    # Execution ordering (was WorkflowEngine._execute_in_order)
    # ------------------------------------------------------------------

    async def _execute_in_order(
        self,
        execution_order: list[str],
        parallel_branches: dict[str, list[str]],
        predecessors: dict[str, list[str]],
        db: Any,
        status_callback: StatusCallback | None = None,
    ) -> None:
        """Walk the DAG level-by-level; independent siblings run in parallel via asyncio.gather."""
        levels: dict[int, list[str]] = {}
        for node_id in execution_order:
            level = self._compute_level(node_id, predecessors)
            levels.setdefault(level, []).append(node_id)

        for level in sorted(levels.keys()):
            nodes_to_run = [n for n in levels[level] if n not in self._skipped_nodes]
            if not nodes_to_run:
                continue

            can_parallel = all(
                pred not in self._failed_nodes and pred not in self._skipped_nodes
                for node in nodes_to_run
                for pred in predecessors.get(node, [])
            )

            if can_parallel and len(nodes_to_run) > 1:
                await asyncio.gather(*[self._execute_wrapped(nid, db) for nid in nodes_to_run])
            else:
                for node_id in nodes_to_run:
                    preds = predecessors.get(node_id, [])
                    if preds:
                        await self._wait_for_predecessors(preds)
                    await self._execute_wrapped(node_id, db)

    async def _execute_wrapped(self, node_id: str, db: Any) -> None:
        if node_id in self._failed_nodes or node_id in self._skipped_nodes:
            return
        # Guaranteed set by run() before this is reached.
        assert self.execution_id is not None
        try:
            await self.execute_node(node_id, self.execution_id, db)
            self._results.setdefault(node_id, {})
        except Exception as e:
            await self.handle_failure(node_id, e, db)

    async def _wait_for_predecessors(self, pred_ids: list[str]) -> None:
        for pred_id in pred_ids:
            while (
                pred_id not in self._results
                and pred_id not in self._failed_nodes
                and pred_id not in self._skipped_nodes
            ):
                await asyncio.sleep(0.1)

    def _compute_level(self, node_id: str, predecessors: dict[str, list[str]]) -> int:
        preds = predecessors.get(node_id, [])
        if not preds:
            level = 0
        else:
            max_pred_level = max((self._compute_level(p, predecessors) for p in preds), default=-1)
            level = max_pred_level + 1
        self._node_levels[node_id] = level
        return level

    # ------------------------------------------------------------------
    # Single node execution (was WorkflowEngine.execute_node)
    # ------------------------------------------------------------------

    async def execute_node(self, node_id: str, execution_id: str, db: Any) -> dict[str, Any]:
        """Resolve executor via the registry and run it with a :class:`NodeContext`."""
        node = self._find_node(node_id)
        if not node:
            raise ValueError(f"Node {node_id} not found")

        predecessor_ids = [e["source"] for e in self.edges if e.get("target") == node_id]
        executor = self._registry.get(node.get("type", "agent"))
        ctx = NodeContext(
            node=node,
            execution_id=execution_id,
            predecessor_ids=predecessor_ids,
            params=self.params,
            results=self._results,
        )
        # Edges are not part of NodeContext dataclass; agent executor reads
        # them via getattr() for serial-chain session reuse.
        ctx.edges = self.edges  # type: ignore[attr-defined]

        node_result = await executor.execute(ctx)
        if getattr(node_result, "session_id", None):
            self._chain_sessions[node_id] = node_result.session_id
        return {
            "result": getattr(node_result, "result", None),
            "output": getattr(node_result, "output", None),
            "session_id": getattr(node_result, "session_id", None),
        }

    # ------------------------------------------------------------------
    # Failure handling (was WorkflowEngine.handle_failure)
    # ------------------------------------------------------------------

    async def handle_failure(self, node_id: str, error: Exception, db: Any) -> None:
        """Record failure on ``node_id`` and cascade skip to all downstream nodes."""
        self._failed_nodes.add(node_id)
        # Delegate persistent skip-marking to the execution service.
        self._exec_service.mark_downstream_skipped(node_id, self.edges, db)
        # Local mirror keeps the level-walker's guard consistent.
        for downstream_id in find_downstream(node_id, self.edges):
            if downstream_id not in self._failed_nodes:
                self._skipped_nodes.add(downstream_id)
        logger.warning("Node %s failed: %s", node_id, error)

    # ------------------------------------------------------------------
    # Session cleanup
    # ------------------------------------------------------------------

    async def _cleanup_sessions(self) -> None:
        if not self._chain_sessions or self._dispatcher is None:
            return
        session_ids = list(set(self._chain_sessions.values()))
        try:
            results = await self._dispatcher.backend.cleanup_sessions(session_ids)
            failed = [k for k, v in results.items() if v != "cleaned"]
            if failed:
                logger.warning("Some sessions failed to clean up: %s", failed)
        except Exception as e:
            logger.warning("Session cleanup failed: %s", e)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def collect_results(self) -> dict[str, Any]:
        return {
            "execution_id": self.execution_id,
            "status": "failed" if self._failed_nodes else "completed",
            "results": dict(self._results),
            "failed_nodes": list(self._failed_nodes),
            "skipped_nodes": list(self._skipped_nodes),
        }

    def _find_node(self, node_id: str) -> dict | None:
        for node in self.nodes:
            if node.get("id") == node_id:
                return node
        return None

    def _reset_execution_state(self) -> None:
        self._results = {}
        self._failed_nodes = set()
        self._skipped_nodes = set()
        self._chain_sessions = {}
        self._node_levels = {}
        self.nodes = []
        self.edges = []

    @staticmethod
    async def _noop_callback(_status: str, _msg: str, _agent: str) -> None:
        pass
