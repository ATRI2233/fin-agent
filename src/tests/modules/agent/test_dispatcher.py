"""Tests for AgentDispatcher trace_id propagation (Phase 1.5 / TASK-114).

These tests verify the §7.6 contract: trace_id must be passed as an explicit
parameter through the entire dispatch chain, and each parallel worker must
have its own trace_id bound to its structlog contextvars (no cross-pollution).

Key invariant: when ``dispatch_parallel`` is called with a ``list[TraceId]``,
each worker must see its OWN trace_id in ``current_trace_id()`` — not the
parent's value and not a sibling worker's value.

See:
    - TASK-114 §3.3 (5 mandatory tests)
    - REVISION_NOTES_2026-06-18.md revision T-7
    - TARGET_ARCHITECTURE_v2 §7.6
    - Do Not #18 (ContextVar cross-task pollution)
"""

from __future__ import annotations

import ast
import asyncio
import inspect
from pathlib import Path
from typing import Any

import pytest

from src.main.infra.domain import AgentReference, SessionId, TraceId
from src.main.infra.settings import Settings
from src.main.modules.agent.service.agent_dispatcher import DefaultAgentDispatcher


# ───────────────────────────────────────────────────────────────────
# Mock backend
# ───────────────────────────────────────────────────────────────────


class MockBackend:
    """Mock AgentBackend: captures every trace_id passed in, returns
    ``current_trace_id()`` as the raw output so we can assert what each
    worker actually saw in its contextvars.

    The ``trace_id_seen_in_wait`` field is what each worker observed via
    ``current_trace_id()`` (structlog's bound contextvar) when its
    ``wait_for_completion`` returned.
    """

    def __init__(self) -> None:
        self.calls: list[TraceId] = []
        self.trace_id_seen_in_wait: list[str] = []

    async def create_session(
        self, agent: AgentReference, trace_id: TraceId
    ) -> SessionId:
        self.calls.append(trace_id)
        return SessionId(f"ses-{trace_id}")

    async def send_message(
        self,
        session_id: SessionId,
        text: str,
        agent: AgentReference | None,
        trace_id: TraceId,
    ) -> None:
        self.calls.append(trace_id)

    async def wait_for_completion(
        self,
        session_id: SessionId,
        *,
        timeout: float,
        after_count: int,
        trace_id: TraceId,
    ) -> str:
        # Read what the contextvar actually holds at this point.
        # This is the critical assertion: each worker should see its
        # OWN trace_id, not the parent's.
        from structlog.contextvars import get_contextvars
        ctx = get_contextvars()
        captured = ctx.get("trace_id", "<none>")
        self.trace_id_seen_in_wait.append(str(captured))
        return str(captured)

    async def abort_session(self, session_id: SessionId) -> None:
        pass

    async def cleanup_sessions(self, ids: list[SessionId]) -> dict[SessionId, str]:
        return {}

    async def close(self) -> None:
        pass


# ───────────────────────────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────────────────────────


def _make_settings() -> Settings:
    """Build a Settings instance suitable for unit tests (no I/O)."""
    return Settings(
        OPENCODE_BIN="opencode",
        OPENCODE_SERVE_PORT=14096,
        API_PORT=18000,
        NODE_TIMEOUT_SECONDS=10.0,
    )


def _make_agent(i: int) -> AgentReference:
    return AgentReference(name=f"agent-{i}", definition_path=None)


# ───────────────────────────────────────────────────────────────────
# Test 1: serial trace_id passthrough
# ───────────────────────────────────────────────────────────────────


def test_serial_trace_passthrough() -> None:
    """Serial dispatch: trace_id flows dispatcher -> backend -> contextvar
    without loss or mutation."""
    backend = MockBackend()
    dispatcher = DefaultAgentDispatcher(backend=backend, settings=_make_settings())
    trace_id = TraceId("tr-serial-0001")

    result = asyncio.run(
        dispatcher.dispatch(
            _make_agent(0),
            "hello",
            timeout=5.0,
            trace_id=trace_id,
        )
    )

    # The raw output is what wait_for_completion saw in its contextvar.
    assert result["raw"] == str(trace_id), (
        f"contextvar pollution: expected {trace_id}, got {result['raw']}"
    )
    # All three backend calls (create_session + send_message + wait_for_completion
    # — wait_for_completion also receives trace_id as a param) used the same trace_id.
    assert all(c == trace_id for c in backend.calls), (
        f"backend calls drifted: {backend.calls}"
    )


