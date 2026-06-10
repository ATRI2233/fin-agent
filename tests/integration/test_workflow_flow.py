"""Integration tests for workflow API flow (Phase 3 - Wave 2 pilot, task 2.5).

These tests lock the public HTTP contract of the migrated workflows
controller (Wave 2 task 2.2). After the pilot migration the routes live
on ``main.framework.controllers.workflows`` (thin handlers) and delegate
to ``WorkflowQueryService`` instead of the inline business logic that
previously lived in ``api/workflows.py``.

Endpoint contract locked:
  POST   /api/v1/workflows               -> 201 WorkflowResponse (full detail)
  GET    /api/v1/workflows               -> 200 list[WorkflowSummary]
                                           (skip/limit query params, newest first)
  GET    /api/v1/workflows/stats         -> 200 WorkflowStats
                                           (running, completed, failed, successRate)
  GET    /api/v1/workflows/{id}          -> 200 WorkflowResponse
  PUT    /api/v1/workflows/{id}          -> 200 WorkflowResponse
  DELETE /api/v1/workflows/{id}          -> 204
  POST   /api/v1/workflows/{id}/trigger  -> 202 {"execution_id": "..."}
                                           (moved from api/triggers.py)

Error contract (RFC 7807 - Wave 1 task 1.6):
  All 4xx/5xx responses return ``application/problem+json`` with the
  standard ProblemDetail fields (type, title, status, detail, instance).
  The global exception handlers in ``main.py`` convert ``HTTPException``,
  ``NotFoundError``, ``ServiceError``, and ``RequestValidationError`` to
  the envelope. This file locks the 404 path on both the workflow lookup
  and the trigger endpoint.

Notes:
  - Uses ``client`` fixture from ``tests/conftest.py`` (per-test in-memory
    SQLite DB reset between tests; no cross-test contamination).
  - ASGITransport does NOT trigger FastAPI lifespan events, so the global
    scheduler stays None. The trigger endpoint's background task may hang
    on a real OpenCode backend; we assert only the router match + RFC 7807
    envelope for the 404 case, not actual execution.
"""

from __future__ import annotations

import pytest

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# UUID that is syntactically valid but guaranteed not to exist in the
# per-test in-memory SQLite database. Using a real UUIDv4-shaped string
# also proves the workflows endpoint parses the path as a string, not as
# an int (which would 422 instead of 404).
NONEXISTENT_WORKFLOW_ID = "00000000-0000-0000-0000-000000000000"

# Standard RFC 7807 media type. RFC 7807 section 3 says clients and
# servers SHOULD use this exact value when the body is a problem document.
PROBLEM_MEDIA_TYPE = "application/problem+json"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _simple_workflow(name: str = "Test Workflow") -> dict:
    """Build a minimal valid workflow with 2 sequential agent nodes."""
    return {
        "name": name,
        "description": "Integration test workflow",
        "nodes": [
            {
                "id": "n1",
                "type": "agent",
                "agent": "macro-scout",
                "prompt": "查看大盘",
            },
            {
                "id": "n2",
                "type": "agent",
                "agent": "technical-chartist",
                "prompt": "分析上证指数",
            },
        ],
        "edges": [{"source": "n1", "target": "n2"}],
    }


def _parallel_workflow(name: str = "Parallel Test") -> dict:
    """Build a workflow with 2 parallel branches from a single root."""
    return {
        "name": name,
        "description": "Workflow with parallel branches",
        "nodes": [
            {"id": "root", "type": "agent", "agent": "macro-scout", "prompt": "init"},
            {"id": "p1", "type": "agent", "agent": "sentiment-decoder", "prompt": "a"},
            {"id": "p2", "type": "agent", "agent": "sector-rotator", "prompt": "b"},
        ],
        "edges": [
            {"source": "root", "target": "p1"},
            {"source": "root", "target": "p2"},
        ],
    }


# ---------------------------------------------------------------------------
# Happy-path tests (preserved from the pre-migration file; assertions
# updated to match the new WorkflowQueryService response shape).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_workflow(client):
    """Locks POST /api/v1/workflows happy path: 201 + body has id+name+nodes+edges+status.

    The new ``controllers/workflows.py`` delegates to
    ``WorkflowQueryService.create_workflow``; body shape must remain
    compatible with the pre-migration API contract (id, name, description,
    nodes, edges, trigger_type, config, status, created_at, updated_at).
    A regression in any of these fields breaks every client that builds
    a workflow detail view.
    """
    payload = _simple_workflow(name="Create Test")
    response = await client.post("/api/v1/workflows", json=payload)

    assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
    data = response.json()
    assert "id" in data, f"Response missing 'id': {data}"
    assert data["name"] == "Create Test"
    assert len(data["nodes"]) == 2
    assert len(data["edges"]) == 1
    assert data["status"] == "draft"


