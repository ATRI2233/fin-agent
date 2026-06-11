"""Integration tests for skills HTTP API (Phase 3 - Wave 3 task 3.x).

Locks the public HTTP contract of the migrated skills controller. The
routes live on ``main.framework.controllers.skills`` (thin handlers) and
delegate to ``SkillQueryService`` for the catalog lookup + trigger stub.

Endpoint contract locked (2 routes):
  GET  /api/v1/skills                  -> 200 list[SkillInfo]
  POST /api/v1/skills/{name}/trigger   -> 200 stub response
                                          (message, agents, params)

Error contract (RFC 7807 - Wave 1 task 1.6):
  POST on an unknown skill name raises ``NotFoundError``, which the
  controller maps to ``HTTPException(404, "Skill not found")``. The
  global RFC 7807 handler in ``main.py`` then emits the standard
  ``application/problem+json`` envelope.

Notes:
  - Uses ``client`` fixture from ``tests/conftest.py`` (per-test
    in-memory SQLite DB reset; no cross-test contamination).
  - ``SkillQueryService`` is resolved automatically by the container's
    ``_SERVICE_MAP`` singleton factory — it has no constructor deps
    (the catalog is module-level), so no conftest.py override is
    needed.
"""

from __future__ import annotations

import pytest

# Standard RFC 7807 media type. RFC 7807 §3 says clients and servers
# SHOULD use this exact value when the body is a problem document.
PROBLEM_MEDIA_TYPE = "application/problem+json"

# Skill name that is guaranteed not to exist in the static catalog
# (the catalog has exactly 4 entries — market-briefing, stock-deep,
# fin-review, position-watch).
UNKNOWN_SKILL = "no-such-skill"


@pytest.mark.asyncio
async def test_list_skills_returns_skill_list(client):
    """GET /api/v1/skills returns the full SkillInfo list from the catalog.

    Locks the response contract: top-level ``list`` of dicts, each with
    ``name`` / ``description`` / ``agents``. The catalog is
    intentionally hardcoded in ``skill_query_service.SKILLS`` (mirrors
    the ``.opencode/opencode.json`` ``skills`` section), so the
    expected count is 4 and every entry must expose the three fields.
    """
    response = await client.get("/api/v1/skills")

    assert response.status_code == 200, response.text
    body = response.json()

    # Top-level shape: a JSON list, not an envelope.
    assert isinstance(body, list), f"Expected list, got {type(body).__name__}: {body}"
    assert len(body) >= 1, "Static catalog should expose at least one skill"

    # SkillInfo shape: name (str), description (str), agents (list[str]).
    sample = body[0]
    for key in ("name", "description", "agents"):
        assert key in sample, f"SkillInfo missing {key!r}: {sample}"
    assert isinstance(sample["name"], str) and sample["name"]
    assert isinstance(sample["description"], str) and sample["description"]
    assert isinstance(sample["agents"], list) and len(sample["agents"]) >= 1

    # One of the four well-known catalog skills must be present.
    names = {s["name"] for s in body}
    assert "market-briefing" in names, f"market-briefing missing from {names}"


@pytest.mark.asyncio
async def test_trigger_skill_returns_stub_response(client):
    """POST /api/v1/skills/{name}/trigger returns the documented v1 stub.

    ``SkillQueryService.trigger_skill`` is a stub (no real execution
    yet) that preserves the legacy response shape
    ``{"message", "agents", "params"}``. Locks all three keys: ``message``
    mentions the skill name, ``agents`` is the catalog's agent list for
    that skill, and ``params`` echoes the request body (defaulting to
    ``{}`` when the body is omitted or empty).
    """
    # The controller reads ``params`` as the entire request body
    # (``Body(default=None)``), not a nested key — so the dict is sent
    # at the top level and forwarded verbatim into the stub response.
    response = await client.post(
        "/api/v1/skills/market-briefing/trigger",
        json={"lookback_days": 7},
    )

    assert response.status_code == 200, response.text
    body = response.json()

    # Stub response contract: exactly the three keys, no extras.
    for key in ("message", "agents", "params"):
        assert key in body, f"Stub response missing {key!r}: {body}"

    # message echoes the skill name; agents matches the catalog entry;
    # params is forwarded verbatim from the request body.
    assert "market-briefing" in body["message"], f"message should mention the skill: {body['message']!r}"
    assert body["agents"] == [
        "macro-scout",
        "sector-rotator",
        "sentiment-decoder",
        "technical-chartist",
    ], f"agents should mirror the catalog entry: {body['agents']!r}"
    assert body["params"] == {"lookback_days": 7}, f"params should be forwarded verbatim: {body['params']!r}"

    # When the body is omitted entirely, params defaults to ``{}``.
    empty_response = await client.post("/api/v1/skills/market-briefing/trigger")
    assert empty_response.status_code == 200, empty_response.text
    assert empty_response.json()["params"] == {}, (
        f"params should default to empty dict, got {empty_response.json()['params']!r}"
    )


@pytest.mark.asyncio
async def test_trigger_unknown_skill_returns_problem_json(client):
    """POST on an unknown skill name returns a 404 RFC 7807 problem+json.

    ``SkillQueryService.trigger_skill`` raises ``NotFoundError`` for
    skill names not in the catalog; the controller maps that to
    ``HTTPException(404, "Skill not found")`` and the global handler
    in ``main.py`` converts it to the standard envelope. Locks the
    media type plus the four core RFC 7807 members
    (``type``, ``title``, ``status``, ``detail``).
    """
    response = await client.post(f"/api/v1/skills/{UNKNOWN_SKILL}/trigger", json={})

    assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
    assert PROBLEM_MEDIA_TYPE in response.headers.get("content-type", ""), (
        f"Expected content-type to contain {PROBLEM_MEDIA_TYPE!r}, got {response.headers.get('content-type')!r}"
    )

    body = response.json()
    assert body.get("status") == 404, f"Missing/wrong status field: {body}"
    assert body.get("title") == "Not Found", f"Missing/wrong title field: {body}"
    assert "type" in body, f"Missing type field: {body}"
    assert "detail" in body and body["detail"], f"Missing detail field: {body}"
    # detail comes from the controller's HTTPException detail string.
    assert "Skill" in body["detail"], f"detail should mention 'Skill': {body['detail']!r}"
