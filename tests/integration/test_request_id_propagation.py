"""Integration tests for ``X-Request-ID`` propagation.

Locks the public correlation-id contract enforced by
:class:`main.framework.core.request_context.RequestContextMiddleware`,
which is wired into ``main.framework.main`` as the outermost middleware
(Wave 4 task ``bg_01078e4e``).

Contract under test
-------------------
For every request — successful, 4xx, 5xx — the response MUST carry an
``X-Request-ID`` header. If the client supplies the header, the value
MUST be echoed verbatim (enabling end-to-end trace propagation from an
upstream gateway). If the client omits it, the middleware MUST mint a
fresh ``uuid.uuid4().hex`` (32 lowercase hexadecimal characters) so log
correlation is never broken by default.

Endpoints exercised
-------------------
- ``GET  /api/v1/health``                       -> 200 happy path
- ``GET  /api/v1/conversations/{unknown-uuid}`` -> 404 NotFoundError
- ``POST /api/v1/conversations/{id}/messages``  -> 422 RequestValidationError

Notes
-----
- Uses the ``client`` fixture from ``tests/conftest.py``, which wires
  the FastAPI app to an in-memory SQLite session and provides an
  ``httpx.AsyncClient`` with base_url ``http://test``.
- These tests depend on the middleware being the **outermost** layer
  (added last in ``main.py``). Starlette stacks middleware in reverse
  add-order, so being added last means it runs first — wrapping the
  request and post-processing the response from every downstream
  handler and exception handler.
"""

from __future__ import annotations

import re

import pytest

# UUID that is syntactically valid but guaranteed not to exist in the
# per-test in-memory SQLite database. Using a real UUIDv4-shaped string
# also proves the conversations endpoint parses the path as a string,
# not as an int (which would 422 instead of 404).
UNKNOWN_CONV_ID = "00000000-0000-0000-0000-000000000000"

# The literal header name. Defined once so a future rename of the
# constant in ``request_context.HEADER_NAME`` is caught as a single,
# localised test failure rather than six scattered misses.
HEADER_NAME = "X-Request-ID"

# Strict regex for ``uuid.uuid4().hex`` — exactly 32 lowercase hex
# chars, no dashes, no version nibble. Used to assert the auto-generated
# id format without re-implementing UUID parsing.
HEX32 = re.compile(r"[0-9a-f]{32}")


# ---------------------------------------------------------------------------
# 200 happy path: GET /api/v1/health
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_response_echoes_supplied_request_id(client):
    """Client-supplied ``X-Request-ID`` is echoed verbatim in the response.

    Locks the "pass-through" half of the middleware contract: when the
    caller already has a correlation id (e.g. from an upstream gateway
    or a frontend request interceptor), the server must preserve it
    rather than overwrite it. This is what enables end-to-end tracing
    across service boundaries.
    """
    supplied_id = "my-id-123"

    response = await client.get(
        "/api/v1/health",
        headers={HEADER_NAME: supplied_id},
    )

    assert response.status_code == 200, f"Expected 200 from /api/v1/health, got {response.status_code}: {response.text}"
    echoed = response.headers.get(HEADER_NAME)
    assert echoed == supplied_id, (
        f"Expected {HEADER_NAME}={supplied_id!r} to be echoed, got {echoed!r} — "
        "RequestContextMiddleware must echo the client-supplied id verbatim"
    )
    print(f"Supplied {HEADER_NAME}={supplied_id} echoed verbatim in response")


@pytest.mark.asyncio
async def test_response_generates_request_id_when_absent(client):
    """Response carries an auto-generated ``X-Request-ID`` when none is supplied.

    Locks the "default" half of the middleware contract: every response
    must carry a correlation id, even if the client never sent one. Log
    correlation would be silently broken without this guarantee.
    """
    response = await client.get("/api/v1/health")

    assert response.status_code == 200
    generated = response.headers.get(HEADER_NAME)
    assert generated, f"Response is missing {HEADER_NAME} header — RequestContextMiddleware should have generated one"
    # Sanity: the auto-generated id must be non-empty. Strict format
    # validation lives in ``test_request_id_format_is_hex_uuid`` so a
    # future format change there does not fail this test in two places.
    assert len(generated) > 0, f"Auto-generated {HEADER_NAME} is empty: {generated!r}"
    print(f"Auto-generated {HEADER_NAME}={generated} present on 200 response")


