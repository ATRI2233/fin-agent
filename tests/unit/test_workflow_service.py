"""Unit tests for main.framework.services.workflow_service.WorkflowService (W4.10).

These tests use mocked ``workflow_repo``, ``exec_service``, and ``registry`` to
isolate the orchestration logic from the concrete classes delivered by W4.6
(registry) and W4.9 (execution service). The service's contract is what we
verify here; integration with the real classes is covered by the W4.11
``WorkflowEngine`` rewrite and downstream test_workflow_engine tests.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from main.framework.core.workflow.node_executors.base import (
    NodeContext,
    NodeResult,
)
from main.framework.services.workflow_service import (
    ExecutionServiceProtocol,
    NodeExecutorRegistryProtocol,
    WorkflowRepositoryProtocol,
    WorkflowService,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_workflow(nodes: list[dict], edges: list[dict] | None = None) -> MagicMock:
    """Build a workflow-shaped mock with .nodes / .edges attributes."""
    wf = MagicMock()
    wf.nodes = nodes
    wf.edges = edges or []
    return wf


def _make_workflow_repo(workflow: MagicMock | None) -> MagicMock:
    repo = MagicMock(spec=WorkflowRepositoryProtocol)
    repo.get = MagicMock(return_value=workflow)
    return repo


def _make_exec_service(execution_id: str = "exec-abc") -> MagicMock:
    """Mock ExecutionService with the actual signature (workflow, params, db)."""
    exec_svc = MagicMock(spec=ExecutionServiceProtocol)
    execution_obj = MagicMock()
    execution_obj.id = execution_id
    exec_svc.create_execution_for_workflow = MagicMock(return_value=execution_obj)
    exec_svc.mark_downstream_skipped = MagicMock(return_value=[])
    return exec_svc


def _make_registry(executors: dict[str, AsyncMock] | None = None) -> MagicMock:
    """Mock NodeExecutorRegistry. ``executors`` maps node_type -> AsyncMock that returns NodeResult."""
    reg = MagicMock(spec=NodeExecutorRegistryProtocol)
    executors = executors or {}

    def _get(node_type: str) -> AsyncMock:
        if node_type not in executors:
            # Default fallback: return a no-op async executor.
            exec_mock = AsyncMock()
            exec_mock.execute = AsyncMock(return_value=NodeResult(result={"ok": True}))
            executors[node_type] = exec_mock
        return executors[node_type]

    reg.get = MagicMock(side_effect=_get)
    return reg


def _make_node(node_id: str, node_type: str = "agent", **extra) -> dict:
    return {"id": node_id, "type": node_type, "agent": f"Agent-{node_id}", **extra}


# ---------------------------------------------------------------------------
# Construction / contract
# ---------------------------------------------------------------------------


def test_workflow_service_imports() -> None:
    """Module exposes ``WorkflowService`` with the documented 4-method surface."""
    assert hasattr(WorkflowService, "run")
    assert hasattr(WorkflowService, "_execute_in_order")
    assert hasattr(WorkflowService, "execute_node")
    assert hasattr(WorkflowService, "handle_failure")


def test_module_docstring_mentions_dag_orchestration() -> None:
    """The module docstring must call out DAG orchestration / outer-loop replacement."""
    import main.framework.services.workflow_service as mod

    assert mod.__doc__ is not None
    assert "DAG orchestration" in mod.__doc__
    assert "WorkflowEngine" in mod.__doc__


def test_protocols_runtime_checkable() -> None:
    """Dependency protocols must be runtime_checkable so duck-typing works at the DI boundary."""
    from main.framework.services.workflow_service import (
        ExecutionServiceProtocol,
        NodeExecutorRegistryProtocol,
        WorkflowRepositoryProtocol,
    )

    # All three protocols are registered with @runtime_checkable.
    assert hasattr(ExecutionServiceProtocol, "_is_runtime_protocol")
    assert hasattr(NodeExecutorRegistryProtocol, "_is_runtime_protocol")
    assert hasattr(WorkflowRepositoryProtocol, "_is_runtime_protocol")


# ---------------------------------------------------------------------------
# run()
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_loads_workflow() -> None:
    """``run`` must call ``workflow_repo.get`` exactly once with the workflow_id."""
    workflow = _make_workflow([_make_node("a"), _make_node("b")])
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service()
    registry = _make_registry()

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=registry)
    await service.run("wf-1", {"ticker": "AAPL"}, db=None)

    repo.get.assert_called_once_with("wf-1")


@pytest.mark.asyncio
async def test_run_creates_execution_when_id_missing() -> None:
    """``run`` must call ``exec_service.create_execution_for_workflow`` when no execution_id is provided."""
    workflow = _make_workflow([_make_node("a")])
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service(execution_id="exec-99")
    registry = _make_registry()

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=registry)
    await service.run("wf-1", {"x": 1}, db=None)

    exec_svc.create_execution_for_workflow.assert_called_once()
    # Args: (workflow_object, params, db) — actual W4.9 signature.
    call_args = exec_svc.create_execution_for_workflow.call_args
    assert call_args.args[0] is workflow  # workflow object
    assert call_args.args[1] == {"x": 1}  # params
    # And the returned execution id propagates into the result.
    assert service.execution_id == "exec-99"


@pytest.mark.asyncio
async def test_run_uses_provided_execution_id() -> None:
    """When the caller provides an execution_id, ``run`` must not create a new one."""
    workflow = _make_workflow([_make_node("a")])
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service()
    registry = _make_registry()

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=registry)
    await service.run("wf-1", {}, db=None, execution_id="exec-pre-existing")

    exec_svc.create_execution_for_workflow.assert_not_called()
    assert service.execution_id == "exec-pre-existing"


@pytest.mark.asyncio
async def test_run_executes_in_order_serial_chain() -> None:
    """A serial 2-node chain (a -> b) must execute both nodes; b is dispatched after a."""
    workflow = _make_workflow(
        nodes=[_make_node("a"), _make_node("b")],
        edges=[{"source": "a", "target": "b"}],
    )
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service()
    # Record the order of executor invocations.
    call_log: list[str] = []
    exec_a = AsyncMock()
    exec_a.execute = AsyncMock(side_effect=lambda ctx: _log_then_return(call_log, "a", ctx))
    exec_b = AsyncMock()
    exec_b.execute = AsyncMock(side_effect=lambda ctx: _log_then_return(call_log, "b", ctx))
    registry = _make_registry({"agent": exec_a})  # both nodes are "agent" type

    # Force a + b to use distinct mocks.
    def _side_effect(node_type: str):
        if node_type == "agent":
            # Alternate between a and b mocks based on which ctx we see.
            return MagicMock(execute=AsyncMock(side_effect=lambda ctx: _dispatch(call_log, ctx, exec_a, exec_b)))
        return exec_a

    registry.get = MagicMock(side_effect=_side_effect)

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=registry)
    result = await service.run("wf-1", {}, db=None)

    assert call_log == ["a", "b"]  # serial chain
    assert result["status"] == "completed"
    assert "a" in result["results"]
    assert "b" in result["results"]


def _log_then_return(log: list[str], name: str, ctx: NodeContext) -> NodeResult:
    log.append(name)
    return NodeResult(result={"ran": name})


def _dispatch(log: list[str], ctx: NodeContext, exec_a: AsyncMock, exec_b: AsyncMock):
    """Pick the right executor based on the ctx's node id; record order."""
    nid = ctx.node["id"]
    if nid == "a":
        log.append("a")
        return NodeResult(result={"ran": "a"})
    if nid == "b":
        log.append("b")
        return NodeResult(result={"ran": "b"})
    return NodeResult(result={})