@pytest.mark.asyncio
async def test_get_workflow_by_id(client):
    """Locks GET /api/v1/workflows/{id} for an existing workflow: 200 + full body.

    The new ``controllers/workflows.py`` delegates to
    ``WorkflowQueryService.get_workflow``; body must include id+name+nodes
    (same shape as the create response, minus the auto-generated fields).
    """
    create_resp = await client.post(
        "/api/v1/workflows",
        json=_simple_workflow(name="Get By ID Test"),
    )
    assert create_resp.status_code == 201
    workflow_id = create_resp.json()["id"]

    response = await client.get(f"/api/v1/workflows/{workflow_id}")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["id"] == workflow_id
    assert data["name"] == "Get By ID Test"
    assert len(data["nodes"]) == 2


@pytest.mark.asyncio
async def test_create_parallel_workflow(client):
    """Locks DAG validation: parallel branches from a single root are accepted (201).

    Validates that the create path accepts multi-target edges (a single
    source pointing to multiple parallel targets) - the most common DAG
    shape after a linear chain. Ensures ``validate_dag`` does not reject
    valid parallel topologies as 'duplicate source edges'.
    """
    payload = _parallel_workflow(name="Parallel DAG Test")
    response = await client.post("/api/v1/workflows", json=payload)

    assert response.status_code == 201, response.text
    data = response.json()
    assert len(data["nodes"]) == 3
    assert len(data["edges"]) == 2
    sources = [e["source"] for e in data["edges"]]
    targets = [e["target"] for e in data["edges"]]
    # Both branches originate from "root" - confirms parallel topology
    assert sources.count("root") == 2
    assert "p1" in targets and "p2" in targets


# ---------------------------------------------------------------------------
# New tests added in Wave 2 task 2.5 to lock the new endpoint shapes
# and the RFC 7807 error envelope on the workflows controller.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_workflows_returns_paginated_dict(client):
    """Locks GET /api/v1/workflows contract: created workflow is discoverable in the response.

    The new ``WorkflowQueryService.list_workflows`` returns a list of
    summary items (id, name, status, node_count, created_at) - the
    endpoint accepts ``skip`` and ``limit`` query parameters for
    pagination. The current implementation returns a bare list; a
    future paginated-dict shape (``{"items": [...], "total": N, ...}``)
    would also be accepted by this test as long as the created workflow
    remains discoverable. This is the regression guard for the list
    endpoint's response shape.
    """
    create_resp = await client.post(
        "/api/v1/workflows",
        json=_simple_workflow(name="List Test"),
    )
    assert create_resp.status_code == 201
    created_id = create_resp.json()["id"]

    response = await client.get("/api/v1/workflows")
    assert response.status_code == 200, response.text
    data = response.json()

    # Accept either a paginated dict (future shape) or a bare list
    # (current shape). The contract is that the created workflow is
    # discoverable in the response regardless of envelope.
    if isinstance(data, dict):
        items = data.get("items", data.get("workflows", []))
    else:
        items = data
    assert isinstance(items, list), f"Expected list of summary items, got {type(items).__name__}: {data}"

    ids = [w["id"] for w in items]
    assert created_id in ids, f"Created workflow {created_id} not in list response: {ids}"

    # Each summary item must have the shape from
    # ``WorkflowQueryService._to_list_item``: id, name, status, node_count, created_at.
    item = next(w for w in items if w["id"] == created_id)
    assert "id" in item
    assert "name" in item
    assert "node_count" in item
    assert item["node_count"] == 2


@pytest.mark.asyncio
async def test_get_workflow_stats_returns_counts(client):
    """Locks GET /api/v1/workflows/stats response shape: dict with execution counts.

    The new ``WorkflowQueryService.get_workflow_stats`` returns a dict
    with keys ``running``, ``completed``, ``failed``, and
    ``successRate`` (the success rate of terminal executions as a
    percentage, or ``None`` when there are no terminal runs). With 2
    created workflows but no executions (we only POSTed, did not
    trigger), the counts must all be 0 and ``successRate`` must be
    ``None``. This is the regression guard for the stats endpoint's
    shape and zero-state semantics.
    """
    await client.post(
        "/api/v1/workflows",
        json=_simple_workflow(name="Stats Test 1"),
    )
    await client.post(
        "/api/v1/workflows",
        json=_simple_workflow(name="Stats Test 2"),
    )

    response = await client.get("/api/v1/workflows/stats")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict), f"Expected stats dict, got {type(data).__name__}: {data}"

    # Required keys per WorkflowQueryService.get_workflow_stats docstring.
    for key in ("running", "completed", "failed", "successRate"):
        assert key in data, f"Missing required key {key!r}: {data}"

    # No executions yet - we only created workflows, did not trigger them.
    # All counts must be 0 and successRate must be None (no terminal runs).
    assert data["running"] == 0, f"Expected running=0, got {data['running']}"
    assert data["completed"] == 0, f"Expected completed=0, got {data['completed']}"
    assert data["failed"] == 0, f"Expected failed=0, got {data['failed']}"
    assert data["successRate"] is None, f"Expected successRate=None (no terminal runs), got {data['successRate']!r}"


