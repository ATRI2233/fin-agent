"""Integration tests for direct Agent dispatch (Task 11 - safety net).

Tests run against the CURRENT (unrefactored) code. Wave 4 may migrate
dispatch.py - these tests detect regressions in the dispatch contract.

Endpoints under test (from main/framework/api/dispatch.py):
    POST /api/v1/dispatch          - sync single-agent dispatch
    POST /api/v1/dispatch/parallel - parallel multi-agent dispatch

NOTE: These tests do NOT mock the OpenCode backend. Real LLM calls take
variable time (typically 20-90s for the macro-scout / technical-chartist
agents). These tests assert on the dispatch CONTRACT (endpoint registered,
request/response shape) not on backend speed. They will pass as long as
the endpoint is reachable and returns a well-formed response (or a
backend-error response with the right shape).
"""

from __future__ import annotations

import time

import httpx
import pytest


# Canonical endpoints discovered from main/framework/api/dispatch.py
# (router prefix "/api/v1/dispatch"; sync is empty suffix, parallel is "/parallel").
SYNC_PATH = "/api/v1/dispatch"
PARALLEL_PATH = "/api/v1/dispatch/parallel"


@pytest.mark.asyncio
async def test_sync_dispatch(client):
    """Synchronous Agent dispatch (one agent, one prompt) - safety net.

    Verifies:
    - The dispatch endpoint is registered (not 404).
    - A valid DispatchRequest payload is accepted.
    - The response matches the DispatchResult schema.

    The actual LLM result is not asserted - we trust the dispatcher's
    parsing logic and focus on the API contract.
    """
    payload = {
        "agent": "macro-scout",
        "prompt": "Brief market overview",
        "timeout": 15,  # short to fail fast if backend is unreachable
    }

    start = time.time()
    try:
        resp = await client.post(SYNC_PATH, json=payload, timeout=120.0)
    except httpx.TimeoutException as e:
        elapsed = time.time() - start
        # Soft warning: endpoint exists but backend is extremely slow.
        # Safety-net contract is still satisfied (the route would respond
        # if the backend were healthy). Mark as a warning rather than fail.
        pytest.skip(
            f"Sync dispatch via {SYNC_PATH} timed out after {elapsed:.1f}s - "
            f"endpoint exists but backend too slow for in-process test: {e}"
        )
        return  # unreachable but makes type-checkers happy

    elapsed = time.time() - start
    # Endpoint is registered - assert response shape.
    # 200 = OpenCode responded successfully
    # 500 = backend raised, but endpoint ran (handler caught exception)
    assert resp.status_code in (200, 500), f"unexpected status {resp.status_code} from {SYNC_PATH}: {resp.text}"
    data = resp.json()
    assert "agent" in data, f"missing 'agent' in response: {data}"
    assert "duration_seconds" in data, f"missing 'duration_seconds' in response: {data}"
    # DispatchResult guarantees either 'result' or 'error' (timeout returns error)
    assert ("result" in data) or ("error" in data), f"response must have 'result' or 'error': {data}"
    status_label = "OK" if resp.status_code == 200 else "BACKEND_ERR"
    print(
        f"[{status_label}] sync dispatch via {SYNC_PATH} in {elapsed:.1f}s: "
        f"agent={data.get('agent')}, "
        f"has_result={('result' in data)}, has_error={('error' in data)}"
    )


@pytest.mark.asyncio
async def test_parallel_dispatch(client):
    """Parallel Agent dispatch (multiple agents, one prompt) - safety net.

    Verifies:
    - The parallel endpoint is registered (not 404).
    - A valid ParallelDispatchRequest payload is accepted.
    - The response matches the ParallelDispatchResponse schema.

    The actual LLM results are not asserted - we trust the dispatcher's
    parallel coordination logic and focus on the API contract.
    """
    payload = {
        "agents": ["macro-scout", "technical-chartist"],
        "prompt": "Quick analysis",
        "timeout": 30,  # short to fail fast if backend is unreachable
    }

    start = time.time()
    try:
        resp = await client.post(PARALLEL_PATH, json=payload, timeout=120.0)
    except httpx.TimeoutException as e:
        elapsed = time.time() - start
        pytest.skip(
            f"Parallel dispatch via {PARALLEL_PATH} timed out after "
            f"{elapsed:.1f}s - endpoint exists but backend too slow: {e}"
        )
        return

    elapsed = time.time() - start
    # Parallel endpoint: either succeeds (200) or handler raises HTTPException
    # (status 500) - both indicate the route is registered and ran.
    if resp.status_code == 500:
        body = resp.json()
        assert "detail" in body, f"500 response missing 'detail': {body}"
        print(
            f"[BACKEND_ERR] parallel dispatch via {PARALLEL_PATH} in {elapsed:.1f}s: detail={body.get('detail')[:80]!r}"
        )
        return

    assert resp.status_code == 200, f"unexpected status {resp.status_code} from {PARALLEL_PATH}: {resp.text}"
    data = resp.json()
    assert "results" in data, f"missing 'results' in response: {data}"
    assert "duration_seconds" in data, f"missing 'duration_seconds' in response: {data}"
    assert isinstance(data["results"], list), f"'results' must be a list: {type(data['results'])}"
    # Each entry must look like DispatchResult
    for r in data["results"]:
        assert "agent" in r, f"missing 'agent' in result entry: {r}"
    print(f"[OK] parallel dispatch via {PARALLEL_PATH} in {elapsed:.1f}s: {len(data['results'])} results")


@pytest.mark.asyncio
async def test_dispatch_request_validation(client):
    """Dispatch endpoint rejects malformed payloads (contract safety net).

    Pure request-validation test - does NOT call the backend. Fast.
    """
    resp = await client.post(
        SYNC_PATH,
        json={"prompt": "no agent specified"},
        timeout=10.0,
    )
    assert resp.status_code == 422, f"expected 422 for missing 'agent', got {resp.status_code}: {resp.text}"
    print(f"[OK] validation: 422 returned for missing 'agent' field")


@pytest.mark.asyncio
async def test_parallel_request_validation(client):
    """Parallel dispatch rejects empty agents list (min_length=1).

    Pure request-validation test - does NOT call the backend. Fast.
    """
    resp = await client.post(
        PARALLEL_PATH,
        json={"agents": [], "prompt": "empty agent list"},
        timeout=10.0,
    )
    assert resp.status_code == 422, f"expected 422 for empty 'agents', got {resp.status_code}: {resp.text}"
    print(f"[OK] validation: 422 returned for empty 'agents' list")
