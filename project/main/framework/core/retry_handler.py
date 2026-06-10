"""Retry handling with exponential backoff and circuit breaker for workflow execution."""

from __future__ import annotations

import asyncio
import functools
import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any, TypeVar

from main.framework.repositories.execution_repo import ExecutionRepository
from main.framework.repositories.workflow_repo import WorkflowRepository

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable[..., Any])


def retry_on_failure(max_attempts: int = 3, delay: float = 1.0, backoff: float = 2.0) -> Callable[[F], F]:
    """Decorator to retry an async function on exception with exponential backoff."""

    def decorator(func: F) -> F:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            last_exception = None
            current_delay = delay

            for attempt in range(1, max_attempts + 1):
                try:
                    return await func(*args, **kwargs)
                except Exception as e:
                    last_exception = e
                    if attempt < max_attempts:
                        logger.warning(
                            f"Attempt {attempt}/{max_attempts} failed for {func.__name__}: {e}. "
                            f"Retrying in {current_delay:.1f}s..."
                        )
                        await asyncio.sleep(current_delay)
                        current_delay *= backoff
                    else:
                        logger.error(f"All {max_attempts} attempts failed for {func.__name__}: {e}")

            raise (
                last_exception if last_exception else Exception(f"{func.__name__} failed after {max_attempts} attempts")
            )

        return wrapper  # type: ignore

    return decorator


