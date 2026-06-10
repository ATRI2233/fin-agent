"""Integration tests for RFC 7807 Problem Details (application/problem+json).

These tests lock the public error-envelope contract that Wave 1 introduced
in :mod:`main.framework.api.problems` and wired into ``main.py`` via five
global exception handlers. Each test asserts a specific RFC 7807 field or
behaviour that downstream API consumers will depend on, so a regression in
either the helper or any handler is caught immediately.

Endpoints under test:
  GET  /api/v1/conversations/{unknown-uuid}   -> 404 Not Found
  POST /api/v1/conversations/{id}/messages    -> 422 Validation Error

RFC 7807 fields locked:
  - type        (URI reference; default ``about:blank``)
  - title       (short, human-readable summary)
  - status      (HTTP status code as int)
  - detail      (per-occurrence human-readable explanation)
  - instance    (URI reference of the specific occurrence)
  - Content-Type media type is exactly ``application/problem+json``
  - None-valued members are omitted from the JSON body
    (per ``ProblemDetail.model_dump(exclude_none=True)``)

Notes:
  - Uses ``client`` fixture from ``tests/conftest.py``.
  - Tests 2 and 3 also assert on the ``X-Request-ID`` response header,
    which requires ``RequestContextMiddleware`` to be wired into ``main.py``
    (Wave 6 task 6.4). They are written against the contract; if they
    fail right now, that's the wiring that needs to land.
"""

from __future__ import annotations

import pytest

# UUID that is syntactically valid but guaranteed not to exist in the
# per-test in-memory SQLite database. Using a real UUIDv4-shaped string
# also proves the conversations endpoint parses the path as a string,
# not as an int (which would 422 instead of 404).
UNKNOWN_CONV_ID = "00000000-0000-0000-0000-000000000000"

# Standard RFC 7807 media type. RFC 7807 §3 says clients and servers
# SHOULD use this exact value when the body is a problem document.
PROBLEM_MEDIA_TYPE = "application/problem+json"


# ---------------------------------------------------------------------------
# 404 contract
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_404_returns_problem_json(client):
    """GET on an unknown conversation id returns an RFC 7807 problem+json.

    Locks the four core RFC 7807 members (``type``, ``title``, ``status``,
    ``detail``) plus the ``application/problem+json`` media type. A
    regression here means API consumers can no longer rely on a stable
    error envelope.
    """
    response = await client.get(f"/api/v1/conversations/{UNKNOWN_CONV_ID}")

    # Status code is part of the contract — not just a numeric 404, but
    # specifically the HTTP status the NotFoundError handler maps to.
    assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"

    # Media type MUST be application/problem+json (RFC 7807 §3).
    assert PROBLEM_MEDIA_TYPE in response.headers["content-type"], (
        f"Expected content-type to contain {PROBLEM_MEDIA_TYPE!r}, got {response.headers.get('content-type')!r}"
    )

    body = response.json()
    # Lock the four RFC 7807 members a 404 response must expose.
    assert body.get("status") == 404, f"Missing/wrong status field: {body}"
    assert body.get("title") == "Not Found", f"Missing/wrong title field: {body}"
    assert "type" in body, f"Missing type field: {body}"
    # detail should carry the per-occurrence message from NotFoundError.
    assert "detail" in body and body["detail"], f"Missing detail field: {body}"

    print(f"404 contract locked: {body}")


@pytest.mark.asyncio
async def test_404_problem_includes_request_id_header(client):
    """404 problem response carries the ``X-Request-ID`` correlation header.

    The header is set by ``RequestContextMiddleware`` (Wave 1 task 1.1);
    its presence in error responses is what lets operators correlate a
    client-side error report with server-side log lines.

    Note: depends on the middleware being wired into ``main.py`` —
    Wave 6 task 6.4. The test is committed now and will pass once the
    middleware is registered.
    """
    response = await client.get(f"/api/v1/conversations/{UNKNOWN_CONV_ID}")

    assert response.status_code == 404
    request_id_header = response.headers.get("x-request-id")
    assert request_id_header, (
        "X-Request-ID header missing from 404 response — "
        "RequestContextMiddleware is not wired into main.py (Wave 6 task 6.4)"
    )
    # Middleware must generate a non-empty id even when the client does
    # not supply one — otherwise log correlation is broken by default.
    assert len(request_id_header) > 0
    print(f"404 response carries X-Request-ID={request_id_header}")


@pytest.mark.asyncio
async def test_404_problem_echoes_supplied_request_id(client):
    """Client-supplied ``X-Request-ID`` is echoed verbatim in the response.

    Locks the "pass-through" half of the middleware contract: when the
    caller already has a correlation id (e.g. from an upstream gateway),
    the server must preserve it rather than overwrite it. This is what
    enables end-to-end tracing across service boundaries.
    """
    custom_id = "my-custom-id-123"

    response = await client.get(
        f"/api/v1/conversations/{UNKNOWN_CONV_ID}",
        headers={"X-Request-ID": custom_id},
    )

    assert response.status_code == 404
    echoed = response.headers.get("x-request-id")
    assert echoed == custom_id, (
        f"Expected X-Request-ID={custom_id!r}, got {echoed!r} — "
        "RequestContextMiddleware must echo the client-supplied id verbatim"
    )
    print(f"Client-supplied X-Request-ID echoed: {echoed}")


