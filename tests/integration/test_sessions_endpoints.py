"""Integration tests for sessions HTTP API (Phase 3 - Wave 3 task 3.x).

These tests lock the public HTTP contract of the migrated sessions
controller. The routes live on
``main.framework.controllers.sessions`` (thin handlers) and delegate to
``SessionService`` for all business logic (listing, lookup, cleanup).

Endpoint contract locked:
  GET    /api/v1/sessions              -> 200 SessionListResponse
                                           (sessions list, total, active_count)
  GET    /api/v1/sessions/{id}         -> 200 SessionInfo
  DELETE /api/v1/sessions/{id}         -> 200 cleanup acknowledgement
  POST   /api/v1/sessions/cleanup      -> 200 CleanupResponse
                                           (cleaned, failed, details)

Error contract (RFC 7807 - Wave 1 task 1.6):
  All 4xx/5xx responses return ``application/problem+json`` with the
  standard ProblemDetail fields (type, title, status, detail, instance).
  This file locks the 404 path on session lookup and the 400 path on
  bulk-cleanup with no filter (service-level validation of required
  fields).

Notes:
  - Uses ``client`` fixture from ``tests/conftest.py`` (per-test in-memory
    SQLite DB reset between tests; no cross-test contamination).
  - The per-test in-memory DB starts empty; happy-path tests seed an
    ``ExecutionNode`` row directly so the lookup is deterministic.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# UUID that is syntactically valid but guaranteed not to exist in the
# per-test in-memory SQLite database. Using a real UUIDv4-shaped string
# also proves the sessions endpoint parses the path as a string, not as
# an int (which would 422 instead of 404).
UNKNOWN_SESSION_ID = "00000000-0000-0000-0000-000000000000"

# Standard RFC 7807 media type. RFC 7807 section 3 says clients and
# servers SHOULD use this exact value when the body is a problem document.
PROBLEM_MEDIA_TYPE = "application/problem+json"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _seed_execution_node(
    db_session,
    *,
    session_id: str,
    execution_id: str = "exec-1",
    node_id: str = "node-1",
    agent: str = "macro-scout",
    status: str = "completed",
) -> None:
    """Insert one ``ExecutionNode`` row carrying the given session_id.

    The SessionService list/get paths read straight from ``execution_nodes``
    (see ``services/session_service.py``); seeding via the ORM is the
    shortest deterministic way to make those endpoints return data.
    """
    from main.framework.models.workflow_execution import ExecutionNode

    node = ExecutionNode(
        id=f"en-{session_id}",
        execution_id=execution_id,
        node_id=node_id,
        agent=agent,
        status=status,
        session_id=session_id,
        started_at=datetime.now(UTC),
    )
    db_session.add(node)
    db_session.commit()


# ---------------------------------------------------------------------------
# List endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_sessions_returns_paginated_dict(client, db_session):
    """GET /api/v1/sessions returns the ``SessionListResponse`` envelope.

    Locks the public response shape: ``sessions`` (list), ``total``
    (int), and ``active_count`` (int). The endpoint has no skip/limit
    query params, so we verify the envelope keys rather than pagination
    metadata.
    """
    _seed_execution_node(db_session, session_id="sess-list-1", status="running")
    _seed_execution_node(
        db_session,
        session_id="sess-list-2",
        execution_id="exec-2",
        node_id="node-2",
        agent="technical-chartist",
        status="completed",
    )

    response = await client.get("/api/v1/sessions")

    assert response.status_code == 200, response.text
    body = response.json()

    # Envelope keys are part of the contract — adding a key is fine,
    # removing or renaming any of these would break consumers.
    assert "sessions" in body and isinstance(body["sessions"], list)
    assert "total" in body and isinstance(body["total"], int)
    assert "active_count" in body and isinstance(body["active_count"], int)

    # Both seeded sessions must appear; ``active_count`` counts nodes in
    # pending/running status, so it should be 1.
    session_ids = {s["session_id"] for s in body["sessions"]}
    assert {"sess-list-1", "sess-list-2"}.issubset(session_ids)
    assert body["total"] == len(body["sessions"])
    assert body["active_count"] >= 1

    # Each session entry has the SessionInfo shape.
    sample = body["sessions"][0]
    for key in ("session_id", "source", "status"):
        assert key in sample, f"SessionInfo missing {key!r}: {sample}"


# ---------------------------------------------------------------------------
# Get-by-id endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_session_by_id_returns_session_info(client, db_session):
    """GET /api/v1/sessions/{id} returns SessionInfo for a known session.

    Seeds a single ``ExecutionNode`` carrying the target session_id, then
    asserts the response carries the expected SessionInfo fields.
    """
    target_id = "sess-known-aaaa"
    _seed_execution_node(
        db_session,
        session_id=target_id,
        execution_id="exec-99",
        node_id="node-99",
        agent="sentiment-decoder",
        status="running",
    )

    response = await client.get(f"/api/v1/sessions/{target_id}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["session_id"] == target_id
    assert body["source"] == "workflow"
    assert body["execution_id"] == "exec-99"
    assert body["node_id"] == "node-99"
    assert body["agent"] == "sentiment-decoder"
    # Service maps ExecutionNode status -> session status: running -> active.
    assert body["status"] == "active"


@pytest.mark.asyncio
async def test_get_session_404_returns_problem_json(client):
    """GET on an unknown session id returns a 404 RFC 7807 problem+json.

    Locks the four core RFC 7807 members (``type``, ``title``, ``status``,
    ``detail``) plus the ``application/problem+json`` media type. A
    regression here means API consumers can no longer rely on a stable
    error envelope.
    """
    response = await client.get(f"/api/v1/sessions/{UNKNOWN_SESSION_ID}")

    assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
    assert PROBLEM_MEDIA_TYPE in response.headers["content-type"], (
        f"Expected content-type to contain {PROBLEM_MEDIA_TYPE!r}, got {response.headers.get('content-type')!r}"
    )

    body = response.json()
    assert body.get("status") == 404, f"Missing/wrong status field: {body}"
    assert body.get("title") == "Not Found", f"Missing/wrong title field: {body}"
    assert "type" in body, f"Missing type field: {body}"
    # detail carries the per-occurrence message from NotFoundError.
    assert "detail" in body and body["detail"], f"Missing detail field: {body}"


# ---------------------------------------------------------------------------
# Bulk cleanup endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bulk_cleanup_with_all_expired_flag(client, db_session):
    """POST /api/v1/sessions/cleanup with ``all_expired=true`` returns 200.

    With no live backend, the service's ``bulk_cleanup(all_expired=True)``
    path runs but the actual ``backend.cleanup_sessions`` call is never
    made (backend is ``None`` and the empty ``session_ids`` list short-
    circuits). The response shape is the contract we lock: ``cleaned``,
    ``failed``, and ``details`` — all non-negative ints / dict.
    """
    response = await client.post(
        "/api/v1/sessions/cleanup",
        json={"all_expired": True},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    for key in ("cleaned", "failed", "details"):
        assert key in body, f"CleanupResponse missing {key!r}: {body}"
    assert isinstance(body["cleaned"], int) and body["cleaned"] >= 0
    assert isinstance(body["failed"], int) and body["failed"] >= 0
    assert isinstance(body["details"], dict)


@pytest.mark.asyncio
async def test_bulk_cleanup_validates_required_field(client):
    """POST with neither ``execution_id`` nor ``all_expired`` set is rejected.

    ``CleanupRequest`` exposes both fields as optional with defaults
    (``None`` / ``False``), so the empty body ``{}`` passes Pydantic
    schema validation and reaches ``SessionService.bulk_cleanup``. The
    service then raises ``ServiceError("Provide execution_id or set
    all_expired=true")`` which the controller maps to a 400 — service-
    level validation of the required field, not schema-level (which
    would be 422). The 400 status and the descriptive detail are the
    contract we lock here.
    """
    response = await client.post("/api/v1/sessions/cleanup", json={})

    assert response.status_code == 400, (
        f"Expected 400 for empty filter payload, got {response.status_code}: {response.text}"
    )
    body = response.json()
    # FastAPI's HTTPException default envelope is ``{"detail": ...}``;
    # the session controller does not rewrap as RFC 7807, so the
    # assertion is on the legacy shape.
    assert "detail" in body, f"Missing detail field: {body}"
    assert "execution_id" in body["detail"] or "all_expired" in body["detail"], (
        f"detail should mention the required field, got: {body}"
    )
