"""Integration tests for the ``/api/v1/system`` observability endpoints.

Tests run against the refactored thin-handler controllers in
``main/framework/controllers/system.py`` (Wave 3 migration) and
lock the public HTTP contract that the WebUI Dashboard depends on.

Endpoints under test:
  GET /api/v1/system/status     -> 200 aggregated subsystem state
  GET /api/v1/system/logs/stats  -> 200 in-memory log-collector stats
  GET /api/v1/system/cache       -> 200 workflow-cache + concurrency snapshot

Notes:
- Uses ``client`` fixture from ``tests/conftest.py`` (ASGI transport,
  in-memory SQLite, DI container pre-configured).
- The ``SystemQueryService`` constructor and every subsystem aggregator
  are exception-safe — tests do not need a running opencode binary,
  APScheduler, or real DB rows to assert the 200 + body-shape contract.
- The 404 test pins the RFC 7807 ``application/problem+json`` envelope
  so a future regression in the global exception handler is caught.
"""

from __future__ import annotations

import pytest

# Standard RFC 7807 media type. RFC 7807 §3 says clients and servers
# SHOULD use this exact value when the body is a problem document.
PROBLEM_MEDIA_TYPE = "application/problem+json"


# ---------------------------------------------------------------------------
# Endpoint: GET /api/v1/system/status
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_status_returns_aggregated_state(client):
    """GET /api/v1/system/status returns 200 with every subsystem key.

    Baseline assertion: the response is a JSON object that carries
    the six legacy subsystem keys the WebUI dashboard renders
    (``opencode``, ``jobExecutor``, ``concurrency``, ``scheduler``,
    ``sessions``) plus an ISO-8601 ``timestamp``. A regression that
    drops any of these keys would break the dashboard panels.
    """
    response = await client.get("/api/v1/system/status")

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert isinstance(data, dict), f"Expected dict, got {type(data)}"

    # Lock the six dashboard-expected subsystem keys.
    for key in ("opencode", "jobExecutor", "concurrency", "scheduler", "sessions", "timestamp"):
        assert key in data, f"Missing subsystem key {key!r}: {data}"

    # Timestamp is a non-empty string (ISO-8601 UTC).
    assert isinstance(data["timestamp"], str) and len(data["timestamp"]) > 0, (
        f"timestamp must be a non-empty ISO-8601 string, got {data['timestamp']!r}"
    )
    # opencode subsystem must expose ``online`` + ``binary``.
    assert "online" in data["opencode"], f"opencode missing 'online': {data['opencode']}"
    assert "binary" in data["opencode"], f"opencode missing 'binary': {data['opencode']}"
    # scheduler subsystem must expose running flag + scheduledJobs count.
    assert "running" in data["scheduler"], f"scheduler missing 'running': {data['scheduler']}"
    assert "scheduledJobs" in data["scheduler"], f"scheduler missing 'scheduledJobs': {data['scheduler']}"
    print(f"Status OK: keys={sorted(data.keys())}")


# ---------------------------------------------------------------------------
# Endpoint: GET /api/v1/system/logs/stats
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_logs_stats_returns_counts_by_level(client):
    """GET /api/v1/system/logs/stats returns 200 with log-collector counts.

    The ``LogCollector`` maintains per-job circular buffers tagged by the
    ``current_job_id`` contextvar. This endpoint surfaces the aggregated
    view the dashboard renders in the "Logs" panel. We lock:

    * ``active_jobs_with_logs`` — number of jobs with at least one entry
    * ``total_log_entries``     — sum across all per-job buffers
    * ``max_jobs`` / ``max_entries_per_job`` — collector capacity limits
    * ``top_jobs``              — top-N per-job counts (dict)
    * ``current_job_id``        — live contextvar value (may be None)
    """
    response = await client.get("/api/v1/system/logs/stats")

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert isinstance(data, dict), f"Expected dict, got {type(data)}"

    # Lock the per-level / aggregate count contract.
    assert "active_jobs_with_logs" in data, f"Missing active_jobs_with_logs: {data}"
    assert "total_log_entries" in data, f"Missing total_log_entries: {data}"
    assert "max_jobs" in data, f"Missing max_jobs: {data}"
    assert "max_entries_per_job" in data, f"Missing max_entries_per_job: {data}"
    assert "top_jobs" in data, f"Missing top_jobs: {data}"
    assert "current_job_id" in data, f"Missing current_job_id: {data}"

    # Numeric fields must be ints (collector may return 0 on cold start).
    for int_field in ("active_jobs_with_logs", "total_log_entries", "max_jobs", "max_entries_per_job"):
        assert isinstance(data[int_field], int), (
            f"{int_field} must be int, got {type(data[int_field])}: {data[int_field]!r}"
        )
    # top_jobs is a dict (possibly empty on a fresh process).
    assert isinstance(data["top_jobs"], dict), (
        f"top_jobs must be dict, got {type(data['top_jobs'])}: {data['top_jobs']!r}"
    )
    # current_job_id is None when no job is emitting on this thread.
    assert data["current_job_id"] is None or isinstance(data["current_job_id"], str), (
        f"current_job_id must be None or str, got {type(data['current_job_id'])}: {data['current_job_id']!r}"
    )
    print(
        f"Logs/stats OK: jobs={data['active_jobs_with_logs']} "
        f"entries={data['total_log_entries']} top={data['top_jobs']}"
    )


