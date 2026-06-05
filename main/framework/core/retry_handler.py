"""Retry handling with exponential backoff and circuit breaker for workflow execution."""

import asyncio
import functools
import logging
from typing import Any, Callable, TypeVar

from main.framework.config import settings
from main.framework.models.database import SessionLocal
from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable[..., Any])


def retry_on_failure(
    max_attempts: int = 3, delay: float = 1.0, backoff: float = 2.0
) -> Callable[[F], F]:
    """Decorator to retry an async function on exception with exponential backoff.

    Args:
        max_attempts: Maximum number of retry attempts (including initial call).
        delay: Initial delay between retries in seconds.
        backoff: Multiplier for delay after each retry (exponential backoff).

    Returns:
        Decorated function that retries on failure.
    """

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
                        logger.error(
                            f"All {max_attempts} attempts failed for {func.__name__}: {e}"
                        )

            raise (
                last_exception
                if last_exception
                else Exception(f"{func.__name__} failed after {max_attempts} attempts")
            )

        return wrapper  # type: ignore

    return decorator


class WorkflowRetryHandler:
    """Handles retry logic for workflow nodes with circuit breaker support."""

    # Circuit breaker threshold - skip node after this many total retries across workflow
    CIRCUIT_BREAKER_THRESHOLD = 5

    def __init__(self, workflow_id: str, execution_id: str | None = None):
        self.workflow_id = workflow_id
        self.execution_id = execution_id
        # Track retry counts per node across all retry operations (key: "node_id:execution_id")
        self._retry_counts: dict[str, int] = {}
        # Track total retries per node within current workflow execution
        self._circuit_state: dict[str, int] = {}

    def _get_node_retry_config(self, node_id: str, nodes: list[dict]) -> dict[str, Any]:
        """Extract retry config from node configuration.

        Args:
            node_id: ID of the node to find config for.
            nodes: List of node configs from workflow.

        Returns:
            Retry configuration dict with defaults applied.
        """
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
        """Check if node is marked as no_retry.

        Args:
            node_id: ID of the node to check.
            nodes: List of node configs from workflow.

        Returns:
            True if node should skip retry.
        """
        for node in nodes:
            if node.get("id") == node_id:
                return node.get("no_retry", False)
        return False

    def _increment_circuit_count(self, node_id: str) -> bool:
        """Increment circuit counter for node. Returns True if circuit should open.

        Args:
            node_id: ID of the node.

        Returns:
            True if circuit breaker threshold exceeded (skip retry).
        """
        current = self._circuit_state.get(node_id, 0) + 1
        self._circuit_state[node_id] = current

        if current >= self.CIRCUIT_BREAKER_THRESHOLD:
            logger.warning(
                f"Circuit breaker opened for node {node_id}: "
                f"{current} total retries exceeded threshold {self.CIRCUIT_BREAKER_THRESHOLD}"
            )
            return True
        return False

    def _store_retry_count(self, node_id: str, execution_id: str, count: int) -> None:
        """Persist retry count to database.

        Args:
            node_id: ID of the node.
            execution_id: ID of the workflow execution.
            count: Current retry count.
        """
        db = SessionLocal()
        try:
            exec_node = (
                db.query(ExecutionNode)
                .filter(
                    ExecutionNode.execution_id == execution_id,
                    ExecutionNode.node_id == node_id,
                )
                .first()
            )
            if exec_node:
                exec_node.retry_count = count
                db.commit()
        finally:
            db.close()

    async def retry_node(self, node_id: str, execution_id: str) -> dict[str, Any]:
        """Retry a failed node individually.

        Args:
            node_id: ID of the node to retry.
            execution_id: ID of the execution containing the node.

        Returns:
            Dict with retry result status and details.
        """
        db = SessionLocal()
        try:
            # Load workflow to get node config
            from main.framework.models.workflow import Workflow

            workflow = (
                db.query(Workflow).filter(Workflow.id == self.workflow_id).first()
            )
            if not workflow:
                return {
                    "success": False,
                    "error": f"Workflow {self.workflow_id} not found",
                }

            nodes = list(workflow.nodes) if workflow.nodes is not None else []

            # Check no_retry flag
            if self._is_no_retry_node(node_id, nodes):
                return {
                    "success": False,
                    "error": f"Node {node_id} is marked no_retry, skipping retry",
                }

            # Check circuit breaker
            if self._increment_circuit_count(node_id):
                return {
                    "success": False,
                    "error": f"Circuit breaker opened for node {node_id}",
                }

            # Get retry config
            config = self._get_node_retry_config(node_id, nodes)
            max_attempts = config["max_attempts"]
            delay = config["delay"]
            backoff = config["backoff"]

            # Update local tracking
            retry_key = f"{node_id}:{execution_id}"
            self._retry_counts[retry_key] = self._retry_counts.get(retry_key, 0) + 1
            retry_count = self._retry_counts[retry_key]

            # Get the execution node
            exec_node = (
                db.query(ExecutionNode)
                .filter(
                    ExecutionNode.execution_id == execution_id,
                    ExecutionNode.node_id == node_id,
                )
                .first()
            )

            if not exec_node:
                return {
                    "success": False,
                    "error": f"Execution node {node_id} not found",
                }

            # Reset status to pending for retry
            exec_node.status = "pending"
            exec_node.error = None
            db.commit()

            logger.info(
                f"Retrying node {node_id} (attempt {retry_count}/{max_attempts}, "
                f"delay={delay}s, backoff={backoff})"
            )

            # Execute with retry decorator
            @retry_on_failure(max_attempts=max_attempts, delay=delay, backoff=backoff)
            async def execute_with_retry():
                from main.framework.core.hapi_bridge import HAPIBridge
                from datetime import datetime

                hapi = HAPIBridge(hub_url=settings.HAPI_HUB_URL)
                session_id = await hapi.create_session_for_node(
                    node_id, exec_node.agent, exec_node.input or {}
                )
                result = await hapi.wait_for_completion(session_id)

                # Update execution node
                db2 = SessionLocal()
                try:
                    en = (
                        db2.query(ExecutionNode)
                        .filter(
                            ExecutionNode.execution_id == execution_id,
                            ExecutionNode.node_id == node_id,
                        )
                        .first()
                    )
                    if en:
                        en.status = "completed"
                        en.output = {"result": result}
                        en.completed_at = datetime.utcnow()
                        en.hapi_session_id = session_id
                        db2.commit()
                finally:
                    db2.close()

                return result

            try:
                result = await execute_with_retry()
                self._store_retry_count(node_id, execution_id, retry_count)
                return {"success": True, "result": result, "retry_count": retry_count}
            except Exception as e:
                exec_node.status = "failed"
                exec_node.error = str(e)
                db.commit()
                return {"success": False, "error": str(e), "retry_count": retry_count}

        finally:
            db.close()

    async def retry_workflow(
        self, workflow_id: str, from_node_id: str | None = None
    ) -> dict[str, Any]:
        """Retry workflow from a specific node or from beginning.

        Args:
            workflow_id: ID of the workflow to retry.
            from_node_id: Optional node ID to retry from (retries all nodes from this point).

        Returns:
            Dict with retry results for all affected nodes.
        """
        db = SessionLocal()
        try:
            # Find the execution to retry
            execution = (
                db.query(WorkflowExecution)
                .filter(WorkflowExecution.workflow_id == workflow_id)
                .order_by(WorkflowExecution.created_at.desc())
                .first()
            )

            if not execution:
                return {
                    "success": False,
                    "error": f"No execution found for workflow {workflow_id}",
                }

            self.execution_id = execution.id

            # Reset execution status
            execution.status = "running"
            db.commit()

            # Reset all failed nodes to pending for this execution
            failed_nodes = (
                db.query(ExecutionNode)
                .filter(
                    ExecutionNode.execution_id == execution.id,
                    ExecutionNode.status == "failed",
                )
                .all()
            )

            results = {}
            from main.framework.models.workflow import Workflow

            workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
            nodes = (
                list(workflow.nodes) if workflow and workflow.nodes is not None else []
            )

            # Determine which nodes to retry
            if from_node_id:
                # Find all nodes that come after from_node_id in topological order
                node_order = self._get_topological_order(nodes)
                start_idx = (
                    node_order.index(from_node_id) if from_node_id in node_order else 0
                )
                nodes_to_retry = node_order[start_idx:]
            else:
                nodes_to_retry = [n.node_id for n in failed_nodes]

            # Reset circuit state for this retry session
            self._circuit_state.clear()

            # Retry each failed node
            exec_id_str = str(execution.id)
            for node_id in nodes_to_retry:
                result = await self.retry_node(node_id, exec_id_str)
                results[node_id] = result

            # Update execution status
            all_success = all(r.get("success", False) for r in results.values())
            execution.status = "completed" if all_success else "failed"
            db.commit()

            return {
                "success": all_success,
                "execution_id": execution.id,
                "node_results": results,
            }

        finally:
            db.close()

    def _get_topological_order(self, nodes: list[dict]) -> list[str]:
        """Compute topological order of nodes.

        Args:
            nodes: List of node configs.

        Returns:
            List of node IDs in topological order.
        """
        from main.framework.core.workflow_parser import topological_sort

        edges = []
        # Assuming edges are stored in workflow or we need to get them
        # For now, extract edges from nodes if present
        for node in nodes:
            if "edges" in node:
                edges.extend(node["edges"])
            if "targets" in node:
                for target in node["targets"]:
                    edges.append({"source": node["id"], "target": target})

        order = topological_sort(nodes, edges)
        return order if order else [n["id"] for n in nodes]

    def get_retry_count(self, node_id: str, execution_id: str) -> int:
        """Get current retry count for a node.

        Args:
            node_id: ID of the node.
            execution_id: ID of the execution.

        Returns:
            Number of retries attempted for this node in this execution.
        """
        # Check database
        db = SessionLocal()
        try:
            exec_node = (
                db.query(ExecutionNode)
                .filter(
                    ExecutionNode.execution_id == execution_id,
                    ExecutionNode.node_id == node_id,
                )
                .first()
            )
            if exec_node and hasattr(exec_node, "retry_count"):
                return exec_node.retry_count or 0
        finally:
            db.close()

        # Fall back to local tracking
        retry_key = f"{node_id}:{execution_id}"
        return self._retry_counts.get(retry_key, 0)

    def reset_circuit(self, node_id: str | None = None) -> None:
        """Reset circuit breaker for a node or all nodes.

        Args:
            node_id: Optional node ID to reset. If None, resets all.
        """
        if node_id:
            self._circuit_state.pop(node_id, None)
            logger.info(f"Circuit breaker reset for node {node_id}")
        else:
            self._circuit_state.clear()
            logger.info("Circuit breaker reset for all nodes")