@pytest.mark.asyncio
async def test_get_workflow_404_returns_problem_json(client):
    """Locks RFC 7807 contract on GET /api/v1/workflows/{id} 404 path.

    When the workflow does not exist, ``WorkflowQueryService.get_workflow``
    raises ``NotFoundError``, which the global handler in ``main.py``
    maps to a 404 ``application/problem+json`` envelope. This test
    locks the content-type media type and the standard ProblemDetail
    fields (type, title, status, detail) for the 404 case on this
    specific endpoint - a regression in the handler or the media type
    breaks every client that relies on a stable error envelope.
    """
    response = await client.get(f"/api/v1/workflows/{NONEXISTENT_WORKFLOW_ID}")

    assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"

    # Media type MUST be application/problem+json (RFC 7807 section 3).
    content_type = response.headers.get("content-type", "")
    assert PROBLEM_MEDIA_TYPE in content_type, (
        f"Expected content-type to contain {PROBLEM_MEDIA_TYPE!r}, got {content_type!r}"
    )

    body = response.json()
    # Lock the four RFC 7807 members a 404 response must expose.
    assert body.get("status") == 404, f"Missing/wrong status field: {body}"
    assert body.get("title") == "Not Found", f"Missing/wrong title field: {body}"
    assert "type" in body, f"Missing type field: {body}"
    assert "detail" in body and body["detail"], f"Missing detail field: {body}"


# ---------------------------------------------------------------------------
# Trigger endpoint - preserved smoke test, updated for the new controller
# location (moved from api/triggers.py to controllers/workflows.py) and
# the RFC 7807 error contract on the 404 path.
#
# NOTE: trigger_workflow_best_effort test was removed because triggers.py
# opened its own SessionLocal() bound to the real DB engine, bypassing
# the FastAPI dependency-injected session used by the test client. The
# workflow created via the API lives in the in-memory test DB; the
# trigger endpoint queries a different DB and returned 404. After the
# Wave 2 pilot the trigger is mounted on the same controller (and uses
# the same dependency-injected session), so the architectural mismatch
# is gone - but the test still uses a non-existent workflow id to avoid
# needing a real OpenCode backend.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_trigger_endpoint_exists(client):
    """Locks that POST /api/v1/workflows/{id}/trigger is wired on the new controller.

    In the new architecture (Wave 2 task 2.2) the trigger handler moved
    from ``api/triggers.py`` to ``controllers/workflows.py`` (it is a
    workflow-management concern, not an execution-status concern) - the
    URL must still resolve. With a non-existent workflow id the
    ``WorkflowQueryService.trigger_workflow`` raises ``NotFoundError``,
    which the global RFC 7807 handler in ``main.py`` maps to a 404
    ``application/problem+json`` envelope. The test asserts:

      - The router matched (not 307 redirect or 405 method-not-allowed).
      - When the workflow does not exist, the response is the RFC 7807
        envelope (content-type + standard fields).

    It does NOT assert that actual execution succeeds - that requires a
    real OpenCode backend which the test environment does not provide.
    """
    response = await client.post(
        f"/api/v1/workflows/{NONEXISTENT_WORKFLOW_ID}/trigger",
        json={"params": {}},
    )

    # Router must have matched. Acceptable responses for a non-existent
    # workflow id: 404 (NotFoundError -> RFC 7807 envelope) or 202 (if a
    # future migration makes trigger lazy / background-only).
    assert response.status_code in (404, 202), f"Unexpected status {response.status_code}: {response.text}"

    # Lock the RFC 7807 content-type contract for the 404 case.
    if response.status_code == 404:
        content_type = response.headers.get("content-type", "")
        assert PROBLEM_MEDIA_TYPE in content_type, (
            f"Expected content-type to contain {PROBLEM_MEDIA_TYPE!r}, got {content_type!r}"
        )
        body = response.json()
        assert body.get("status") == 404
        assert body.get("title") == "Not Found"
        assert "detail" in body