# ───────────────────────────────────────────────────────────────────
# Test 2: parallel trace_id isolation (Bug C-4 / revision T-7)
# ───────────────────────────────────────────────────────────────────


def test_parallel_trace_isolation() -> None:
    """10 concurrent workers, each with its own trace_id — no cross-pollution.

    This is the critical Phase 1.5 gate: if the contextvar set in worker A
    leaks to worker B's await chain, the test fails. The test uses a
    list[TraceId] of length 10 and asserts that the i-th worker saw the
    i-th trace_id.
    """
    backend = MockBackend()
    dispatcher = DefaultAgentDispatcher(backend=backend, settings=_make_settings())

    n = 10
    traces: list[TraceId] = [TraceId(f"tr-par-{i:04x}") for i in range(n)]
    agents = [_make_agent(i) for i in range(n)]

    results, extra_sids = asyncio.run(
        dispatcher.dispatch_parallel(
            agents=agents,
            prompt="hello",
            timeout=5.0,
            trace_id=traces,  # one per worker
        )
    )

    # 1. Result count matches agent count.
    assert len(results) == n
    assert extra_sids == []

    # 2. Each worker's raw output equals its OWN trace_id (no cross-pollution).
    for i, (trace_id, result) in enumerate(zip(traces, results)):
        assert result["raw"] == str(trace_id), (
            f"worker {i}: contextvar leak — expected {trace_id}, got {result['raw']}"
        )

    # 3. The contextvar read at wait_for_completion time matches per-worker.
    assert backend.trace_id_seen_in_wait == [str(t) for t in traces], (
        f"contextvar isolation broken: saw {backend.trace_id_seen_in_wait}"
    )


# ───────────────────────────────────────────────────────────────────
# Test 3: gather worker signature (static analysis)
# ───────────────────────────────────────────────────────────────────


def test_gather_worker_signature() -> None:
    """The worker function scheduled via asyncio.gather must carry
    ``trace_id: TraceId`` in its signature.

    We parse the source of ``agent_dispatcher.py`` with the ``ast`` module
    and verify that the worker scheduled by ``dispatch_parallel`` (which is
    ``self.dispatch``) is invoked with ``trace_id=`` as a keyword argument.
    """
    src_path = Path(
        "D:/github_place/fin-agent/project/src/main/modules/agent/service/agent_dispatcher.py"
    )
    tree = ast.parse(src_path.read_text(encoding="utf-8"))

    # Find dispatch_parallel method
    cls = next(
        node for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef) and node.name == "DefaultAgentDispatcher"
    )
    method = next(
        m for m in cls.body
        if isinstance(m, ast.AsyncFunctionDef) and m.name == "dispatch_parallel"
    )

    # Look inside dispatch_parallel for self.dispatch(..., trace_id=...) call.
    found_trace_id_kwarg = False
    for node in ast.walk(method):
        if isinstance(node, ast.Call):
            func = node.func
            # Match self.dispatch(...)
            if (
                isinstance(func, ast.Attribute)
                and func.attr == "dispatch"
            ):
                for kw in node.keywords:
                    if kw.arg == "trace_id":
                        found_trace_id_kwarg = True

    assert found_trace_id_kwarg, (
        "dispatch_parallel must call self.dispatch(..., trace_id=<tid>) — "
        "otherwise the worker signature doesn't carry trace_id"
    )

    # Also verify the dispatch method's signature includes trace_id: TraceId.
    dispatch_method = next(
        m for m in cls.body
        if isinstance(m, ast.AsyncFunctionDef) and m.name == "dispatch"
    )
    all_arg_names = (
        [a.arg for a in dispatch_method.args.args]
        + [a.arg for a in dispatch_method.args.kwonlyargs]
    )
    assert "trace_id" in all_arg_names, (
        f"dispatch() must accept trace_id; got args {all_arg_names}"
    )
    # And it must be keyword-only (after the *).
    found_kwonly = any(
        a.arg == "trace_id" for a in dispatch_method.args.kwonlyargs
    )
    assert found_kwonly, "trace_id must be keyword-only in dispatch()"


# ───────────────────────────────────────────────────────────────────
# Test 4: bind/unbind pairing (AST verification)
# ───────────────────────────────────────────────────────────────────