@pytest.mark.asyncio
async def test_request_id_format_is_hex_uuid(client):
    """Auto-generated ``X-Request-ID`` matches ``uuid.uuid4().hex`` (32 hex chars).

    Pins the exact format the middleware produces when no header is
    supplied. ``uuid4().hex`` is exactly 32 lowercase hex characters
    with no dashes. If a future change switches to e.g. ``uuid4()``
    (which has dashes) or to a longer token, downstream log pipelines
    that regex-match on this format will silently break.
    """
    response = await client.get("/api/v1/health")
    assert response.status_code == 200

    generated = response.headers[HEADER_NAME]
    assert re.fullmatch(HEX32, generated), (
        f"Auto-generated {HEADER_NAME}={generated!r} does not match "
        f"uuid.uuid4().hex format (32 lowercase hex chars); got length={len(generated)}"
    )
    # Stronger invariant: no dashes, no uppercase, no non-hex chars.
    # ``HEX32`` already enforces this; the explicit check makes the
    # failure message actionable if the format ever drifts.
    assert "-" not in generated, f"Auto-generated id contains a dash: {generated!r}"
    assert generated == generated.lower(), f"Auto-generated id is not lowercase: {generated!r}"
    print(f"Auto-generated {HEADER_NAME}={generated} matches uuid4().hex format")


# ---------------------------------------------------------------------------
# Error responses: 404 and 422
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_request_id_propagates_through_404_response(client):
    """404 problem response also carries the ``X-Request-ID`` header.

    The ``NotFoundError`` exception handler in ``main.py`` returns a
    ``JSONResponse`` — without the middleware being outermost, the
    correlation header would be missing on error responses. This test
    guards that contract: even errors must be correlatable in logs.
    """
    response = await client.get(f"/api/v1/conversations/{UNKNOWN_CONV_ID}")
    assert response.status_code == 404, (
        f"Expected 404 for unknown conversation, got {response.status_code}: {response.text}"
    )

    request_id = response.headers.get(HEADER_NAME)
    assert request_id, (
        f"404 response is missing {HEADER_NAME} header — "
        "RequestContextMiddleware must run outside the exception handler chain"
    )
    assert len(request_id) > 0, f"404 {HEADER_NAME} is empty: {request_id!r}"
    print(f"404 response carries {HEADER_NAME}={request_id}")


@pytest.mark.asyncio
async def test_request_id_propagates_through_422_response(client):
    """422 validation error also carries the ``X-Request-ID`` header.

    Same contract as 404: the ``RequestValidationError`` handler returns
    a ``JSONResponse`` and would otherwise strip the correlation header.
    This test exercises that handler explicitly so a regression that
    accidentally re-installs the default FastAPI 422 handler (which
    does not propagate the header) is caught.
    """
    # Create a conversation so the messages endpoint exists.
    create_resp = await client.post(
        "/api/v1/conversations",
        json={"title": "Request-ID Propagation Test"},
    )
    assert create_resp.status_code in (200, 201), create_resp.text
    conv_id = create_resp.json()["id"]

    # ``content`` is required on MessageCreate; sending ``{}`` triggers
    # RequestValidationError -> 422.
    bad_resp = await client.post(
        f"/api/v1/conversations/{conv_id}/messages",
        json={},
    )
    assert bad_resp.status_code == 422, (
        f"Expected 422 for missing required field, got {bad_resp.status_code}: {bad_resp.text}"
    )

    request_id = bad_resp.headers.get(HEADER_NAME)
    assert request_id, (
        f"422 response is missing {HEADER_NAME} header — "
        "RequestContextMiddleware must run outside the validation handler chain"
    )
    assert len(request_id) > 0, f"422 {HEADER_NAME} is empty: {request_id!r}"
    print(f"422 response carries {HEADER_NAME}={request_id}")


# ---------------------------------------------------------------------------
# Uniqueness: distinct requests get distinct ids
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_distinct_requests_get_distinct_ids(client):
    """Two anonymous requests receive two distinct auto-generated request ids.

    Pins the "no leakage / no caching" half of the middleware contract.
    If the middleware accidentally memoised the id at module level
    (instead of minting per-request), every response would carry the
    same id and log correlation would collapse to a single bucket.
    """
    first = await client.get("/api/v1/health")
    second = await client.get("/api/v1/health")

    assert first.status_code == 200
    assert second.status_code == 200

    first_id = first.headers.get(HEADER_NAME)
    second_id = second.headers.get(HEADER_NAME)

    assert first_id, f"First response missing {HEADER_NAME}"
    assert second_id, f"Second response missing {HEADER_NAME}"
    assert first_id != second_id, (
        f"Two anonymous requests got the same {HEADER_NAME}={first_id!r} — "
        "RequestContextMiddleware must mint a fresh id per request"
    )
    # Each must individually satisfy the format contract.
    assert re.fullmatch(HEX32, first_id), f"First id has wrong format: {first_id!r}"
    assert re.fullmatch(HEX32, second_id), f"Second id has wrong format: {second_id!r}"
    print(f"Distinct ids: {first_id} != {second_id}")