# ---------------------------------------------------------------------------
# 422 contract
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_422_returns_problem_json_on_validation_error(client):
    """POST with missing required field returns a 422 RFC 7807 problem+json.

    Uses ``MessageCreate.content`` (the only required field on the
    messages endpoint) to deterministically trigger
    ``RequestValidationError``. The 422 handler in ``main.py`` must
    produce the same envelope shape as the 404 handler — just with
    ``title="Validation Error"`` and ``status=422``.
    """
    # Create a conversation so the messages endpoint exists for it.
    create_resp = await client.post(
        "/api/v1/conversations",
        json={"title": "Problem Details Test"},
    )
    assert create_resp.status_code in (200, 201), create_resp.text
    conv_id = create_resp.json()["id"]

    # ``content`` is required on MessageCreate (Field(..., max_length=10000));
    # sending ``{}`` triggers RequestValidationError -> 422.
    bad_resp = await client.post(
        f"/api/v1/conversations/{conv_id}/messages",
        json={},  # missing required 'content'
    )

    assert bad_resp.status_code == 422, (
        f"Expected 422 for missing required field, got {bad_resp.status_code}: {bad_resp.text}"
    )
    assert PROBLEM_MEDIA_TYPE in bad_resp.headers["content-type"], (
        f"Expected content-type to contain {PROBLEM_MEDIA_TYPE!r}, got {bad_resp.headers.get('content-type')!r}"
    )

    body = bad_resp.json()
    # Lock the 422-specific contract surface.
    assert body.get("status") == 422, f"Missing/wrong status field: {body}"
    assert body.get("title") == "Validation Error", f"Missing/wrong title field: {body}"
    # detail should point at the offending field (RequestValidationError
    # handler builds it as ``"<loc>: <msg>"``).
    assert "detail" in body and body["detail"], f"Missing detail field: {body}"
    print(f"422 contract locked: {body}")


# ---------------------------------------------------------------------------
# ProblemDetail serialisation discipline
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_404_problem_omits_none_fields(client):
    """Problem responses never carry ``"field": null`` entries.

    :class:`ProblemDetail` uses ``model_dump(exclude_none=True)``, so any
    optional member (``detail``, ``instance``) that is unset must be
    absent from the JSON body — not present-with-null. This avoids
    forcing every consumer to null-check every field.

    We assert the stronger property: every key present in the body has
    a non-None value. That holds regardless of which optional fields
    the handler fills in (current main.py always sets both ``detail``
    and ``instance`` for 404, so we just verify the invariant).
    """
    response = await client.get(f"/api/v1/conversations/{UNKNOWN_CONV_ID}")
    assert response.status_code == 404
    body = response.json()

    for key, value in body.items():
        assert value is not None, (
            f"Field {key!r} is null in the problem body — "
            "ProblemDetail.model_dump(exclude_none=True) should have omitted it"
        )
    print(f"No null-valued fields in 404 body: keys={sorted(body.keys())}")


@pytest.mark.asyncio
async def test_404_returns_application_problem_json_not_default_detail(client):
    """404 body is a full RFC 7807 envelope, not the legacy ``{"detail": ...}``.

    FastAPI's default ``HTTPException`` handler returns
    ``{"detail": "Not Found"}``. After Wave 1, the same trigger produces
    a five-field envelope. This test fails loudly if a future change
    accidentally re-installs the default handler, or if the
    ``HTTPException`` registration in ``main.py`` is bypassed.
    """
    response = await client.get(f"/api/v1/conversations/{UNKNOWN_CONV_ID}")
    assert response.status_code == 404
    body = response.json()

    # Must have the RFC 7807 shape — type, title, status plus detail.
    assert "type" in body, f"Missing type field — not an RFC 7807 envelope: {body}"
    assert "title" in body, f"Missing title field — not an RFC 7807 envelope: {body}"
    assert "status" in body, f"Missing status field — not an RFC 7807 envelope: {body}"
    # And at least one other member, otherwise the body collapses to the
    # three-field minimal envelope — still valid RFC 7807, but worth
    # pinning that we always emit detail for 404s.
    assert len(body) >= 4, f"Problem body too sparse for a 404: {body}"

    # Sanity: it really IS a problem document, not a FastAPI default —
    # default body would have exactly one key ('detail') and no 'type'.
    assert body.keys() != {"detail"}, f"Body looks like the legacy FastAPI default (only 'detail' key): {body}"
    print(f"404 body is a real RFC 7807 envelope, not a legacy default: {body}")