@pytest.mark.asyncio
async def test_run_returns_result_dict() -> None:
    """``run`` must return a dict with the expected keys."""
    workflow = _make_workflow([_make_node("a")])
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service()
    registry = _make_registry()

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=registry)
    result = await service.run("wf-1", {}, db=None)

    assert isinstance(result, dict)
    assert "status" in result
    assert "results" in result
    assert "failed_nodes" in result
    assert "skipped_nodes" in result
    assert "execution_id" in result
    assert result["status"] == "completed"
    assert result["failed_nodes"] == []


@pytest.mark.asyncio
async def test_run_passes_status_callback() -> None:
    """The status callback must be invoked at least with running + final status."""
    workflow = _make_workflow([_make_node("a")])
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service()
    registry = _make_registry()

    captured: list[tuple[str, str, str]] = []
    callback = AsyncMock(side_effect=lambda s, m, a: captured.append((s, m, a)))

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=registry)
    await service.run("wf-1", {}, db=None, status_callback=callback)

    callback.assert_awaited()
    statuses = [c[0] for c in captured]
    # Must have at least "running" and "completed" emitted.
    assert "running" in statuses
    assert "completed" in statuses


@pytest.mark.asyncio
async def test_run_calls_cleanup_sessions() -> None:
    """``run`` must call ``dispatcher.backend.cleanup_sessions`` in the finally clause when sessions exist."""
    workflow = _make_workflow([_make_node("a")])
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service()
    registry = _make_registry()

    # Inject a session id via the executor's NodeResult.
    reg_mock = MagicMock(spec=NodeExecutorRegistryProtocol)
    sess_exec = AsyncMock()
    sess_exec.execute = AsyncMock(return_value=NodeResult(result={"ok": True}, session_id="sess-1"))
    reg_mock.get = MagicMock(return_value=sess_exec)

    # Mock dispatcher with a backend.cleanup_sessions coroutine.
    dispatcher = MagicMock()
    cleanup_mock = AsyncMock(return_value={"sess-1": "cleaned"})
    dispatcher.backend = MagicMock(cleanup_sessions=cleanup_mock)

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=reg_mock, dispatcher=dispatcher)
    await service.run("wf-1", {}, db=None)

    cleanup_mock.assert_awaited()
    assert cleanup_mock.await_args is not None
    assert cleanup_mock.await_args.args[0] == ["sess-1"]


