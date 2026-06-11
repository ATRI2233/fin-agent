"""Integration tests for the ``/api/v1/agents`` HTTP API (Phase 3 - Wave 3).

Locks the public HTTP contract of the refactored agents controller
(``main/framework/controllers/agents.py``) and the business logic in
``main/framework/services/agent_query_service.py``.

Endpoints under test (3 routes):
  GET /api/v1/agents          -> 200 list of agent summaries
  GET /api/v1/agents/stats    -> 200 list of per-agent execution stats
  GET /api/v1/agents/{name}   -> 200 single agent summary / 404 problem+json

Happy + error paths are both covered (see test_get_agent_404_returns_problem_json).

Notes:
  - ``AgentQueryService`` is auto-resolved via the DI container's
    ``_SERVICE_MAP`` factory — it needs an ``AgentRepository`` only,
    which the ``client`` fixture already provides through the test
    container override.
  - The agent registry is loaded eagerly at import time from
    ``.opencode/opencode.json`` and holds the 10 documented agents
    (Macro-Scout, Sector-Rotator, ...). The tests rely on at least one
    of those names being present.
"""

from __future__ import annotations

import pytest

# A real agent from the workspace manifest (one of the 10 agents documented
# in the README).  The registry stores names lowercased (e.g. "macro-scout"),
# even though the README writes them in title case.  Using a
# manifest-known name keeps the happy-path tests independent of how many
# agents any future manifest revision adds.
KNOWN_AGENT_NAME = "macro-scout"

# Standard RFC 7807 media type. RFC 7807 section 3 says clients and
# servers SHOULD use this exact value when the body is a problem document.
PROBLEM_MEDIA_TYPE = "application/problem+json"


# ---------------------------------------------------------------------------
# Endpoint: GET /api/v1/agents
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_agents_returns_agent_registry(client):
    """GET /api/v1/agents returns 200 with the full agent summary list.

    Locks the response contract: top-level ``list`` of summary dicts, each
    with the five fields produced by ``AgentQueryService._to_summary``
    (``name``, ``description``, ``capabilities``, ``tools``, ``mode``).
    The workspace manifest ships 10 agents, so we expect at least one
    entry and the well-known ``Macro-Scout`` to be among them.
    """
    response = await client.get("/api/v1/agents")

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    body = response.json()
    assert isinstance(body, list), f"Expected list body, got {type(body).__name__}: {body}"
    assert len(body) >= 1, f"Expected non-empty agent list, got {body!r}"

    # Lock the per-agent shape so a regression in the summary serializer
    # is caught.  These are the five fields that _to_summary builds.
    sample = body[0]
    assert isinstance(sample, dict), f"Agent entry must be dict, got {type(sample)}"
    for key in ("name", "description", "capabilities", "tools", "mode"):
        assert key in sample, f"Agent summary missing {key!r}: {sample}"
    assert isinstance(sample["name"], str) and sample["name"], (
        f"Agent name must be non-empty str, got {sample['name']!r}"
    )

    # At least one of the documented 10 agents must be present so the
    # get-by-name test below has a deterministic target.
    names = {a["name"] for a in body}
    assert KNOWN_AGENT_NAME in names, f"Expected {KNOWN_AGENT_NAME!r} in agent list, got {sorted(names)}"