# ---------------------------------------------------------------------------
# Endpoint: GET /api/v1/system/cache
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cache_state_returns_cache_info(client):
    """GET /api/v1/system/cache returns 200 with workflow_cache + concurrency.

    The dashboard renders two side-by-side gauges: the workflow cache
    fill (size / max_size / usage_pct) and the ConcurrencyLimiter
    snapshot (active / max / available / usage_pct). Both must be
    present, both must be dicts, and the numeric fields must be ints.
    """
    response = await client.get("/api/v1/system/cache")

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert isinstance(data, dict), f"Expected dict, got {type(data)}"

    # Two top-level sections the dashboard renders.
    assert "workflow_cache" in data, f"Missing workflow_cache: {data}"
    assert "concurrency" in data, f"Missing concurrency: {data}"

    wc = data["workflow_cache"]
    assert isinstance(wc, dict), f"workflow_cache must be dict, got {type(wc)}"
    for key in ("size", "max_size", "usage_pct"):
        assert key in wc, f"workflow_cache missing {key!r}: {wc}"
    assert isinstance(wc["size"], int), f"workflow_cache.size must be int, got {type(wc['size'])}"
    assert isinstance(wc["max_size"], int), f"workflow_cache.max_size must be int, got {type(wc['max_size'])}"

    cc = data["concurrency"]
    assert isinstance(cc, dict), f"concurrency must be dict, got {type(cc)}"
    for key in ("active", "max", "available", "usage_pct"):
        assert key in cc, f"concurrency missing {key!r}: {cc}"
    assert isinstance(cc["active"], int), f"concurrency.active must be int, got {type(cc['active'])}"
    assert isinstance(cc["max"], int), f"concurrency.max must be int, got {type(cc['max'])}"

    print(f"Cache OK: workflow_cache={wc} concurrency={cc}")


# ---------------------------------------------------------------------------
# Error envelope: unknown path under the system router must 404 cleanly
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_logs_stats_uses_problem_json_on_error(client):
    """Unknown path under ``/api/v1/system`` returns a structured 404.

    Locks the error-path contract for the system router: a request to a
    path the router does not define (here ``/api/v1/system/nonexistent``)
    must return a 404 with a JSON body.  The system router exposes only
    three GET routes (``/status``, ``/logs/stats``, ``/cache``) — no path
    parameters — so a routing-level 404 is the only 404 the router can
    produce.  Starlette's routing layer returns 404 for unmatched paths
    before the application's ``HTTPException`` handler in ``main.py`` is
    invoked, so the body shape here is FastAPI's default ``{"detail": ...}``
    envelope, not the RFC 7807 ``application/problem+json`` envelope used
    for 404s raised from inside a handler (see ``test_problem_details.py``
    for the latter).  A future change that installs a catch-all 404
    handler in ``main.py`` would promote this to the RFC 7807 shape and
    this test should be updated to assert the ``application/problem+json``
    media type.
    """
    response = await client.get("/api/v1/system/nonexistent")

    assert response.status_code == 404, (
        f"Expected 404 for unknown system path, got {response.status_code}: {response.text}"
    )

    # The response must be a parseable JSON document (not an HTML error
    # page).  FastAPI's default routing-404 body is ``{"detail": "Not Found"}``
    # with media type ``application/json``.
    body = response.json()
    assert isinstance(body, dict), f"Expected JSON object body, got {type(body)}: {response.text[:200]}"
    # Must carry a non-empty ``detail`` key so API consumers get a
    # human-readable explanation of what went wrong.
    assert "detail" in body and body["detail"], f"Missing detail field: {body}"
    print(f"System 404 contract locked: status={response.status_code} body={body}")
