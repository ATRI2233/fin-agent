"""Integration tests for the ``/api/v1/tools`` discovery endpoints.

Tests run against the refactored thin-handler controllers in
``main/framework/controllers/tools.py`` (Wave 3 migration) and lock the
public HTTP contract that the WebUI Configuration page depends on.

Endpoints under test:
  GET /api/v1/tools                -> 200 list of tool dicts
  GET /api/v1/tools/{name}         -> 200 tool dict / 404 RFC 7807 problem
  GET /api/v1/tools/{name}/invoke  -> 200 v1 stub error envelope

Notes:
  - Uses ``client`` fixture from ``tests/conftest.py`` (ASGI transport,
    in-memory SQLite, DI container pre-configured).
  - Tools are loaded lazily from ``.opencode/opencode.json`` on the first
    request by :class:`ToolQueryService` — the test suite therefore asserts
    on a known tool name (``ashare_quote``) that the workspace manifest
    ships with.
  - The invoke endpoint is intentionally a v1 stub that returns the legacy
    ``{"error": ..., "name": ...}`` shape. A future iteration will wire it
    to the MCP layer; this test pins the stub contract so the migration
    is non-breaking.
"""

from __future__ import annotations

import pytest

# A tool name that the workspace ``.opencode/opencode.json`` ships with
# (ashare-mcp-server, first entry).  Using a manifest-known name keeps
# the test independent of how many tools any future MCP server adds.
KNOWN_TOOL_NAME = "ashare_quote"

# Standard RFC 7807 media type. RFC 7807 section 3 says clients and
# servers SHOULD use this exact value when the body is a problem document.
PROBLEM_MEDIA_TYPE = "application/problem+json"


# ---------------------------------------------------------------------------
# Endpoint: GET /api/v1/tools
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_tools_returns_tool_list(client):
    """GET /api/v1/tools returns 200 with a non-empty list of tool dicts.

    Each tool dict must carry the four contract fields the WebUI renders
    (``name``, ``description``, ``server``, ``category``) and ``name`` is
    the natural primary key the ``/{name}`` route resolves on.
    """
    response = await client.get("/api/v1/tools")

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert isinstance(data, list), f"Expected list body, got {type(data)}"
    assert len(data) > 0, f"Expected non-empty tool list, got {data!r}"

    # Lock the per-tool shape so a regression in the manifest serializer
    # is caught — every tool must expose the four dashboard-expected keys.
    first = data[0]
    assert isinstance(first, dict), f"Tool entry must be dict, got {type(first)}"
    for key in ("name", "description", "server", "category"):
        assert key in first, f"Tool entry missing {key!r}: {first}"
    assert isinstance(first["name"], str) and first["name"], f"Tool name must be non-empty str, got {first['name']!r}"
    # KNOWN_TOOL_NAME must appear in the list so the next test has a
    # deterministic target.
    names = {t["name"] for t in data}
    assert KNOWN_TOOL_NAME in names, f"Expected {KNOWN_TOOL_NAME!r} in tool list, got {sorted(names)[:5]}"
    print(f"List OK: {len(data)} tools, first={first['name']!r}")


# ---------------------------------------------------------------------------
# Endpoint: GET /api/v1/tools/{name}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_tool_by_name_returns_tool_details(client):
    """GET /api/v1/tools/{name} returns 200 with the full tool document.

    Locks the happy-path detail contract: the route must echo back the
    same four contract fields as the list endpoint for the same tool,
    so the WebUI detail panel can render a tool view without a second
    round-trip to the list endpoint.
    """
    response = await client.get(f"/api/v1/tools/{KNOWN_TOOL_NAME}")

    assert response.status_code == 200, f"Expected 200 for known tool, got {response.status_code}: {response.text}"

    data = response.json()
    assert isinstance(data, dict), f"Expected dict body, got {type(data)}"
    assert data["name"] == KNOWN_TOOL_NAME, f"Expected name={KNOWN_TOOL_NAME!r}, got {data.get('name')!r}"
    for key in ("description", "server", "category"):
        assert key in data, f"Tool detail missing {key!r}: {data}"
    print(f"Get OK: {data['name']!r} server={data['server']!r}")


# ---------------------------------------------------------------------------
# 404 contract: unknown tool name must produce an RFC 7807 problem document
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_tool_404_returns_problem_json(client):
    """Unknown tool name returns 404 with ``application/problem+json``.

    The controller raises :class:`HTTPException(404, "Tool not found")`
    on :class:`NotFoundError`; the global ``http_exception_handler`` in
    ``main.py`` converts that into the RFC 7807 envelope. We lock the
    media type and the four core members (``type``, ``title``,
    ``status``, ``detail``) so a future regression in the handler is
    caught immediately.
    """
    response = await client.get("/api/v1/tools/__definitely_not_a_real_tool__")

    assert response.status_code == 404, f"Expected 404 for unknown tool, got {response.status_code}: {response.text}"
    assert PROBLEM_MEDIA_TYPE in response.headers["content-type"], (
        f"Expected content-type to contain {PROBLEM_MEDIA_TYPE!r}, got {response.headers.get('content-type')!r}"
    )

    body = response.json()
    assert body.get("status") == 404, f"Missing/wrong status field: {body}"
    assert body.get("title") == "Not Found", f"Missing/wrong title field: {body}"
    assert "type" in body, f"Missing type field: {body}"
    # ``detail`` is forwarded from HTTPException("Tool not found").
    assert "detail" in body and body["detail"], f"Missing detail field: {body}"
    print(f"404 contract locked: {body}")


# ---------------------------------------------------------------------------
# Endpoint: GET /api/v1/tools/{name}/invoke (v1 stub)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_invoke_tool_returns_stub_error(client):
    """GET /api/v1/tools/{name}/invoke returns 200 with the v1 stub error.

    Direct tool invocation is not yet wired into the framework
    (see :meth:`ToolQueryService.invoke_tool`).  The stub preserves the
    legacy ``{"error": ..., "name": ...}`` shape so existing clients
    keep working. We lock both fields so a future implementation that
    silently changes the contract (e.g. drops the ``name`` echo) fails
    loudly here.
    """
    response = await client.get(f"/api/v1/tools/{KNOWN_TOOL_NAME}/invoke")

    assert response.status_code == 200, f"Expected 200 for invoke stub, got {response.status_code}: {response.text}"

    data = response.json()
    assert isinstance(data, dict), f"Expected dict body, got {type(data)}"
    assert "error" in data and data["error"], f"Missing/empty 'error' field in stub response: {data}"
    assert data.get("name") == KNOWN_TOOL_NAME, (
        f"Expected name={KNOWN_TOOL_NAME!r} echoed back, got {data.get('name')!r}"
    )
    # The stub message is the documented v1 contract — pin it verbatim
    # so a future change to the string is caught (and consciously
    # updated in the client).
    assert "not implemented" in data["error"].lower(), f"Unexpected stub error message: {data['error']!r}"
    print(f"Invoke stub locked: error={data['error']!r} name={data['name']!r}")
