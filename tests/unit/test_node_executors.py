"""Unit tests for workflow node executors.

This file is shared by all four node executors created in Wave 4:
``InputNodeExecutor`` (W4.2), ``OutputNodeExecutor`` (W4.3),
``DebateNodeExecutor`` (W4.4), and ``AgentNodeExecutor`` (W4.5).
Each task appends its tests; do not delete the others.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from main.framework.core.workflow.node_executors.base import (
    NodeContext,
    NodeResult,
)
from main.framework.core.workflow.node_executors.agent_executor import (
    AgentNodeExecutor,
)
from main.framework.core.workflow.node_executors.debate_executor import (
    DebateNodeExecutor,
)
from main.framework.core.workflow.node_executors.input_executor import (
    InputNodeExecutor,
)
from main.framework.core.workflow.node_executors.output_executor import (
    OutputNodeExecutor,
)


# ---------------------------------------------------------------------------
# InputNodeExecutor (W4.2)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_input_executor_returns_params() -> None:
    """Input executor returns ctx.params as the result payload."""
    executor = InputNodeExecutor()
    ctx = NodeContext(
        node={"id": "in", "type": "input"},
        execution_id="exec-1",
        predecessor_ids=[],
        params={"x": 1},
        results={},
    )

    result = await executor.execute(ctx)

    assert isinstance(result, NodeResult)
    assert result.result == {"x": 1}


@pytest.mark.asyncio
async def test_input_executor_does_not_call_backend() -> None:
    """Input executor must not invoke a dispatcher or open a DB session."""
    executor = InputNodeExecutor()
    ctx = NodeContext(
        node={"id": "in", "type": "input"},
        execution_id="exec-1",
        predecessor_ids=[],
        params={"foo": "bar"},
        results={},
    )

    # The base class only sets dispatcher in __init__; with the no-arg
    # ctor it must remain None, proving no backend was wired up.
    assert executor.dispatcher is None
    result = await executor.execute(ctx)
    assert result.session_id is None
    assert result.error is None


@pytest.mark.asyncio
async def test_input_executor_output_has_input_key() -> None:
    """Output dict must wrap params under the ``input`` key for downstream consumers."""
    executor = InputNodeExecutor()
    params = {"ticker": "AAPL", "limit": 10}
    ctx = NodeContext(
        node={"id": "in", "type": "input"},
        execution_id="exec-1",
        predecessor_ids=[],
        params=params,
        results={},
    )

    result = await executor.execute(ctx)

    assert result.output is not None
    assert result.output["input"] == params


# ---------------------------------------------------------------------------
# DebateNodeExecutor (W4.4)
# ---------------------------------------------------------------------------


def _make_debate_ctx(
    *,
    prompt: str = "Analyze the stock",
    predecessor_ids: list[str] | None = None,
    results: dict | None = None,
    params: dict | None = None,
) -> NodeContext:
    """Build a NodeContext shaped like a real debate-node invocation."""
    return NodeContext(
        node={
            "id": "debate-1",
            "type": "debate",
            "agents": ["a1", "a2"],
            "judge": "judge",
            "prompt": prompt,
        },
        execution_id="exec-1",
        predecessor_ids=predecessor_ids or [],
        params=params or {},
        results=results or {},
    )


@pytest.mark.asyncio
async def test_debate_executor_calls_debate_executor() -> None:
    """DebateNodeExecutor must invoke ``DebateExecutor.execute_debate`` exactly
    once with a node dict that carries the (possibly enriched) ``prompt``
    field. The original node fields must be preserved on the call argument."""
    executor = DebateNodeExecutor()
    ctx = _make_debate_ctx()

    with patch("main.framework.core.workflow.node_executors.debate_executor.DebateExecutor") as MockDE:
        mock_instance = AsyncMock()
        MockDE.return_value = mock_instance
        mock_instance.execute_debate.return_value = {
            "winner": "a1",
            "analysis": {"score": 1},
            "reasoning": "ok",
        }

        await executor.execute(ctx)

        MockDE.assert_called_once()
        mock_instance.execute_debate.assert_awaited_once()
        call_arg = mock_instance.execute_debate.await_args.args[0]

        # All original node fields preserved
        assert call_arg["id"] == "debate-1"
        assert call_arg["type"] == "debate"
        assert call_arg["agents"] == ["a1", "a2"]
        assert call_arg["judge"] == "judge"
        # Prompt key is present (no predecessor -> equals template)
        assert call_arg["prompt"] == "Analyze the stock"


@pytest.mark.asyncio
async def test_debate_executor_enriches_prompt() -> None:
    """The prompt passed to ``DebateExecutor`` must include the rendered
    upstream predecessor results so debate agents see prior context."""
    executor = DebateNodeExecutor()
    ctx = _make_debate_ctx(
        predecessor_ids=["analyst-1"],
        results={
            "analyst-1": {
                "result": "Price target is $150 based on DCF.",
            }
        },
    )

    with patch("main.framework.core.workflow.node_executors.debate_executor.DebateExecutor") as MockDE:
        mock_instance = AsyncMock()
        MockDE.return_value = mock_instance
        mock_instance.execute_debate.return_value = {
            "winner": "a1",
            "analysis": {},
            "reasoning": "",
        }

        await executor.execute(ctx)

        call_arg = mock_instance.execute_debate.await_args.args[0]
        rendered = call_arg["prompt"]

        # Original template preserved
        assert rendered.startswith("Analyze the stock")
        # Predecessor output is appended
        assert "analyst-1" in rendered
        assert "Price target is $150" in rendered


@pytest.mark.asyncio
async def test_debate_executor_returns_debate_output() -> None:
    """The NodeResult must expose the debate result under the
    ``debate_output`` key (in ``result``) and as the raw output payload."""
    executor = DebateNodeExecutor()
    ctx = _make_debate_ctx()

    debate_payload = {
        "winner": "a1",
        "analysis": {"score": 9, "ticker": "AAPL"},
        "reasoning": "best fit",
    }

    with patch("main.framework.core.workflow.node_executors.debate_executor.DebateExecutor") as MockDE:
        mock_instance = AsyncMock()
        MockDE.return_value = mock_instance
        mock_instance.execute_debate.return_value = debate_payload

        result = await executor.execute(ctx)

    assert isinstance(result, NodeResult)
    assert "debate_output" in result.result
    assert result.result["debate_output"] == debate_payload
    assert result.output == debate_payload
    assert result.error is None
    assert result.session_id is None


# ---------------------------------------------------------------------------
# OutputNodeExecutor (W4.3)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_output_executor_merges_upstream() -> None:
    """Output executor merges results from all predecessors via merge_inputs."""
    executor = OutputNodeExecutor()
    ctx = NodeContext(
        node={"id": "out", "type": "output"},
        execution_id="exec-1",
        predecessor_ids=["a", "b"],
        params={},
        results={
            "a": {"result": "alpha-value"},
            "b": {"result": "beta-value"},
        },
    )

    result = await executor.execute(ctx)

    assert isinstance(result, NodeResult)
    # Both predecessor outputs should appear in the merged string result.
    assert "alpha-value" in result.result
    assert "beta-value" in result.result
    # No outputKey configured -> output equals the merged payload directly.
    assert result.output == result.result


@pytest.mark.asyncio
async def test_output_executor_respects_output_key() -> None:
    """When node.data.outputKey='result', output dict wraps merged under that key."""
    executor = OutputNodeExecutor()
    ctx = NodeContext(
        node={"id": "out", "type": "output", "data": {"outputKey": "result"}},
        execution_id="exec-1",
        predecessor_ids=["a"],
        params={},
        results={"a": {"result": "alpha-value"}},
    )

    result = await executor.execute(ctx)

    assert result.output is not None
    assert isinstance(result.output, dict)
    assert "result" in result.output
    assert "alpha-value" in result.output["result"]


@pytest.mark.asyncio
async def test_output_executor_no_predecessors() -> None:
    """Empty predecessor_ids yields an empty merged result and no backend call."""
    executor = OutputNodeExecutor()
    ctx = NodeContext(
        node={"id": "out", "type": "output"},
        execution_id="exec-1",
        predecessor_ids=[],
        params={},
        results={},
    )

    # Pure node — must not have wired up any dispatcher.
    assert executor.dispatcher is None

    result = await executor.execute(ctx)

    # merge_inputs([]) returns "" -> result is an empty string.
    assert result.result == ""


# ---------------------------------------------------------------------------
# AgentNodeExecutor (W4.5)
# ---------------------------------------------------------------------------


def _make_agent_ctx(
    *,
    node_id: str = "agent-1",
    agent: str = "Fusion-Brain",
    prompt: str = "Analyze AAPL fundamentals.",
    predecessor_ids: list[str] | None = None,
    edges: list[dict] | None = None,
    execution_id: str = "exec-1",
) -> NodeContext:
    """Build a NodeContext shaped like a real agent-node invocation.

    ``edges`` is attached directly on the ctx object (the dataclass allows
    attribute assignment for fields not declared in ``__init__``). The
    executor reads it via ``getattr(ctx, "edges", [])`` so production
    engines can pass it the same way.
    """
    ctx = NodeContext(
        node={
            "id": node_id,
            "type": "agent",
            "agent": agent,
            "prompt": prompt,
        },
        execution_id=execution_id,
        predecessor_ids=predecessor_ids or [],
        params={},
        results={},
    )
    if edges is not None:
        ctx.edges = edges  # type: ignore[attr-defined]
    return ctx


@pytest.mark.asyncio
async def test_agent_executor_session_reuse_single_predecessor() -> None:
    """Single predecessor AND ``is_only_successor=True`` AND predecessor has
    a tracked session → the dispatcher must be called with that session_id,
    proving serial-chain session reuse.
    """
    mock_dispatcher = AsyncMock()
    mock_dispatcher.dispatch.return_value = {
        "result": "analysis-ok",
        "session_id": "new-sess-1",
        "raw": "raw",
    }

    executor = AgentNodeExecutor(dispatcher=mock_dispatcher)
    # Pre-populate the chain session map: pred -> existing session.
    executor._chain_sessions["pred-1"] = "existing-sess-1"

    # edges: only one successor of pred-1 (so is_only_successor == True)
    ctx = _make_agent_ctx(
        node_id="agent-1",
        predecessor_ids=["pred-1"],
        edges=[{"source": "pred-1", "target": "agent-1"}],
    )

    result = await executor.execute(ctx)

    mock_dispatcher.dispatch.assert_awaited_once()
    kwargs = mock_dispatcher.dispatch.await_args.kwargs
    # The reused session must be passed through.
    assert kwargs["session_id"] == "existing-sess-1"
    assert kwargs["agent"] == "Fusion-Brain"
    # The dispatcher-returned session_id is propagated.
    assert result.session_id == "new-sess-1"
    # Internal map is updated so downstream nodes can reuse it.
    assert executor._chain_sessions["agent-1"] == "new-sess-1"


@pytest.mark.asyncio
async def test_agent_executor_creates_new_session() -> None:
    """Multiple predecessors → session reuse is rejected and a new session
    is requested (dispatcher is called with session_id=None).
    """
    mock_dispatcher = AsyncMock()
    mock_dispatcher.dispatch.return_value = {
        "result": "fresh-result",
        "session_id": "brand-new-sess",
        "raw": "raw",
    }

    executor = AgentNodeExecutor(dispatcher=mock_dispatcher)
    # Pre-populate map so we can prove they are NOT used.
    executor._chain_sessions["pred-1"] = "old-1"
    executor._chain_sessions["pred-2"] = "old-2"

    ctx = _make_agent_ctx(
        node_id="agent-1",
        predecessor_ids=["pred-1", "pred-2"],
    )

    result = await executor.execute(ctx)

    mock_dispatcher.dispatch.assert_awaited_once()
    kwargs = mock_dispatcher.dispatch.await_args.kwargs
    # session_id=None forces the dispatcher to create a new session.
    assert kwargs["session_id"] is None
    # The new session returned by the dispatcher is recorded.
    assert result.session_id == "brand-new-sess"
    assert executor._chain_sessions["agent-1"] == "brand-new-sess"


@pytest.mark.asyncio
async def test_agent_executor_returns_dispatch_result() -> None:
    """The dispatcher-returned ``result`` must be wrapped under ``output``
    in ``NodeResult.result`` and mirrored as ``NodeResult.output``; the
    returned ``session_id`` is propagated verbatim.
    """
    mock_dispatcher = AsyncMock()
    mock_dispatcher.dispatch.return_value = {
        "result": {"ticker": "AAPL", "score": 9.4},
        "session_id": "sess-abc",
        "raw": "<raw text>",
    }

    executor = AgentNodeExecutor(dispatcher=mock_dispatcher)
    ctx = _make_agent_ctx(
        node_id="agent-1",
        agent="Technical-Chartist",
        prompt="Run TA on AAPL.",
        predecessor_ids=[],
    )

    result = await executor.execute(ctx)

    assert isinstance(result, NodeResult)
    # result.result wraps the dispatch payload under "output".
    assert result.result == {"output": {"ticker": "AAPL", "score": 9.4}}
    # result.output is the raw dispatch payload.
    assert result.output == {"ticker": "AAPL", "score": 9.4}
    # session_id propagated.
    assert result.session_id == "sess-abc"
    assert result.error is None