def test_bind_unbind_paired() -> None:
    """Every ``bind_contextvars`` in the worker body must have a matching
    ``unbind_contextvars`` in the same enclosing try/finally.

    We walk the AST of ``agent_dispatcher.dispatch`` and confirm that for
    each Try block whose try-body contains a ``bind_contextvars`` call,
    the finalbody (finally clause) contains an ``unbind_contextvars`` call
    unbinding the same key.
    """
    src_path = Path(
        "D:/github_place/fin-agent/project/src/main/modules/agent/service/agent_dispatcher.py"
    )
    tree = ast.parse(src_path.read_text(encoding="utf-8"))

    cls = next(
        node for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef) and node.name == "DefaultAgentDispatcher"
    )
    dispatch_method = next(
        m for m in cls.body
        if isinstance(m, ast.AsyncFunctionDef) and m.name == "dispatch"
    )

    def _calls_bind_contextvars(node: ast.AST) -> list[str]:
        """Return the list of bound keys inside ``node``."""
        keys: list[str] = []
        for sub in ast.walk(node):
            if (
                isinstance(sub, ast.Call)
                and isinstance(sub.func, ast.Name)
                and sub.func.id == "bind_contextvars"
            ):
                for kw in sub.keywords:
                    if kw.arg:
                        keys.append(kw.arg)
        return keys

    def _calls_unbind_contextvars(node: ast.AST) -> list[str]:
        """Return the list of unbound keys inside ``node``."""
        keys: list[str] = []
        for sub in ast.walk(node):
            if (
                isinstance(sub, ast.Call)
                and isinstance(sub.func, ast.Name)
                and sub.func.id == "unbind_contextvars"
            ):
                if sub.args and isinstance(sub.args[0], ast.Constant):
                    keys.append(sub.args[0].value)
        return keys

    # Walk the method body: every try block that binds must unbind.
    paired_try_count = 0
    for node in ast.walk(dispatch_method):
        if not isinstance(node, ast.Try):
            continue
        bound = _calls_bind_contextvars(node)
        if not bound:
            continue
        # The finally block (finalbody) must unbind each key.
        unbound_in_finally: list[str] = []
        for fin_stmt in node.finalbody:
            unbound_in_finally.extend(_calls_unbind_contextvars(fin_stmt))
        for key in bound:
            assert key in unbound_in_finally, (
                f"bind_contextvars({key}=...) in dispatch() has no matching "
                f"unbind_contextvars('{key}') in the enclosing finally — "
                f"Do Not #18 violation (contextvar leak)"
            )
            paired_try_count += 1

    assert paired_try_count >= 1, (
        "Expected at least 1 paired bind/unbind block in dispatch(); found 0. "
        "This means trace_id is not being bound at all — Phase 1.5 not implemented."
    )


# ───────────────────────────────────────────────────────────────────
# Test 5: serve_backend env var (FIN_AGENT_TRACE_ID)
# ───────────────────────────────────────────────────────────────────


def test_serve_backend_env_var() -> None:
    """ServeBackend._spawn must inject trace_id into the subprocess env as
    ``settings.TRACE_ID_ENV_VAR`` (= ``FIN_AGENT_TRACE_ID``)."""
    from src.main.modules.agent.adapter.serve_backend import ServeBackend

    # Read the source to confirm the env var injection is present.
    src_path = Path(
        "D:/github_place/fin-agent/project/src/main/modules/agent/adapter/serve_backend.py"
    )
    source = src_path.read_text(encoding="utf-8")

    # Check TRACE_ID_ENV_VAR references in the file (the env var NAME
    # comes from settings, not a literal in serve_backend).
    assert "TRACE_ID_ENV_VAR" in source, (
        "serve_backend.py must reference settings.TRACE_ID_ENV_VAR"
    )

    # Check that env[TRACE_ID_ENV_VAR] = str(trace_id) is set when spawning.
    # The literal string pattern is what _spawn() does.
    assert "env = {**os.environ" in source, (
        "_spawn() must construct env from os.environ + TRACE_ID_ENV_VAR"
    )
    assert "str(trace_id)" in source, (
        "_spawn() must stringify trace_id before injecting into env"
    )

    # Additionally: do a structural check that TRACE_ID_ENV_VAR is set to
    # the right default ("FIN_AGENT_TRACE_ID") in settings.
    from src.main.infra.settings import Settings
    s = Settings()
    assert s.TRACE_ID_ENV_VAR == "FIN_AGENT_TRACE_ID", (
        f"Settings.TRACE_ID_ENV_VAR must be 'FIN_AGENT_TRACE_ID'; got {s.TRACE_ID_ENV_VAR}"
    )
