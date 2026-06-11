"""Integration tests for triggers (execution status/result) HTTP API (Phase 3 - Wave 3).

These tests lock the public HTTP contract of the migrated triggers
controller. The routes live on ``main.framework.controllers.triggers``
(thin handlers) and delegate to ``ExecutionRepository`` for all reads.

Endpoint contract locked (Wave 3 task 3.x):

  GET    /api/v1/executions/{id}/status  -> 200 ExecutionStatusResponse
                                           (execution_id, workflow_id, status, nodes[])
  GET    /api/v1/executions/{id}/result  -> 200 ExecutionResultResponse
                                           (execution_id, workflow_id, status, results)
                                           400 if execution not yet completed

Error contract (RFC 7807 - Wave 1 task 1.6):
  All 4xx responses return ``application/problem+json`` with the
  standard ProblemDetail fields (type, title, status, detail, instance).
  This file locks the 404 path on both endpoints for an unknown id.

Notes:
  - Uses ``client`` and ``db_session`` fixtures from ``tests/conftest.py``
    (per-test in-memory SQLite DB reset between tests; no cross-test
    contamination).
  - The real trigger endpoint (``POST /api/v1/workflows/{id}/trigger``)
    now lives on the workflows controller (Wave 2 pilot). We use that
    real endpoint to mint a fresh ``execution_id`` for the happy-path
    status test, then update the row directly via ``db_session`` to
    simulate a completed run for the result test (the actual async
    runner requires a real workflow engine / OpenCode backend, which
    ASGITransport does not provide).
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# UUID that is syntactically valid but guaranteed not to exist in the
# per-test in-memory SQLite database. A real UUIDv4-shaped string also
# proves the endpoint parses the path as a string, not as an int.
UNKNOWN_EXECUTION_ID = "00000000-0000-0000-0000-000000000000"

# Standard RFC 7807 media type. RFC 7807 section 3 says clients and
# servers SHOULD use this exact value when the body is a problem document.
PROBLEM_MEDIA_TYPE = "application/problem+json"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _simple_workflow(name: str = "Triggers Test Workflow") -> dict:
    """Build a minimal valid workflow with 2 sequential agent nodes."""
    return {
        "name": name,
        "description": "Workflow used to mint an execution_id for triggers tests",
        "nodes": [
            {"id": "n1", "type": "agent", "agent": "macro-scout", "prompt": "查看大盘"},
            {"id": "n2", "type": "agent", "agent": "technical-chartist", "prompt": "分析上证指数"},
        ],
        "edges": [{"source": "n1", "target": "n2"}],
    }


async def _create_workflow_and_trigger(client) -> tuple[str, str]:
    """Create a workflow via the API and trigger it; return (workflow_id, execution_id).

    The trigger endpoint synchronously creates a ``WorkflowExecution`` row
    in status ``pending`` and returns the new ``execution_id`` (HTTP 202).
    Any background runner that the trigger schedules will fail silently in
    the ASGITransport test environment (no real OpenCode backend), so we
    rely on the synchronous response for the execution_id.
    """
    create_resp = await client.post("/api/v1/workflows", json=_simple_workflow())
    assert create_resp.status_code == 201, f"Workflow create failed: {create_resp.text}"
    workflow_id = create_resp.json()["id"]

    trigger_resp = await client.post(
        f"/api/v1/workflows/{workflow_id}/trigger",
        json={"params": {}},
    )
    assert trigger_resp.status_code == 202, f"Trigger failed: {trigger_resp.text}"
    execution_id = trigger_resp.json()["execution_id"]
    assert isinstance(execution_id, str) and execution_id
    return workflow_id, execution_id


def _mark_execution_completed(
    db_session,
    *,
    execution_id: str,
    workflow_id: str,
    node_outputs: dict[str, dict] | None = None,
) -> None:
    """Flip the freshly-triggered execution to ``completed`` with node outputs.

    The trigger endpoint leaves the execution in ``pending``. The result
    endpoint requires ``completed`` or ``failed`` status, and the status
    endpoint works for any status but is more interesting with real node
    data, so we seed completed nodes alongside the status flip.
    """
    from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution

    node_outputs = node_outputs or {
        "n1": {"summary": "macro outlook is neutral"},
        "n2": {"signal": "buy", "confidence": 0.72},
    }

    execution = db_session.get(WorkflowExecution, execution_id)
    assert execution is not None, f"Execution {execution_id} not found in db_session"
    execution.status = "completed"
    execution.completed_at = datetime.now(UTC)

    # Drop any nodes the background runner may have inserted (it might
    # have raced ahead and added a node in the "pending" state) and seed
    # our own completed nodes with realistic output.
    db_session.query(ExecutionNode).filter(ExecutionNode.execution_id == execution_id).delete()
    for node_id, output in node_outputs.items():
        db_session.add(
            ExecutionNode(
                id=f"en-{execution_id}-{node_id}",
                execution_id=execution_id,
                node_id=node_id,
                agent="macro-scout" if node_id == "n1" else "technical-chartist",
                status="completed",
                input={"params": {}},
                output=output,
                session_id=f"sess-{execution_id}-{node_id}",
                retry_count=0,
                started_at=datetime.now(UTC),
                completed_at=datetime.now(UTC),
            )
        )
    db_session.commit()


# ---------------------------------------------------------------------------
# Status endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_execution_status_returns_status(client, db_session):
    """GET /api/v1/executions/{id}/status returns the execution status envelope.

    Locks the ``ExecutionStatusResponse`` shape from the migrated
    controller: ``execution_id``, ``workflow_id``, ``status``, ``nodes``
    (list). After triggering, we mark the execution completed with two
    nodes so the assertion covers a realistic shape (not just an empty
    nodes list from the freshly-pending state). A regression in any of
    these fields breaks every client that polls the status endpoint.
    """
    workflow_id, execution_id = await _create_workflow_and_trigger(client)
    _mark_execution_completed(db_session, execution_id=execution_id, workflow_id=workflow_id)

    response = await client.get(f"/api/v1/executions/{execution_id}/status")

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    body = response.json()

    # ExecutionStatusResponse envelope.
    for key in ("execution_id", "workflow_id", "status", "nodes"):
        assert key in body, f"ExecutionStatusResponse missing {key!r}: {body}"
    assert body["execution_id"] == execution_id
    assert body["workflow_id"] == workflow_id
    assert body["status"] == "completed"

    # nodes[] must reflect the two seeded rows with NodeStatus shape.
    assert isinstance(body["nodes"], list)
    assert len(body["nodes"]) == 2
    node_ids = [n["node_id"] for n in body["nodes"]]
    assert "n1" in node_ids and "n2" in node_ids
    for node in body["nodes"]:
        for key in ("node_id", "agent", "status", "output", "error"):
            assert key in node, f"NodeStatus missing {key!r}: {node}"


@pytest.mark.asyncio
async def test_get_status_404_returns_problem_json(client):
    """GET status for an unknown execution id returns a 404 RFC 7807 envelope.

    The controller raises ``HTTPException(404, "Execution not found")``,
    which the global RFC 7807 handler in ``main.py`` converts to
    ``application/problem+json`` with the standard fields. Locks the
    media type and the four core fields.
    """
    response = await client.get(f"/api/v1/executions/{UNKNOWN_EXECUTION_ID}/status")

    assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
    assert PROBLEM_MEDIA_TYPE in response.headers.get("content-type", ""), (
        f"Expected content-type to contain {PROBLEM_MEDIA_TYPE!r}, got {response.headers.get('content-type')!r}"
    )

    body = response.json()
    assert body.get("status") == 404, f"Missing/wrong status field: {body}"
    assert body.get("title") == "Not Found", f"Missing/wrong title field: {body}"
    assert "type" in body, f"Missing type field: {body}"
    assert "detail" in body and body["detail"], f"Missing detail field: {body}"


# ---------------------------------------------------------------------------
# Result endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_execution_result_returns_result(client, db_session):
    """GET /api/v1/executions/{id}/result returns the result envelope once completed.

    Locks the ``ExecutionResultResponse`` shape from the migrated
    controller: ``execution_id``, ``workflow_id``, ``status``, ``results``
    (dict keyed by ``node_id``). The controller refuses to return a
    result for a not-yet-completed execution (400), so we mark the row
    completed with two nodes' outputs before calling the endpoint.
    """
    workflow_id, execution_id = await _create_workflow_and_trigger(client)
    _mark_execution_completed(
        db_session,
        execution_id=execution_id,
        workflow_id=workflow_id,
        node_outputs={
            "n1": {"summary": "macro outlook is neutral"},
            "n2": {"signal": "buy", "confidence": 0.72},
        },
    )

    response = await client.get(f"/api/v1/executions/{execution_id}/result")

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    body = response.json()

    # ExecutionResultResponse envelope.
    for key in ("execution_id", "workflow_id", "status", "results"):
        assert key in body, f"ExecutionResultResponse missing {key!r}: {body}"
    assert body["execution_id"] == execution_id
    assert body["workflow_id"] == workflow_id
    assert body["status"] == "completed"

    # results is a dict keyed by node_id with the seeded outputs.
    assert isinstance(body["results"], dict)
    assert "n1" in body["results"] and "n2" in body["results"]
    assert body["results"]["n1"]["summary"] == "macro outlook is neutral"
    assert body["results"]["n2"]["signal"] == "buy"


@pytest.mark.asyncio
async def test_get_result_404_returns_problem_json(client):
    """GET result for an unknown execution id returns a 404 RFC 7807 envelope.

    Mirror of the status 404 case: the result controller's first guard
    is the same ``ExecutionRepository.get_execution`` lookup, so a
    missing id also surfaces as a 404 problem+json envelope.
    """
    response = await client.get(f"/api/v1/executions/{UNKNOWN_EXECUTION_ID}/result")

    assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
    assert PROBLEM_MEDIA_TYPE in response.headers.get("content-type", ""), (
        f"Expected content-type to contain {PROBLEM_MEDIA_TYPE!r}, got {response.headers.get('content-type')!r}"
    )

    body = response.json()
    assert body.get("status") == 404, f"Missing/wrong status field: {body}"
    assert body.get("title") == "Not Found", f"Missing/wrong title field: {body}"
    assert "type" in body, f"Missing type field: {body}"
    assert "detail" in body and body["detail"], f"Missing detail field: {body}"
