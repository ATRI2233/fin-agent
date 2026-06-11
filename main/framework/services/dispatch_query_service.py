"""DispatchQueryService — business logic for direct agent dispatch.

Wraps :class:`main.framework.core.agent_dispatcher.AgentDispatcher` with
timing, error normalisation, and result shaping for the synchronous
``/api/v1/dispatch`` HTTP API.

This is the service-layer half of the Wave 2 pilot refactor that
migrates the dispatch endpoint out of ``api/dispatch.py`` into the
``controllers/`` pattern. The controller at
``controllers/dispatch.py`` is a thin shell that delegates here; the
``api/dispatch.py`` re-export shim keeps ``main.py`` working unchanged.

Why a dedicated service?
------------------------
The endpoint is small (two routes) but it owns a handful of concerns
that don't belong in the FastAPI handler:

* **Wall-clock timing** — every response carries ``duration_seconds``;
  the handler just forwards the dict.
* **Timeout/exception normalisation** — :class:`TimeoutError` and
  generic :class:`Exception` from the dispatcher are mapped to
  ``error`` fields on the result so the handler always returns 200.
  The legacy behaviour (one synchronous call per agent, no
  background job) is preserved 1:1.
* **Shape contract** — the controller declares ``response_model``;
  the service returns dicts that match those models exactly. This
  keeps the handler free of dict-spelunking.

Concurrency model
-----------------
Both methods are ``async`` because the underlying ``AgentDispatcher``
is async. The service does NOT spawn background tasks; the controller
calls the service inline and returns the result. Async workflow /
debate execution is *not* a dispatch concern (those live in
``WorkflowService`` / ``DebateExecutor``).
"""

from __future__ import annotations

import logging
import time
from typing import Any

from main.framework.core.agent_dispatcher import AgentDispatcher

logger = logging.getLogger(__name__)


class DispatchQueryService:
    """Business-logic facade for the direct dispatch HTTP API.

    Public surface (2 methods, both async):

    * :meth:`dispatch`        — single agent, single prompt
    * :meth:`dispatch_parallel` — multiple agents, one prompt, gathered

    The constructor takes a single dependency: an :class:`AgentDispatcher`
    instance resolved from the DI container. No database / repository
    access — dispatch is a stateless thin wrapper over the backend.
    """

    def __init__(self, dispatcher: AgentDispatcher) -> None:
        self._dispatcher = dispatcher

    # ------------------------------------------------------------------
    # Single-agent dispatch
    # ------------------------------------------------------------------

    async def dispatch(
        self,
        agent: str,
        prompt: str,
        timeout: int,
    ) -> dict[str, Any]:
        """Dispatch a prompt to a single agent and wait for the result.

        Returns a dict matching :class:`controllers.dispatch.DispatchResult`:

            {
                "agent":            str,
                "result":           Any | None,
                "error":            str | None,
                "duration_seconds": float,
                "session_id":       str | None,
            }

        ``TimeoutError`` and any other exception raised by the dispatcher
        are caught and returned via the ``error`` field. This matches the
        legacy behaviour where the endpoint never returned 5xx for a
        single-agent call (the caller is expected to inspect ``error``).
        """
        start = time.time()
        try:
            resp = await self._dispatcher.dispatch(
                agent,
                prompt,
                timeout=timeout,
                reuse_session=False,
            )
            return {
                "agent": agent,
                "result": resp["result"],
                "error": None,
                "duration_seconds": round(time.time() - start, 2),
                "session_id": resp.get("session_id"),
            }
        except TimeoutError:
            return {
                "agent": agent,
                "result": None,
                "error": f"Agent timed out after {timeout}s",
                "duration_seconds": round(time.time() - start, 2),
                "session_id": None,
            }
        except Exception as e:
            logger.error("Dispatch to %s failed: %s", agent, e)
            return {
                "agent": agent,
                "result": None,
                "error": str(e),
                "duration_seconds": round(time.time() - start, 2),
                "session_id": None,
            }

    # ------------------------------------------------------------------
    # Multi-agent parallel dispatch
    # ------------------------------------------------------------------

    async def dispatch_parallel(
        self,
        agents: list[str],
        prompt: str,
        timeout: int,
    ) -> dict[str, Any]:
        """Dispatch the same prompt to multiple agents in parallel.

        Returns a dict matching
        :class:`controllers.dispatch.ParallelDispatchResponse`:

            {
                "results":          list[dict],  # one per agent
                "duration_seconds": float,
            }

        Per-agent failures are absorbed by ``AgentDispatcher.dispatch_parallel``
        and surface as ``error`` entries on each result; the service does
        NOT catch them again. Catastrophic failures (e.g. the gather itself
        blowing up) propagate to the controller, which translates them to
        ``HTTPException(500)`` — same contract as the legacy handler.
        """
        start = time.time()
        raw_results = await self._dispatcher.dispatch_parallel(
            agents,
            prompt,
            timeout=timeout,
        )
        duration = round(time.time() - start, 2)
        results = [
            {
                "agent": r["agent"],
                "result": r["result"],
                "error": r["error"],
                "duration_seconds": duration,
            }
            for r in raw_results
        ]
        return {
            "results": results,
            "duration_seconds": duration,
        }


__all__ = ["DispatchQueryService"]
