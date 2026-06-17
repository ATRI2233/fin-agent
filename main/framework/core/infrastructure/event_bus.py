"""Asyncio pub/sub event bus for per-conversation SSE streams."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Default max queue size per subscriber before oldest events are dropped.
DEFAULT_QUEUE_MAXSIZE = 100


class EventBus:
    """
    In-process asyncio pub/sub.

    Subscribers register an asyncio.Queue for a conversation_id.
    Publishers broadcast JSON-serialisable event dicts to all queues.

    Thread-safety: asyncio.Queue is already safe for use across
    concurrent tasks. The _subscribers dict is protected by asyncio.Lock.
    """

    def __init__(self, max_queue_size: int = DEFAULT_QUEUE_MAXSIZE) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = {}
        self._lock = asyncio.Lock()
        self._max_size = max_queue_size

    # ── Subscription ────────────────────────────────────────────────────────

    async def subscribe(self, conversation_id: str) -> asyncio.Queue[dict[str, Any]]:
        """Register a new queue for *conversation_id*. Returns the queue."""
        async with self._lock:
            if conversation_id not in self._subscribers:
                self._subscribers[conversation_id] = set()
            queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=self._max_size)
            self._subscribers[conversation_id].add(queue)
            logger.debug("Subscribed queue for conversation %s (total: %d)", conversation_id, len(self._subscribers[conversation_id]))
            return queue

    async def unsubscribe(self, conversation_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        """Remove a queue from the subscriber set. Idempotent."""
        async with self._lock:
            if conversation_id in self._subscribers:
                self._subscribers[conversation_id].discard(queue)
                if not self._subscribers[conversation_id]:
                    del self._subscribers[conversation_id]
                logger.debug("Unsubscribed queue for conversation %s", conversation_id)

    # ── Publishing ──────────────────────────────────────────────────────────

    async def publish(self, conversation_id: str, event: dict[str, Any]) -> None:
        """
        Broadcast *event* to all queues subscribed to *conversation_id*.
        Silently drops if no subscribers exist.
        Uses put_nowait to avoid blocking the caller.
        """
        async with self._lock:
            queues = self._subscribers.get(conversation_id, set()).copy()

        for q in queues:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # Slow consumer — drop oldest event to make room
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except Exception:
                    pass

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def shutdown(self) -> None:
        """Close all queues and clear subscribers. Idempotent."""
        async with self._lock:
            for queues in self._subscribers.values():
                for q in queues:
                    try:
                        await q.aclose()
                    except Exception:
                        pass
            self._subscribers.clear()
        logger.info("EventBus shut down")