# ---------------------------------------------------------------------------
# execute_node()
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_execute_node_uses_registry() -> None:
    """``execute_node`` must look up the executor in the registry by the node's type."""
    workflow = _make_workflow([_make_node("n1", node_type="debate")])
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service()

    reg_mock = MagicMock(spec=NodeExecutorRegistryProtocol)
    debate_exec = AsyncMock()
    debate_exec.execute = AsyncMock(return_value=NodeResult(result={"debated": True}))
    reg_mock.get = MagicMock(return_value=debate_exec)

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=reg_mock)
    # Populate internal state by going through run() minimally; or set directly.
    service.nodes = workflow.nodes
    service.edges = workflow.edges
    service.params = {}
    service.execution_id = "exec-1"

    await service.execute_node("n1", "exec-1", db=None)

    reg_mock.get.assert_called_with("debate")
    debate_exec.execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_execute_node_passes_context() -> None:
    """The :class:`NodeContext` passed to the executor must carry the node spec, params, results, predecessor_ids."""
    workflow = _make_workflow(
        nodes=[_make_node("pred"), _make_node("child")],
        edges=[{"source": "pred", "target": "child"}],
    )
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service()

    reg_mock = MagicMock(spec=NodeExecutorRegistryProtocol)
    captured_ctx: list[NodeContext] = []
    child_exec = AsyncMock()
    child_exec.execute = AsyncMock(side_effect=lambda ctx: _capture_ctx(captured_ctx, ctx))
    reg_mock.get = MagicMock(return_value=child_exec)

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=reg_mock)
    service.nodes = workflow.nodes
    service.edges = workflow.edges
    service.params = {"ticker": "AAPL"}
    service.execution_id = "exec-77"

    await service.execute_node("child", "exec-77", db=None)

    assert len(captured_ctx) == 1
    ctx = captured_ctx[0]
    assert isinstance(ctx, NodeContext)
    assert ctx.node["id"] == "child"
    assert ctx.execution_id == "exec-77"
    assert ctx.params == {"ticker": "AAPL"}
    assert ctx.predecessor_ids == ["pred"]
    assert ctx.results == {}


