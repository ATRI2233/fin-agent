"""Simple in-process event bus for lifecycle signals.

Supports subscribe / publish pattern: handlers are dispatched via
``asyncio.create_task`` so publisher never blocks. Handler exceptions are
logged via ``logger.warning`` and **not** propagated — a failing handler
never crashes the publisher.
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable

from src.main.infra.logging import get_logger

logger = get_logger(__name__)


class EventBus:
    """Lightweight in-process pub/sub bus.

    Usage::

        bus = EventBus()
        bus.subscribe("app.started", my_handler)
        bus.publish("app.started", {"pid": 123})
    """

    def __init__(self) -> None:
        self._handlers: dict[str, list[Callable[[Any], Any]]] = {}

    # ── public API ──

    def subscribe(self, event_type: str, handler: Callable[[Any], Any]) -> None:
        """Register *handler* to be called when *event_type* is published.

        Multiple handlers per type are supported; they are called in
        registration order.
        """
        self._handlers.setdefault(event_type, []).append(handler)

    def publish(self, event_type: str, payload: dict[str, Any] | Any = None) -> None:
        """Dispatch *payload* to all handlers registered for *event_type*.

        Each handler is scheduled via ``asyncio.create_task`` so it runs
        concurrently and the publisher returns immediately. Exceptions raised
        by a handler are caught and logged at ``WARNING`` level — they never
        propagate to the caller.
        """
        for handler in self._handlers.get(event_type, []):
            asyncio.create_task(self._safe_dispatch(handler, payload))

    # ── internal ──

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
