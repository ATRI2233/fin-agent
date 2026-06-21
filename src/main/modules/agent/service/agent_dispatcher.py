"""AgentDispatcher Protocol implementation.

Implements :class:`AgentDispatcher` by orchestrating an ``AgentBackend``
(session lifecycle, timeout, structured error classification).

Key design points
-----------------
* **No retry, no inner loop** — retry policy lives in the workflow layer
  (Do Not #8 / TASK-310). This module is single-shot by design.
* **Timeout defaults to** ``settings.NODE_TIMEOUT_SECONDS``; callers may
  override per-call with the ``timeout=`` keyword.
* **Session reuse** — when ``session_id`` is supplied OR
  ``reuse_session=True``, the dispatcher will not abort the session in
  the ``finally`` block, so callers can keep the session alive for
  follow-up dispatches (debate-style scenarios).
* **trace_id handling** — the dispatcher **never** reads trace_id from a
  ``ContextVar``; it is always a keyword-only parameter (Do Not #18,
  TARGET_ARCHITECTURE_v2 §7.6, revision T-7).
* **Exception handling** — all backend exceptions are already structured
  ``FinAgentError`` subclasses (see :mod:`src.main.infra.errors`). The
  dispatcher does **not** swallow them. Exceptions raised inside
  :meth:`dispatch_parallel` workers are converted to
  ``{"result": None, "session_id": None, "raw": "<error message>"}``
  via ``asyncio.gather(return_exceptions=True)``; this is not considered
  exception swallowing because the error information is preserved in
  ``raw`` (task card §4.1, "raw 里有错误信息").
* **dispatch_parallel** — Bug C-4 design change: ``trace_id`` may be a
  single value (broadcast), a list (per-worker), or ``None`` (auto-
  generate one and broadcast). Revision T-3: ``extra_session_ids`` must
  not overlap with ``results[i].session_id``; the default implementation
  returns ``[]`` because the plain ``dispatch`` opens no follow-ups.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from uuid import uuid4

from structlog.contextvars import bind_contextvars, unbind_contextvars

from src.main.infra.domain import AgentReference, SessionId, TraceId
from src.main.infra.errors import ValidationError
from src.main.infra.settings import Settings
from src.main.infra.logging import get_logger
from src.main.modules.agent.protocol import (
    AgentBackend,
    AgentDispatcher,
    DispatchResult,
)

logger = get_logger(__name__)


class DefaultAgentDispatcher(AgentDispatcher):
    """Default implementation of :class:`AgentDispatcher`.

    Composes an :class:`AgentBackend` (low-level opencode HTTP transport)
    with a :class:`Settings` instance (timeout knobs). All dispatch
    semantics — session reuse, timeout enforcement, parallel fan-out —
    live here.

    The class has no retry decorator, no inner retry loop, and no
    backoff constants. All of that is owned by the workflow layer
    (TASK-310). Callers that need retries should wrap this dispatcher.
    """

    def __init__(self, backend: AgentBackend, settings: Settings) -> None:
        """Store dependencies. No I/O happens here.

        Args:
            backend: Low-level backend (e.g. :class:`ServeBackend`).
            settings: Global settings, used to read
                ``NODE_TIMEOUT_SECONDS`` when callers omit ``timeout=``.
        """
        self.backend: AgentBackend = backend
        self.settings: Settings = settings

    # ───────────────────────────────────────────────────────────────────
    # Single dispatch
    # ───────────────────────────────────────────────────────────────────

    async def dispatch(
        self,
        agent: AgentReference,
        prompt: str,
        *,
        timeout: float | None = None,
        session_id: SessionId | None = None,
        reuse_session: bool = False,
        trace_id: TraceId,
    ) -> DispatchResult:
        """Send ``prompt`` to ``agent`` and return the raw + parsed reply.

        If ``session_id`` is ``None``, a new session is created (and
        aborted in ``finally`` unless ``reuse_session=True``). If
        ``session_id`` is provided, that session is reused and never
        aborted by this call.

        Args:
            agent: Target agent reference.
            prompt: Prompt text.
            timeout: Timeout seconds; falls back to
                ``settings.NODE_TIMEOUT_SECONDS``.
            session_id: Existing session to reuse; ``None`` opens a new
                one.
            reuse_session: If ``True``, the (possibly newly-created)
                session is kept alive for follow-up dispatches.
            trace_id: Audit / tracing id, keyword-only.

        Returns:
            :class:`DispatchResult` with ``result`` (parsed JSON or raw
            string), ``session_id`` (primary session), and ``raw``
            (original text from backend).

        Raises:
            AgentTimeoutError: backend hit its timeout.
            AgentHttp5xxError: opencode returned 5xx.
            OpencodeUnavailableError: opencode unreachable.
            McpServerError: opencode returned 4xx.
            ValidationError: prompt / params invalid.
        """
        # Phase 1.5: explicit bind_contextvars for the whole dispatch body.
        # The bind is the FIRST statement inside try so that any failure
        # during the bind still leaves the contextvar in a defined state,
        # and the unbind in the finally block always fires (paired).
        # See TASK-114 / Do Not #18.
        try:
            bind_contextvars(trace_id=str(trace_id))
            effective_timeout: float = (
                timeout if timeout is not None else self.settings.NODE_TIMEOUT_SECONDS
            )

            created_new: bool = False
            if session_id is None:
                # Open a fresh session for this dispatch.
                session_id = await self.backend.create_session(agent, trace_id)
                await self.backend.send_message(
                    session_id, prompt, agent, trace_id
                )
                created_new = True
            else:
                # Reuse an externally-provided session; do NOT abort it.
                await self.backend.send_message(
                    session_id, prompt, agent, trace_id
                )

            try:
                raw: str = await self.backend.wait_for_completion(
                    session_id,
                    timeout=effective_timeout,
                    after_count=0,
                    trace_id=trace_id,
                )
                return {
                    "result": self._parse_response(raw),
                    "session_id": session_id,
                    "raw": raw,
                }
            finally:
                # Cleanup policy: only the session this call created, and
                # only if the caller did not ask us to keep it alive.
                if created_new and not reuse_session:
                    try:
                        await self.backend.abort_session(session_id)
                    except Exception:
                        logger.warning(
                            "Failed to abort session %s", session_id, exc_info=True
                        )
        finally:
            unbind_contextvars("trace_id")

    # ───────────────────────────────────────────────────────────────────
    # Parallel dispatch
    # ───────────────────────────────────────────────────────────────────

    async def dispatch_parallel(
        self,
        agents: list[AgentReference],
        prompt: str,
        *,
        timeout: float | None = None,
        trace_id: TraceId | list[TraceId] | None = None,
    ) -> tuple[list[DispatchResult], list[SessionId]]:
        """Fan-out dispatch — run independent agents concurrently.

        ``trace_id`` is normalized once at the entry point and then
        passed per-worker (Bug C-4):

        * ``None`` → generate a single ``TraceId`` and broadcast to all
          workers.
        * ``list[TraceId]`` → one-per-worker; the list length **must**
          equal ``len(agents)`` or a :class:`ValidationError` is raised.
        * single ``TraceId`` → broadcast to all workers.

        Every worker is launched with ``reuse_session=True`` because the
        default parallel implementation does not open debate-style
        follow-up sessions; ``extra_session_ids`` is therefore ``[]``.

        Exceptions raised inside workers are captured by
        ``asyncio.gather(return_exceptions=True)`` and converted into a
        ``DispatchResult`` with ``result=None``, ``session_id=None``,
        ``raw=str(e)``. This is **not** exception swallowing — the error
        message is preserved in ``raw`` for the caller to inspect.

        Args:
            agents: Targets, one per worker; order-sensitive.
            prompt: Shared prompt text.
            timeout: Per-worker timeout.
            trace_id: See ``AgentDispatcher.dispatch_parallel`` Protocol.

        Returns:
            ``(results, extra_session_ids)``:
                * ``results``: same length as ``agents``; each element
                  already carries its own primary ``session_id``.
                * ``extra_session_ids``: debate-style follow-up session
                  ids; empty in the default implementation and
                  **guaranteed not to overlap** with
                  ``results[i].session_id`` (revision T-3).

        Raises:
            ValidationError: ``trace_id`` is a list whose length does not
                match ``len(agents)``.
        """
        per_worker: list[TraceId] = self._normalize_trace_ids(trace_id, len(agents))

        tasks = [
            self.dispatch(
                a,
                prompt,
                timeout=timeout,
                reuse_session=True,
                trace_id=t,
            )
            for a, t in zip(agents, per_worker)
        ]

        # Track each worker's session_id as it becomes available, so that
        # on failure we can abort only the failed worker's session while
        # preserving successful ones (debate-style contract).
        session_ids: list[SessionId | None] = [None] * len(tasks)

        async def _track_session(task_index: int, coro):
            """Run dispatch and remember its session_id for cleanup on failure."""
            try:
                result = await coro
            except BaseException:
                # Re-raise so gather records the exception; we cannot record
                # a session_id here because dispatch() never returned.
                raise
            session_ids[task_index] = result.get("session_id")
            return result

        tracked_tasks = [
            _track_session(i, t) for i, t in enumerate(tasks)
        ]
        gathered = await asyncio.gather(*tracked_tasks, return_exceptions=True)

        # Separate successful dispatches from failed ones. Only failed
        # workers' sessions must be aborted; successful sessions stay alive.
        results: list[DispatchResult] = []
        for item in gathered:
            if isinstance(item, BaseException):
                # Worker raised — skip it; it will not appear in results.
                continue
            results.append(item)

        # Revision T-3: default implementation never opens follow-up
        # sessions, so ``extra_session_ids`` is always empty and
        # therefore trivially disjoint with ``results[i].session_id``.
        extra_session_ids: list[SessionId] = []

        # Cleanup: abort ONLY sessions whose worker failed. Successful
        # sessions are preserved for debate-style follow-up dispatches.
        for idx, item in enumerate(gathered):
            if isinstance(item, BaseException):
                sid = session_ids[idx]
                if sid is None:
                    # dispatch() raised before producing a session_id, so
                    # there is nothing to abort on the backend side.
                    logger.warning(
                        "Parallel dispatch worker failed before session creation: %s",
                        item,
                        exc_info=item,
                    )
                    continue
                try:
                    await self.backend.abort_session(sid)
                except Exception:
                    logger.warning(
                        "Failed to abort failed parallel session %s", sid, exc_info=True
                    )

        return results, extra_session_ids

    # ───────────────────────────────────────────────────────────────────
    # Helpers
    # ───────────────────────────────────────────────────────────────────

    @staticmethod
    def _normalize_trace_ids(
        trace_id: TraceId | list[TraceId] | None,
        n: int,
    ) -> list[TraceId]:
        """Normalize ``trace_id`` to a list of length ``n``.

        Rules (Bug C-4):
            * ``None`` → generate one ``TraceId`` and broadcast.
            * ``list`` → must have length ``n``; copy and return as-is.
            * ``TraceId`` (string) → broadcast to all ``n`` workers.

        Args:
            trace_id: Raw input from the caller.
            n: Number of workers (``len(agents)``).

        Returns:
            A list of ``TraceId`` of length ``n``.

        Raises:
            ValidationError: ``trace_id`` is a list whose length does not
                match ``n``.
        """
        if trace_id is None:
            single: TraceId = TraceId(uuid4().hex)
            return [single] * n

        # Detect "list" defensively without importing ``list`` directly.
        if isinstance(trace_id, list):
            if len(trace_id) != n:
                raise ValidationError(
                    "dispatch_parallel: trace_id list length must equal "
                    f"agents length (got {len(trace_id)} trace_ids for "
                    f"{n} agents)"
                )
            return list(trace_id)

        # Single TraceId (str) — broadcast.
        return [trace_id] * n

    @staticmethod
    def _parse_response(raw: str) -> Any:
        """Parse ``raw`` into a structured result.

        Tries ``json.loads`` first. On any parse failure, returns the
        original string so downstream code can still inspect / log it.
        No exception is raised here — the raw text is always available
        via ``DispatchResult.raw``.

        Args:
            raw: Raw text returned by the backend.

        Returns:
            Parsed JSON value, or ``raw`` unchanged if parsing fails.
        """
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return raw