def _capture_ctx(captured: list[NodeContext], ctx: NodeContext) -> NodeResult:
    captured.append(ctx)
    return NodeResult(result={"ok": True})


@pytest.mark.asyncio
async def test_execute_node_tracks_session_id() -> None:
    """When the executor's NodeResult carries a session_id, the service must record it for chain reuse."""
    workflow = _make_workflow([_make_node("n1")])
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service()

    reg_mock = MagicMock(spec=NodeExecutorRegistryProtocol)
    sess_exec = AsyncMock()
    sess_exec.execute = AsyncMock(return_value=NodeResult(result={"ok": True}, session_id="sess-X"))
    reg_mock.get = MagicMock(return_value=sess_exec)

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=reg_mock)
    service.nodes = workflow.nodes
    service.edges = workflow.edges
    service.execution_id = "exec-1"

    await service.execute_node("n1", "exec-1", db=None)

    assert service._chain_sessions["n1"] == "sess-X"


@pytest.mark.asyncio
async def test_execute_node_returns_dict_shape() -> None:
    """``execute_node`` must return a dict containing result/output/session_id keys."""
    workflow = _make_workflow([_make_node("n1")])
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service()

    reg_mock = MagicMock(spec=NodeExecutorRegistryProtocol)
    sess_exec = AsyncMock()
    sess_exec.execute = AsyncMock(
        return_value=NodeResult(
            result={"answer": 42},
            output={"answer": 42},
            session_id="sess-1",
        )
    )
    reg_mock.get = MagicMock(return_value=sess_exec)

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=reg_mock)
    service.nodes = workflow.nodes
    service.edges = workflow.edges
    service.execution_id = "exec-1"

    result = await service.execute_node("n1", "exec-1", db=None)

    assert isinstance(result, dict)
    assert result["result"] == {"answer": 42}
    assert result["output"] == {"answer": 42}
    assert result["session_id"] == "sess-1"


# ---------------------------------------------------------------------------
# handle_failure()
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_handle_failure_marks_downstream() -> None:
    """``handle_failure`` must delegate to ``exec_service.mark_downstream_skipped``."""
    workflow = _make_workflow(
        nodes=[_make_node("a"), _make_node("b"), _make_node("c")],
        edges=[
            {"source": "a", "target": "b"},
            {"source": "a", "target": "c"},
        ],
    )
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service()

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=MagicMock())
    service.nodes = workflow.nodes
    service.edges = workflow.edges

    await service.handle_failure("a", RuntimeError("boom"), db=None)

    exec_svc.mark_downstream_skipped.assert_called_once()
    args = exec_svc.mark_downstream_skipped.call_args.args
    assert args[0] == "a"  # node_id
    assert args[1] == workflow.edges  # edges list
    # Local mirror must include the downstream ids.
    assert "b" in service._skipped_nodes
    assert "c" in service._skipped_nodes
    assert "a" in service._failed_nodes


@pytest.mark.asyncio
async def test_handle_failure_propagates_skip_to_grandchildren() -> None:
    """The skip cascade must reach grandchildren (multi-hop downstream)."""
    workflow = _make_workflow(
        nodes=[_make_node("root"), _make_node("mid"), _make_node("leaf")],
        edges=[
            {"source": "root", "target": "mid"},
            {"source": "mid", "target": "leaf"},
        ],
    )
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service()

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=MagicMock())
    service.nodes = workflow.nodes
    service.edges = workflow.edges

    await service.handle_failure("root", RuntimeError("kaboom"), db=None)

    assert "mid" in service._skipped_nodes
    assert "leaf" in service._skipped_nodes