class WorkflowRetryHandler:
    """Handles retry logic for workflow nodes with circuit breaker support."""

    CIRCUIT_BREAKER_THRESHOLD = 5

    def __init__(
        self,
        workflow_id: str,
        execution_id: str | None = None,
        dispatcher: Any = None,  # AgentDispatcher (avoid circular import)
        exec_repo: ExecutionRepository | None = None,
        workflow_repo: WorkflowRepository | None = None,
    ):
        self.workflow_id = workflow_id
        self.execution_id = execution_id
        self._dispatcher = dispatcher
        self._exec_repo = exec_repo or ExecutionRepository()
        self._workflow_repo = workflow_repo or WorkflowRepository()
        self._retry_counts: dict[str, int] = {}
        self._circuit_state: dict[str, int] = {}

    def _get_node_retry_config(self, node_id: str, nodes: list[dict]) -> dict[str, Any]:
        for node in nodes:
            if node.get("id") == node_id:
                retry_config = node.get("retry", {})
                return {
                    "max_attempts": retry_config.get("max_attempts", 3),
                    "delay": retry_config.get("delay", 1.0),
                    "backoff": retry_config.get("backoff", 2.0),
                }
        return {"max_attempts": 3, "delay": 1.0, "backoff": 2.0}

    def _is_no_retry_node(self, node_id: str, nodes: list[dict]) -> bool:
        for node in nodes:
            if node.get("id") == node_id:
                return node.get("no_retry", False)
        return False

    def _increment_circuit_count(self, node_id: str) -> bool:
        current = self._circuit_state.get(node_id, 0) + 1
        self._circuit_state[node_id] = current
        if current >= self.CIRCUIT_BREAKER_THRESHOLD:
            logger.warning(
                f"Circuit breaker opened for node {node_id}: "
                f"{current} total retries exceeded threshold {self.CIRCUIT_BREAKER_THRESHOLD}"
            )
            return True
        return False

    async def retry_node(self, node_id: str, execution_id: str) -> dict[str, Any]:
        """Retry a failed node.

        Uses injected repositories for all DB operations.
        """
        workflow = self._workflow_repo.get(self.workflow_id)
        if not workflow:
            return {"success": False, "error": f"Workflow {self.workflow_id} not found"}

        nodes = list(workflow.nodes) if workflow.nodes is not None else []

        if self._is_no_retry_node(node_id, nodes):
            return {"success": False, "error": f"Node {node_id} is marked no_retry"}

        if self._increment_circuit_count(node_id):
            return {"success": False, "error": f"Circuit breaker opened for node {node_id}"}

        config = self._get_node_retry_config(node_id, nodes)
        max_attempts = config["max_attempts"]
        delay = config["delay"]
        backoff = config["backoff"]

        retry_key = f"{node_id}:{execution_id}"
        self._retry_counts[retry_key] = self._retry_counts.get(retry_key, 0) + 1
        retry_count = self._retry_counts[retry_key]

        exec_node = self._exec_repo.get_node(node_id, execution_id)
        if not exec_node:
            return {"success": False, "error": f"Execution node {node_id} not found"}

        # Snapshot input/agent before the session closes (detached object)
        node_input = exec_node.input
        node_agent = exec_node.agent

        # Reset for retry
        self._exec_repo.update_node(node_id, execution_id, status="pending", error=None)

        logger.info(
            f"Retrying node {node_id} (attempt {retry_count}/{max_attempts}, delay={delay}s, backoff={backoff})"
        )

        # Execute with retry — only does the agent dispatch, NO db writes
        @retry_on_failure(max_attempts=max_attempts, delay=delay, backoff=backoff)
        async def execute_with_retry():
            if self._dispatcher is None:
                raise RuntimeError("No dispatcher configured — retry_handler requires an injected AgentDispatcher")

            prompt = node_input if isinstance(node_input, str) else str(node_input or "")
            resp = await self._dispatcher.dispatch(node_agent, prompt, timeout=300)
            return resp["result"], resp.get("session_id", "")

        try:
            result, session_id = await execute_with_retry()

            self._exec_repo.update_node(
                node_id,
                execution_id,
                status="completed",
                output={"result": result},
                completed_at=datetime.utcnow(),
                session_id=session_id,
                retry_count=retry_count,
            )

            return {"success": True, "result": result, "retry_count": retry_count}

        except Exception as e:
            self._exec_repo.update_node(
                node_id,
                execution_id,
                status="failed",
                error=str(e),
                retry_count=retry_count,
            )
            return {"success": False, "error": str(e), "retry_count": retry_count}

    async def retry_workflow(self, workflow_id: str, from_node_id: str | None = None) -> dict[str, Any]:
        """Retry all failed nodes in a workflow."""
        items, _ = self._exec_repo.list_executions(workflow_id=workflow_id, limit=1)
        if not items:
            return {"success": False, "error": f"No execution found for workflow {workflow_id}"}

        execution_id = str(items[0]["id"])
        self.execution_id = execution_id
        self._exec_repo.update_execution(execution_id, status="running")

        failed_nodes = self._exec_repo.get_failed_nodes(execution_id)

        results = {}
        workflow = self._workflow_repo.get(workflow_id)
        nodes = list(workflow.nodes) if workflow and workflow.nodes is not None else []

        if from_node_id:
            node_order = self._get_topological_order(nodes)
            start_idx = node_order.index(from_node_id) if from_node_id in node_order else 0
            nodes_to_retry = node_order[start_idx:]
        else:
            nodes_to_retry = [n.node_id for n in failed_nodes]

        self._circuit_state.clear()

        for nid in nodes_to_retry:
            result = await self.retry_node(nid, execution_id)
            results[nid] = result

        all_success = all(r.get("success", False) for r in results.values())
        self._exec_repo.update_execution(execution_id, status="completed" if all_success else "failed")

        return {
            "success": all_success,
            "execution_id": execution_id,
            "node_results": results,
        }

    def _get_topological_order(self, nodes: list[dict]) -> list[str]:
        from main.framework.core.workflow_parser import topological_sort

        edges = []
        for node in nodes:
            if "edges" in node:
                edges.extend(node["edges"])
            if "targets" in node:
                for target in node["targets"]:
                    edges.append({"source": node["id"], "target": target})

        order = topological_sort(nodes, edges)
        return order if order else [n["id"] for n in nodes]

    def get_retry_count(self, node_id: str, execution_id: str) -> int:
        retry_key = f"{node_id}:{execution_id}"
        return self._retry_counts.get(retry_key, 0)

    def reset_circuit(self, node_id: str | None = None) -> None:
        if node_id:
            self._circuit_state.pop(node_id, None)
        else:
            self._circuit_state.clear()
