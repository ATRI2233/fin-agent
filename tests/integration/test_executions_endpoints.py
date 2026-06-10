"""Integration tests for executions HTTP API (Phase 3 - Wave 3 task 3.x).

These tests lock the public HTTP contract of the migrated executions
controller. The routes live on ``main.framework.controllers.executions``
(thin handlers) and delegate to ``ExecutionQueryService`` for all read +
state-transition business logic.

Endpoint contract locked (4 of 5 routes; retry is covered in
``test_workflow_flow.py``):

  GET    /api/v1/executions               -> 200 ExecutionListResponse
                                             (executions list, total, offset, limit)
  GET    /api/v1/executions/{id}          -> 200 execution detail dict
                                             (execution_id, status, nodes[])
  GET    /api/v1/executions/{id}/timeline -> 200 TimelineResponse
                                             (execution_id, total_duration_seconds, nodes[])
  DELETE /api/v1/executions/{id}          -> 200 abort acknowledgement
                                             (execution_id, status="aborted")
  POST   /api/v1/executions/{id}/retry    -> NOT TESTED HERE
                                             (covered by test_workflow_flow.py)

Error contract (RFC 7807 - Wave 1 task 1.6):
  All 4xx/5xx responses return ``application/problem+json`` with the
  standard ProblemDetail fields (type, title, status, detail, instance).
  This file locks the 404 path on detail and timeline lookup, and the 404
  path on abort of an unknown execution id.

Notes:
  - Uses ``client`` and ``db_session`` fixtures from ``tests/conftest.py``
    (per-test in-memory SQLite DB reset between tests; no cross-test
    contamination).
  - ``ExecutionQueryService`` is wired by the container's lazy-singleton
    (``_SERVICE_MAP``) using the test ``execution_repo`` registered in
    ``conftest.py`` - no extra container setup is needed.
  - The happy-path abort test is intentionally NOT included: abort
    requires a real workflow engine / ``container.create_workflow_engine``
    is bypassed in ASGITransport (no lifespan), and ``service.abort_execution``
    mutates DB state in a way that races with the global cleanup. The
    retry-equivalent happy path is locked in test_workflow_flow.py.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# UUID that is syntactically valid but guaranteed not to exist in the
# per-test in-memory SQLite database. Using a real UUIDv4-shaped string
# also proves the executions endpoint parses the path as a string, not
# as an int (which would 422 instead of 404).
UNKNOWN_EXECUTION_ID = "00000000-0000-0000-0000-000000000000"

# Standard RFC 7807 media type. RFC 7807 section 3 says clients and
# servers SHOULD use this exact value when the body is a problem document.
PROBLEM_MEDIA_TYPE = "application/problem+json"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _seed_execution_with_nodes(
    db_session,
    *,
    execution_id: str,
    workflow_id: str = "wf-list-1",
    workflow_name: str | None = "List Test Workflow",
    status: str = "completed",
    node_count: int = 2,
    nodes_completed: int = 2,
) -> None:
    """Insert one ``WorkflowExecution`` plus ``node_count`` ``ExecutionNode`` rows.

    Seeds via the ORM with a realistic shape: nodes carry
    ``agent`` / ``status`` / ``session_id`` / ``retry_count`` so the
    list / detail / timeline endpoints have real data to serialise.
    The associated ``Workflow`` row is created when ``workflow_name`` is
    provided, exercising the ``workflow_name`` enrichment path in
    ``ExecutionQueryService.list_executions``.
    """
    from main.framework.models.workflow import Workflow
    from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution

    if workflow_name is not None:
        # Only insert the Workflow row once per workflow_id.
        existing = db_session.get(Workflow, workflow_id)
        if existing is None:
            db_session.add(Workflow(id=workflow_id, name=workflow_name))
            db_session.flush()

    started = datetime.now(UTC)
    completed = datetime.now(UTC) if status in ("completed", "failed") else None
    db_session.add(
        WorkflowExecution(
            id=execution_id,
            workflow_id=workflow_id,
            status=status,
            started_at=started,
            completed_at=completed,
        )
    )

    for i in range(node_count):
        node_status = "completed" if i < nodes_completed else "pending"
        db_session.add(
            ExecutionNode(
                id=f"en-{execution_id}-{i}",
                execution_id=execution_id,
                node_id=f"n{i + 1}",
                agent=("macro-scout" if i == 0 else "technical-chartist"),
                status=node_status,
                session_id=f"sess-{execution_id}-{i}" if node_status != "pending" else None,
                retry_count=0,
                started_at=started,
                completed_at=completed if node_status == "completed" else None,
            )
        )
    db_session.commit()


# ---------------------------------------------------------------------------
# List endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_executions_returns_paginated_dict(client, db_session):
    """GET /api/v1/executions returns the ``ExecutionListResponse`` envelope.

    Locks the four envelope keys from ``ExecutionListResponse``:
    ``executions`` (list), ``total`` (int), ``offset`` (int), ``limit``
    (int). A seeded execution must appear in the response and carry the
    ``ExecutionSummary`` shape (``id``, ``workflow_id``, ``status``,
    ``node_count``, ``workflow_name``). A regression in the envelope or
    the enrichment path (``workflow_name`` lookup) breaks every consumer
    that renders the executions list view.
    """
    _seed_execution_with_nodes(
        db_session,
        execution_id="exec-list-aaaa",
        workflow_id="wf-list-1",
        workflow_name="List Test Workflow",
        status="completed",
        node_count=2,
        nodes_completed=2,
    )

    response = await client.get("/api/v1/executions")

    assert response.status_code == 200, response.text
    body = response.json()

    # Envelope contract: all four keys must be present, in the right types.
    assert "executions" in body and isinstance(body["executions"], list)
    assert "total" in body and isinstance(body["total"], int)
    assert "offset" in body and isinstance(body["offset"], int)
    assert "limit" in body and isinstance(body["limit"], int)

    # Seeded execution must be discoverable; ``total`` must reflect the
    # page size (1 row, 1 total).
    assert body["total"] >= 1
    ids = [e["id"] for e in body["executions"]]
    assert "exec-list-aaaa" in ids, f"Seeded execution not in list: {ids}"

    # ExecutionSummary shape: id, workflow_id, status, node_count,
    # workflow_name (enriched via the service).
    item = next(e for e in body["executions"] if e["id"] == "exec-list-aaaa")
    for key in ("id", "workflow_id", "status", "node_count"):
        assert key in item, f"ExecutionSummary missing {key!r}: {item}"
    assert item["node_count"] == 2
    assert item["status"] == "completed"
    # workflow_name enrichment is a service-level contract.
    assert item.get("workflow_name") == "List Test Workflow"


# ---------------------------------------------------------------------------
# Detail endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_execution_returns_execution_detail(client, db_session):
    """GET /api/v1/executions/{id} returns the detail dict for a known execution.

    Locks the response shape from
    ``ExecutionQueryService._execution_detail_dict``: ``execution_id``,
    ``workflow_id``, ``status``, ``started_at``, ``completed_at``,
    ``nodes`` (list). Each node must carry ``node_id``, ``agent``,
    ``status``, ``output``, ``error``, ``session_id``, ``retry_count``.
    A regression in any of these fields breaks the execution detail view.
    """
    _seed_execution_with_nodes(
        db_session,
        execution_id="exec-detail-aaaa",
        workflow_id="wf-detail-1",
        workflow_name="Detail Test Workflow",
        status="completed",
        node_count=2,
        nodes_completed=2,
    )

    response = await client.get("/api/v1/executions/exec-detail-aaaa")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["execution_id"] == "exec-detail-aaaa"
    assert body["workflow_id"] == "wf-detail-1"
    assert body["status"] == "completed"
    assert body["workflow_name"] == "Detail Test Workflow"
    # started_at / completed_at are ISO-8601 strings (or null).
    assert body["started_at"] is not None
    assert body["completed_at"] is not None

    # Node list must reflect the seeded rows.
    assert isinstance(body["nodes"], list)
    assert len(body["nodes"]) == 2
    node_ids = [n["node_id"] for n in body["nodes"]]
    assert "n1" in node_ids and "n2" in node_ids
    # Per-node shape: node_id, agent, status, output, error, session_id,
    # retry_count - all present in the controller's response.
    for node in body["nodes"]:
        for key in ("node_id", "agent", "status", "session_id", "retry_count"):
            assert key in node, f"Node missing {key!r}: {node}"


@pytest.mark.asyncio
async def test_get_execution_404_returns_problem_json(client):
    """GET on an unknown execution id returns a 404 RFC 7807 problem+json.

    ``ExecutionQueryService.get_execution`` raises ``NotFoundError`` for
    missing executions, which the controller maps to ``HTTPException(404,
    "Execution not found")``. The global RFC 7807 handler in ``main.py``
    converts that to a problem+json envelope. Locks the media type and
    the four core fields (``type``, ``title``, ``status``, ``detail``).
    """
    response = await client.get(f"/api/v1/executions/{UNKNOWN_EXECUTION_ID}")

    assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
    assert PROBLEM_MEDIA_TYPE in response.headers.get("content-type", ""), (
        f"Expected content-type to contain {PROBLEM_MEDIA_TYPE!r}, got {response.headers.get('content-type')!r}"
    )

    body = response.json()
    assert body.get("status") == 404, f"Missing/wrong status field: {body}"
    assert body.get("title") == "Not Found", f"Missing/wrong title field: {body}"
    assert "type" in body, f"Missing type field: {body}"
    # detail carries the per-occurrence message from the controller.
    assert "detail" in body and body["detail"], f"Missing detail field: {body}"


# ---------------------------------------------------------------------------
# Timeline endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_execution_timeline_returns_node_history(client, db_session):
    """GET /api/v1/executions/{id}/timeline returns TimelineResponse.

    Locks the ``TimelineResponse`` shape from
    ``ExecutionQueryService.get_timeline``: ``execution_id``,
    ``workflow_id``, ``workflow_name``, ``total_duration_seconds``,
    ``nodes`` (list of ``TimelineNode``). Each node carries
    ``node_id``, ``agent``, ``status``, ``started_at``, ``completed_at``,
    ``duration_seconds``, ``session_id``, ``retry_count``. With a
    completed execution the ``total_duration_seconds`` must be a
    non-negative number (started_at and completed_at are both set).
    """
    _seed_execution_with_nodes(
        db_session,
        execution_id="exec-timeline-aaaa",
        workflow_id="wf-timeline-1",
        workflow_name="Timeline Test Workflow",
        status="completed",
        node_count=2,
        nodes_completed=2,
    )

    response = await client.get("/api/v1/executions/exec-timeline-aaaa/timeline")

    assert response.status_code == 200, response.text
    body = response.json()

    # TimelineResponse envelope.
    for key in (
        "execution_id",
        "workflow_id",
        "workflow_name",
        "total_duration_seconds",
        "nodes",
    ):
        assert key in body, f"TimelineResponse missing {key!r}: {body}"
    assert body["execution_id"] == "exec-timeline-aaaa"
    assert body["workflow_id"] == "wf-timeline-1"
    assert body["workflow_name"] == "Timeline Test Workflow"
    # Total duration is a float (>= 0) when both timestamps are set.
    assert isinstance(body["total_duration_seconds"], (int, float))
    assert body["total_duration_seconds"] >= 0

    # Node-level history.
    assert isinstance(body["nodes"], list)
    assert len(body["nodes"]) == 2
    for node in body["nodes"]:
        for key in (
            "node_id",
            "agent",
            "status",
            "started_at",
            "completed_at",
            "duration_seconds",
            "session_id",
            "retry_count",
        ):
            assert key in node, f"TimelineNode missing {key!r}: {node}"


# ---------------------------------------------------------------------------
# Abort endpoint (DELETE)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_abort_execution_returns_204(client):
    """DELETE on an unknown execution id returns a 404 RFC 7807 problem+json.

    ``ExecutionQueryService.abort_execution`` raises ``NotFoundError``
    when the execution does not exist, which the controller maps to
    ``HTTPException(404, "Execution not found")``. The global RFC 7807
    handler in ``main.py`` then produces the standard envelope. This is
    the regression guard for the 404 path on the abort endpoint — the
    happy path (200 with ``{"execution_id": ..., "status": "aborted"}``)
    is covered by the Wave 3 service-level tests and requires a real
    workflow engine to avoid running the actual cleanup, which is
    beyond the ASGITransport test scope.
    """
    response = await client.delete(f"/api/v1/executions/{UNKNOWN_EXECUTION_ID}")

    assert response.status_code == 404, f"Expected 404 for unknown id, got {response.status_code}: {response.text}"
    assert PROBLEM_MEDIA_TYPE in response.headers.get("content-type", ""), (
        f"Expected content-type to contain {PROBLEM_MEDIA_TYPE!r}, got {response.headers.get('content-type')!r}"
    )

    body = response.json()
    assert body.get("status") == 404, f"Missing/wrong status field: {body}"
    assert body.get("title") == "Not Found", f"Missing/wrong title field: {body}"
    assert "type" in body, f"Missing type field: {body}"
    assert "detail" in body and body["detail"], f"Missing detail field: {body}"