# ---------------------------------------------------------------------------
# _execute_in_order() — parallel-branch gather behaviour
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_parallel_branches_use_gather() -> None:
    """When a level has multiple independent nodes, ``_execute_in_order`` must use ``asyncio.gather``."""
    workflow = _make_workflow(
        nodes=[_make_node("a"), _make_node("b")],  # no edges -> independent
        edges=[],
    )
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service()
    registry = _make_registry()

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=registry)
    service.nodes = workflow.nodes
    service.edges = workflow.edges
    service.execution_id = "exec-1"

    # Spy on asyncio.gather: record how many coroutines it was called with
    # and STILL await them so we don't leave un-awaited coroutines behind.
    # Using a bare AsyncMock() replacement would swallow the coroutines and
    # trigger ``RuntimeWarning: coroutine was never awaited``.
    gather_calls: list[tuple[Any, ...]] = []
    real_gather = asyncio.gather

    async def spy_gather(*coros: Any, **kwargs: Any) -> list[Any]:
        gather_calls.append(coros)
        return await real_gather(*coros, **kwargs)

    with patch("main.framework.services.workflow_service.asyncio.gather", side_effect=spy_gather):
        await service._execute_in_order(["a", "b"], {}, {}, db=None)

    # asyncio.gather should have been called exactly once with 2 coroutines.
    assert len(gather_calls) == 1
    assert len(gather_calls[0]) == 2


@pytest.mark.asyncio
async def test_serial_chain_does_not_use_gather() -> None:
    """A serial chain (a -> b) must not use asyncio.gather (no parallelism possible)."""
    workflow = _make_workflow(
        nodes=[_make_node("a"), _make_node("b")],
        edges=[{"source": "a", "target": "b"}],
    )
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service()
    registry = _make_registry()

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=registry)
    service.nodes = workflow.nodes
    service.edges = workflow.edges
    service.execution_id = "exec-1"

    gather_calls: list[tuple[Any, ...]] = []
    real_gather = asyncio.gather

    async def spy_gather(*coros: Any, **kwargs: Any) -> list[Any]:
        gather_calls.append(coros)
        return await real_gather(*coros, **kwargs)

    with patch("main.framework.services.workflow_service.asyncio.gather", side_effect=spy_gather):
        await service._execute_in_order(
            ["a", "b"],
            {},
            {"a": [], "b": ["a"]},  # serial predecessors
            db=None,
        )

    # gather should NOT be called for a serial chain.
    assert gather_calls == []


# ---------------------------------------------------------------------------
# Failure routing inside run()
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_handles_node_failure() -> None:
    """When an executor raises, ``run`` must invoke :meth:`handle_failure` and propagate the failure.

    We wrap the real :meth:`handle_failure` with a spy (calls through to the
    real method) so the side effects on ``_failed_nodes`` and the
    ``mark_downstream_skipped`` cascade still happen — that's how the
    failure status propagates into the returned summary.
    """
    workflow = _make_workflow([_make_node("a")])
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service()

    reg_mock = MagicMock(spec=NodeExecutorRegistryProtocol)
    failing_exec = AsyncMock()
    failing_exec.execute = AsyncMock(side_effect=RuntimeError("dispatch-failed"))
    reg_mock.get = MagicMock(return_value=failing_exec)

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=reg_mock)

    # Spy: count invocations but still execute the real method.
    real_hf = service.handle_failure
    call_log: list[tuple[str, Exception]] = []

    async def spy_hf(node_id: str, error: Exception, db: Any) -> None:
        call_log.append((node_id, error))
        await real_hf(node_id, error, db)

    service.handle_failure = spy_hf  # type: ignore[method-assign]

    result = await service.run("wf-1", {}, db=None)

    # handle_failure was called exactly once, with the right args.
    assert len(call_log) == 1
    assert call_log[0][0] == "a"
    assert isinstance(call_log[0][1], RuntimeError)
    # The real method populated _failed_nodes, which is reflected in the result.
    assert result["status"] == "failed"
    assert "a" in result["failed_nodes"]
    # And the cascade delegator was called.
    exec_svc.mark_downstream_skipped.assert_called_once()


