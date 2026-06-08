"""Performance optimizations: concurrency limiting, node timeouts, and workflow caching."""

import asyncio
import logging
from typing import Any

from main.framework.config import settings

logger = logging.getLogger(__name__)


class ConcurrencyLimiter:
    """Limits concurrent HAPI sessions using asyncio.Semaphore."""

    def __init__(self, max_concurrent: int = 10):
        self._max_concurrent = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._active_count = 0

    @property
    def active_count(self) -> int:
        """Number of currently active sessions."""
        return self._active_count

    @property
    def max_concurrent(self) -> int:
        """Maximum concurrent sessions allowed."""
        return self._max_concurrent

    @property
    def available_slots(self) -> int:
        """Approximate number of available semaphore slots."""
        return max(0, self._max_concurrent - self._active_count)

    async def acquire(self) -> None:
        """Acquire a semaphore slot (async context manager entry)."""
        await self._semaphore.acquire()
        self._active_count += 1

    def release(self) -> None:
        """Release a slot back to the semaphore."""
        self._semaphore.release()
        self._active_count -= 1

    async def __aenter__(self) -> None:
        await self.acquire()

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        self.release()


class NodeTimeout:
    """Execute nodes with configurable timeout."""

    def __init__(self, default_timeout: int = 300):
        self.default_timeout = default_timeout

    async def execute_with_timeout(
        self, node_id: str, timeout_seconds: int | None = None, coro: Any = None
    ) -> Any:
        """Run node coroutine with timeout.

        Args:
            node_id: ID of the node being executed
            timeout_seconds: Timeout in seconds (uses default if None)
            coro: Coroutine to execute

        Returns:
            Result of the coroutine

        Raises:
            asyncio.TimeoutError: If node exceeds timeout
        """
        if coro is None:
            raise ValueError("coro must be a coroutine")

        timeout = (
            timeout_seconds if timeout_seconds is not None else self.default_timeout
        )

        try:
            result = await asyncio.wait_for(coro, timeout=timeout)
            logger.debug(f"Node {node_id} completed within {timeout}s")
            return result
        except asyncio.TimeoutError:
            logger.warning(f"Node {node_id} timed out after {timeout}s")
            # Update execution node status to timeout if db accessible
            await self._mark_node_timeout(node_id)
            raise asyncio.TimeoutError(f"Node {node_id} exceeded timeout of {timeout}s")

    async def _mark_node_timeout(self, node_id: str) -> None:
        """Mark node as timeout status in database."""
        try:
            from main.framework.models.database import SessionLocal
            from main.framework.models.workflow_execution import ExecutionNode

            db = SessionLocal()
            try:
                exec_node = (
                    db.query(ExecutionNode)
                    .filter(
                        ExecutionNode.node_id == node_id,
                        ExecutionNode.status == "running",
                    )
                    .first()
                )
                if exec_node:
                    exec_node.status = "timeout"
                    exec_node.error = f"Execution timed out"
                    db.commit()
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Failed to mark node {node_id} as timeout: {e}")


# Global concurrency limiter instance
_concurrency_limiter: ConcurrencyLimiter | None = None


def get_concurrency_limiter() -> ConcurrencyLimiter:
    """Get or create the global ConcurrencyLimiter instance."""
    global _concurrency_limiter
    if _concurrency_limiter is None:
        _concurrency_limiter = ConcurrencyLimiter(
            max_concurrent=settings.MAX_CONCURRENT_HAPI_SESSIONS
        )
    return _concurrency_limiter


# Global node timeout instance
_node_timeout: NodeTimeout | None = None


def get_node_timeout() -> NodeTimeout:
    """Get or create the global NodeTimeout instance."""
    global _node_timeout
    if _node_timeout is None:
        _node_timeout = NodeTimeout(default_timeout=settings.NODE_TIMEOUT_SECONDS)
    return _node_timeout


# Workflow definition cache
_workflow_cache: dict[str, Any] = {}
_cache_max_size = 100


def get_workflow_cache_size() -> int:
    """Return the current number of cached workflow definitions."""
    return len(_workflow_cache)


async def get_cached_workflow(workflow_id: str) -> dict | None:
    """Get workflow definition from memory cache.

    Args:
        workflow_id: ID of workflow to retrieve

    Returns:
        Cached workflow definition dict or None
    """
    if workflow_id in _workflow_cache:
        logger.debug(f"Workflow {workflow_id} cache hit")
        return _workflow_cache[workflow_id]

    logger.debug(f"Workflow {workflow_id} cache miss")
    return None


async def cache_workflow(workflow_id: str, definition: dict) -> None:
    """Cache workflow definition in memory (LRU with max 100 entries).

    Args:
        workflow_id: ID of workflow
        definition: Workflow definition dict to cache
    """
    if len(_workflow_cache) >= _cache_max_size:
        # Remove oldest entry (first key)
        oldest_key = next(iter(_workflow_cache))
        del _workflow_cache[oldest_key]
        logger.debug(f"Workflow cache full, evicted {oldest_key}")

    _workflow_cache[workflow_id] = definition
    logger.debug(f"Cached workflow {workflow_id}")


def clear_workflow_cache() -> None:
    """Clear all cached workflow definitions."""
    _workflow_cache.clear()
    logger.debug("Workflow cache cleared")


def get_workflow_definition_from_db(workflow_id: str) -> dict | None:
    """Load workflow definition from database.

    Args:
        workflow_id: ID of workflow to load

    Returns:
        Workflow definition dict or None
    """
    try:
        from main.framework.models.database import SessionLocal
        from main.framework.models.workflow import Workflow

        db = SessionLocal()
        try:
            workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
            if workflow:
                return {
                    "id": workflow.id,
                    "name": workflow.name,
                    "nodes": workflow.nodes or [],
                    "edges": workflow.edges or [],
                }
            return None
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Failed to load workflow {workflow_id} from DB: {e}")
        return None


async def get_workflow_with_cache(workflow_id: str) -> dict | None:
    """Get workflow definition, using cache if available.

    Args:
        workflow_id: ID of workflow to retrieve

    Returns:
        Workflow definition dict or None
    """
    # Try cache first
    cached = await get_cached_workflow(workflow_id)
    if cached is not None:
        return cached

    # Load from DB
    definition = get_workflow_definition_from_db(workflow_id)
    if definition is not None:
        await cache_workflow(workflow_id, definition)

    return definition
