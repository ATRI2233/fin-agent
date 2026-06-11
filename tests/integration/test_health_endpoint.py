"""Integration tests for the /api/v1/health endpoint.

Locks the contract of the public health check route declared in
``main/framework/main.py``. The endpoint is intentionally unauthenticated
so external monitors, load balancers, and uptime probes can hit it
without an API key.

Endpoint under test (from main/framework/main.py):
    GET /api/v1/health -> 200 {"status": "ok", "timestamp": "<iso8601>"}

Notes:
- Uses the ``client`` fixture from tests/conftest.py, which wires the
  FastAPI app to an in-memory SQLite session and provides an
  ``httpx.AsyncClient`` with base_url ``http://test``.
- The health handler does not read or write the database, so the
  ``db_session`` fixture is intentionally NOT requested here.
"""

from __future__ import annotations

import re

import pytest


# ---------------------------------------------------------------------------
# Endpoint: GET /api/v1/health
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_health_returns_200(client):
    """GET /api/v1/health responds 200 with a JSON body.

    Baseline assertion: HTTP 200 + ``Content-Type: application/json``.
    """
    response = await client.get("/api/v1/health")
    assert response.status_code == 200, f"Expected 200 from /api/v1/health, got {response.status_code}: {response.text}"
    content_type = response.headers.get("content-type", "")
    assert "application/json" in content_type.lower(), f"Expected JSON content-type, got '{content_type}'"
    print(f"Health responded 200 with content-type={content_type}")


@pytest.mark.asyncio
async def test_health_body_has_expected_keys(client):
    """GET /api/v1/health body contains ``status`` and ``timestamp`` fields.

    Baseline assertion: the body is a JSON object whose ``status`` is the
    literal string ``"ok"`` and whose ``timestamp`` is an ISO-8601 string
    parseable by ``datetime.fromisoformat``.
    """
    response = await client.get("/api/v1/health")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    data = response.json()
    assert isinstance(data, dict), f"Expected JSON object body, got {type(data).__name__}: {data}"

    # Required keys
    assert "status" in data, f"Response missing 'status' field: {data}"
    assert "timestamp" in data, f"Response missing 'timestamp' field: {data}"

    # status must be the literal "ok" — the contract used by uptime probes
    assert data["status"] == "ok", f"Expected status='ok', got {data['status']!r}"

    # timestamp must be an ISO-8601 string (datetime.fromisoformat handles
    # both the naive "Z" and the "+00:00" forms produced by datetime.isoformat)
    ts = data["timestamp"]
    assert isinstance(ts, str) and len(ts) > 0, f"timestamp must be a non-empty string, got {ts!r}"
    assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", ts), f"timestamp is not ISO-8601: {ts!r}"
    print(f"Health body OK: status={data['status']}, timestamp={ts}")


@pytest.mark.asyncio
async def test_health_no_auth_required(client):
    """GET /api/v1/health must succeed without any authentication header.

    The endpoint is the public health check used by load balancers and
    external monitors, so it must NOT require an API key or any other
    credential. We send a request with NO ``X-API-Key`` (or any auth)
    header and assert that it still returns 200.
    """
    # Explicitly clear any default headers and send NO auth at all.
    no_auth_client = client
    no_auth_client.headers.clear()

    response = await no_auth_client.get("/api/v1/health")
    assert response.status_code == 200, (
        f"Health endpoint should be public, got {response.status_code} without auth: {response.text}"
    )
    # If auth were required, the typical failure mode is 401 or 403 —
    # make that failure mode explicit so a regression surfaces clearly.
    assert response.status_code not in (401, 403), (
        f"Health endpoint unexpectedly required auth: {response.status_code} {response.text}"
    )
    print("Health endpoint is public: 200 without any auth header")