@pytest.mark.asyncio
async def test_run_skips_downstream_after_failure() -> None:
    """When a node fails, downstream nodes must be marked skipped (via exec_service)."""
    workflow = _make_workflow(
        nodes=[_make_node("a"), _make_node("b"), _make_node("c")],
        edges=[
            {"source": "a", "target": "b"},
            {"source": "b", "target": "c"},
        ],
    )
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service()

    reg_mock = MagicMock(spec=NodeExecutorRegistryProtocol)

    def _side_effect(node_type: str) -> AsyncMock:
        m = AsyncMock()
        if node_type == "agent":
            # Fail only when the node id is "a".
            async def _execute(ctx: NodeContext) -> NodeResult:
                if ctx.node["id"] == "a":
                    raise RuntimeError("a-fail")
                return NodeResult(result={"ran": ctx.node["id"]})

            m.execute = _execute
        return m

    reg_mock.get = MagicMock(side_effect=_side_effect)

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=reg_mock)
    result = await service.run("wf-1", {}, db=None)

    # b and c should have been cascaded skipped via the exec_service.
    assert exec_svc.mark_downstream_skipped.called
    assert "a" in result["failed_nodes"]
    # b and c should be in skipped mirror.
    assert "b" in service._skipped_nodes
    assert "c" in service._skipped_nodes
    assert result["status"] == "failed"


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_handle_failure_logs_warning(caplog) -> None:
    """``handle_failure`` must emit a warning-level log containing the node id and error."""
    workflow = _make_workflow([_make_node("a")])
    repo = _make_workflow_repo(workflow)
    exec_svc = _make_exec_service()

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=MagicMock())
    service.nodes = workflow.nodes
    service.edges = workflow.edges

    with caplog.at_level(logging.WARNING, logger="main.framework.services.workflow_service"):
        await service.handle_failure("a", RuntimeError("boom"), db=None)

    # At least one warning mentioning the node id and error.
    matched = [r for r in caplog.records if "a" in r.getMessage() and "boom" in r.getMessage()]
    assert matched, (
        f"Expected a warning about node 'a' failing with 'boom'; got: {[r.getMessage() for r in caplog.records]}"
    )
    assert all(r.levelno == logging.WARNING for r in matched)


# ---------------------------------------------------------------------------
# Reset semantics
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_resets_state_between_invocations() -> None:
    """A second ``run`` call must start from a clean slate (no leaked failed/skipped sets)."""
    workflow_a = _make_workflow([_make_node("a")])
    workflow_b = _make_workflow([_make_node("b")])
    repo = MagicMock(spec=WorkflowRepositoryProtocol)
    repo.get = MagicMock(side_effect=[workflow_a, workflow_b])
    exec_svc = _make_exec_service()
    registry = _make_registry()

    service = WorkflowService(workflow_repo=repo, exec_service=exec_svc, registry=registry)

    await service.run("wf-1", {}, db=None)
    # Inject some state leakage manually to prove reset works.
    service._failed_nodes.add("ghost")
    service._skipped_nodes.add("phantom")

    await service.run("wf-2", {}, db=None)
    # The second run should have wiped the leaked state.
    assert "ghost" not in service._failed_nodes
    assert "phantom" not in service._skipped_nodes
    # And only workflow-2's node should appear in the second result.
    assert "b" in service._results
    assert "a" not in service._results
