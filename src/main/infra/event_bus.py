"""Simple in-process event bus for lifecycle signals.

Supports subscribe / publish pattern: handlers are dispatched via
``asyncio.create_task`` so publisher never blocks. Handler exceptions are
logged via ``logger.warning`` and **not** propagated — a failing handler
never crashes the publisher.

Background dispatch tasks are tracked and can be cleanly drained via
:py:meth:`EventBus.shutdown` to avoid ``Task was destroyed but it is pending``
warnings on event loop teardown.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any, Callable

from src.main.infra.logging import get_logger

logger = get_logger(__name__)


class EventBus:
    """Lightweight in-process pub/sub bus.

    Usage::

        bus = EventBus()
        bus.subscribe("app.started", my_handler)
        bus.publish("app.started", {"pid": 123})
        await bus.shutdown()  # drain pending handlers on app stop
    """

    def __init__(self) -> None:
        self._handlers: dict[str, list[Callable[[Any], Any]]] = {}
        self._lock = threading.Lock()
        # Tracks in-flight ``_safe_dispatch`` tasks so they can be awaited
        # on shutdown (otherwise they leak memory and emit pending-task
        # warnings on loop close).
        self._tasks: set[asyncio.Task] = set()

    # ── public API ──

    def subscribe(self, event_type: str, handler: Callable[[Any], Any]) -> None:
        """Register *handler* to be called when *event_type* is published.

        Multiple handlers per type are supported; they are called in
        registration order.
        """
        with self._lock:
            self._handlers.setdefault(event_type, []).append(handler)

    def publish(self, event_type: str, payload: dict[str, Any] | Any = None) -> None:
        """Dispatch *payload* to all handlers registered for *event_type*.

        Each handler is scheduled via ``asyncio.create_task`` so it runs
        concurrently and the publisher returns immediately. Exceptions raised
        by a handler are caught and logged at ``WARNING`` level — they never
        propagate to the caller.
        """
        with self._lock:
            handlers = list(self._handlers.get(event_type, []))
        for handler in handlers:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None

            if loop is not None and loop.is_running():
                self._schedule(handler, payload)
            else:
                try:
                    result = handler(payload)
                    # Handlers are expected to be sync. If a handler returns a
                    # coroutine we have no running loop here, so we cannot
                    # ``asyncio.run`` it (nested loops are forbidden and a
                    # coroutine without a loop is silently discarded). Log a
                    # warning so authors notice instead of silently dropping
                    # work.
                    if asyncio.iscoroutine(result):
                        logger.warning(
                            "event_bus.sync_handler_returned_coroutine",
                            handler=getattr(handler, "__name__", repr(handler)),
                        )
                except Exception:
                    logger.warning(
                        "event_bus.handler_failed",
                        handler=handler.__name__,
                        exc_info=True,
                    )

    async def shutdown(self) -> None:
        """Cancel and await all in-flight dispatch tasks.

        Idempotent: calling more than once is safe. Intended to be invoked
        during FastAPI's ``shutdown`` lifespan event so background handlers
        do not generate ``Task was destroyed but it is pending`` warnings.
        """
        if not self._tasks:
            return
        tasks = list(self._tasks)
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()

    # ── internal ──

    def _schedule(
        self, handler: Callable[[Any], Any], payload: dict[str, Any] | Any
    ) -> None:
        """Create a tracked dispatch task and register cleanup callback."""
        task = asyncio.create_task(self._safe_dispatch(handler, payload))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    @staticmethod
    async def _safe_dispatch(
        handler: Callable[[Any], Any], payload: dict[str, Any] | Any
    ) -> None:
        try:
            result = handler(payload)
            if result is not None and hasattr(result, "__await__"):
                await result
        except Exception:
            logger.warning(
                "event_bus.handler_failed",
                handler=handler.__name__,
                exc_info=True,
            )