# ---------------------------------------------------------------------------
# Endpoint: GET /api/v1/agents/stats
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_agent_stats_returns_counts(client):
    """GET /api/v1/agents/stats returns 200 with per-agent execution counts.

    Locks the stats response contract: top-level ``list`` (one entry per
    registered agent) with the six fields produced by
    ``AgentQueryService.agent_stats`` — ``name``, ``description``,
    ``mode``, ``executions_total``, ``executions_completed``,
    ``executions_failed``, ``success_rate``.  With an empty test DB every
    count is zero and ``success_rate`` is 0.0 (denominator clamped to 1
    by the service).
    """
    response = await client.get("/api/v1/agents/stats")

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    body = response.json()
    assert isinstance(body, list), f"Expected list body, got {type(body).__name__}: {body}"
    assert len(body) >= 1, f"Expected non-empty stats list, got {body!r}"

    # Lock the per-agent stats shape.  The service is documented to
    # produce these six fields for every registered agent (even with
    # zero executions).
    sample = body[0]
    assert isinstance(sample, dict), f"Stats entry must be dict, got {type(sample)}"
    for key in (
        "name",
        "description",
        "mode",
        "executions_total",
        "executions_completed",
        "executions_failed",
        "success_rate",
    ):
        assert key in sample, f"Stats entry missing {key!r}: {sample}"

    # The count fields are integers; success_rate is a float in [0, 100].
    assert isinstance(sample["executions_total"], int)
    assert isinstance(sample["executions_completed"], int)
    assert isinstance(sample["executions_failed"], int)
    assert isinstance(sample["success_rate"], (int, float))

    # With an empty test DB every agent must report zero executions.
    assert sample["executions_total"] == 0, f"Empty DB should report zero executions, got {sample['executions_total']}"
    assert sample["success_rate"] == 0.0, f"Empty DB should report zero success_rate, got {sample['success_rate']}"

    # KNOWN_AGENT_NAME must appear in the stats so the lock is anchored
    # on the same agent the list endpoint exposes.
    stat_names = {s["name"] for s in body}
    assert KNOWN_AGENT_NAME in stat_names, f"Expected {KNOWN_AGENT_NAME!r} in stats, got {sorted(stat_names)}"


# ---------------------------------------------------------------------------
# Endpoint: GET /api/v1/agents/{name}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_agent_by_name_returns_agent(client):
    """GET /api/v1/agents/{name} returns 200 with the agent's full summary.

    Locks the happy-path detail contract: the response is the same
    summary dict the list endpoint produces, so the WebUI detail panel
    can render without a second round-trip.  The name echoed in the
    body must match the path parameter.
    """
    response = await client.get(f"/api/v1/agents/{KNOWN_AGENT_NAME}")

    assert response.status_code == 200, (
        f"Expected 200 for known agent {KNOWN_AGENT_NAME!r}, got {response.status_code}: {response.text}"
    )

    body = response.json()
    assert isinstance(body, dict), f"Expected dict body, got {type(body)}"
    assert body["name"] == KNOWN_AGENT_NAME, f"Expected name={KNOWN_AGENT_NAME!r}, got {body.get('name')!r}"

    # Same five fields as the list endpoint — locks the single-doc shape.
    for key in ("name", "description", "capabilities", "tools", "mode"):
        assert key in body, f"Agent detail missing {key!r}: {body}"


# ---------------------------------------------------------------------------
# 404 contract: unknown agent name must produce an RFC 7807 problem document
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_agent_404_returns_problem_json(client):
    """Unknown agent name returns 404 with ``application/problem+json``.

    The controller catches :class:`NotFoundError` from
    ``AgentQueryService.get_by_name`` and raises
    ``HTTPException(404, "Agent not found")``; the global
    ``http_exception_handler`` in ``main.py`` converts that into the
    RFC 7807 envelope. We lock the media type and the four core
    members (``type``, ``title``, ``status``, ``detail``) so a future
    regression in the handler is caught immediately.
    """
    response = await client.get("/api/v1/agents/__definitely_not_a_real_agent__")

    assert response.status_code == 404, f"Expected 404 for unknown agent, got {response.status_code}: {response.text}"
    assert PROBLEM_MEDIA_TYPE in response.headers.get("content-type", ""), (
        f"Expected content-type to contain {PROBLEM_MEDIA_TYPE!r}, got {response.headers.get('content-type')!r}"
    )

    body = response.json()
    assert body.get("status") == 404, f"Missing/wrong status field: {body}"
    assert body.get("title") == "Not Found", f"Missing/wrong title field: {body}"
    assert "type" in body, f"Missing type field: {body}"
    # ``detail`` is forwarded from HTTPException("Agent not found").
    assert "detail" in body and body["detail"], f"Missing detail field: {body}"
    assert "Agent" in body["detail"], f"detail should mention 'Agent': {body['detail']!r}"
