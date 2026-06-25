"""Shared helpers for the first-party MCP servers (ashare / cn-macro / risk).

Centralises the error handling that was previously scattered across tool
modules as bare ``except Exception: return None`` / ``return {"error": str(e)}``
blocks. Those bare clauses swallowed network failures, upstream API changes and
data-shape regressions alike, making production failures invisible.

Three responsibilities live here:

* :func:`classify_error` — bucket an exception into a coarse category
  (``network`` / ``data`` / ``business`` / ``unknown``) so callers can react
  differently and so logs are filterable.
* :func:`tool_errors` — decorator wrapping a tool function so that *every*
  failure is logged (with type + repr) and returned as a structured, consistent
  error envelope instead of ``None`` or ``{"error": str(e)}``.
* :func:`dispatch_tool` / :func:`run_stdio_server` — single entry points used by
  the JSON-RPC ``tools/call`` handlers and the ``__main__`` loop so handler
  exceptions become structured JSON-RPC errors (``-32603``) instead of crashing
  the process or returning a bare ``None``.
"""

from __future__ import annotations

import functools
import json
import logging
import sys
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger("mcp.common")

# Exception types that map to "network" — matches the retry allow-list in
# ashare/utils.retry_akshare so classification stays consistent.
_NETWORK_EXC_NAMES = {
    "ConnectionError",
    "ConnectionResetError",
    "ConnectionAbortedError",
    "TimeoutError",
    "RemoteDisconnected",
    "ChunkedEncodingError",
    "ConnectTimeout",
    "ReadTimeout",
}

# Data-shape / parsing failures indicate an upstream API change or a corrupt
# payload rather than a transient outage.
_DATA_EXC_NAMES = {
    "KeyError",
    "ValueError",
    "JSONDecodeError",
    "ParserError",
    "EmptyDataError",
    "IndexError",
}


def classify_error(exc: BaseException) -> str:
    """Return a coarse category for ``exc``: network/data/business/unknown.

    Uses the exception *type name* (not ``isinstance``) so this works even when
    the originating library lives in a vendored or optional dependency that may
    not be importable in every environment.
    """
    name = type(exc).__name__
    if name in _NETWORK_EXC_NAMES:
        return "network"
    if name in _DATA_EXC_NAMES:
        return "data"
    # ``requests`` connection/timeout sub-classes carry descriptive names.
    lower = name.lower()
    if "timeout" in lower or "connection" in lower:
        return "network"
    if "schema" in lower or "parse" in lower or "json" in lower:
        return "data"
    # Built-in assertion / argument errors are caller/contract issues.
    if name in {"AssertionError", "TypeError", "AttributeError"}:
        return "business"
    return "unknown"


def error_envelope(
    message: str,
    *,
    tool: Optional[str] = None,
    category: str = "unknown",
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build the canonical error payload returned to MCP callers.

    The ``error`` key keeps backwards compatibility with existing tool code and
    frontends that read ``result["error"]``; ``category`` and ``tool`` are added
    for diagnosability.
    """
    payload: Dict[str, Any] = {
        "error": message,
        "category": category,
    }
    if tool is not None:
        payload["tool"] = tool
    if details:
        payload["details"] = details
    return payload


def tool_errors(tool_name: Optional[str] = None) -> Callable[[Callable], Callable]:
    """Decorator: log + normalise exceptions from a tool function.

    Replaces ad-hoc ``try/except Exception: return {"error": str(e)}`` blocks.
    Every failure is logged at ``warning`` (network/data) or ``error`` (unknown)
    level with the tool name, exception type and repr, then returned as a
    structured :func:`error_envelope` so callers never receive a bare ``None``
    or an unstructured string.
    """

    def decorator(fn: Callable) -> Callable:
        name = tool_name or fn.__name__

        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                return fn(*args, **kwargs)
            except Exception as exc:  # noqa: BLE001 — intentional tool boundary
                category = classify_error(exc)
                log_fn = (
                    logger.warning if category in {"network", "data"} else logger.error
                )
                log_fn(
                    "tool %s failed (%s/%s): %r",
                    name,
                    category,
                    type(exc).__name__,
                    exc,
                    exc_info=True,
                )
                return error_envelope(
                    str(exc) or type(exc).__name__,
                    tool=name,
                    category=category,
                )

        return wrapper

    return decorator


def dispatch_tool(
    tool_name: str,
    handler: Callable[..., Any],
    args: Dict[str, Any],
    req_id: Any,
) -> Optional[Dict[str, Any]]:
    """Invoke ``handler(args)`` and shape the MCP JSON-RPC response.

    On success returns a standard ``tools/call`` content envelope. On failure
    the exception is logged and converted to a JSON-RPC error (``-32603``) so
    the host (opencode) sees a structured error rather than a silent ``None``.
    """
    try:
        result = handler(args)
    except Exception as exc:  # noqa: BLE001 — JSON-RPC boundary
        category = classify_error(exc)
        logger.error(
            "dispatch %s failed (%s/%s): %r",
            tool_name,
            category,
            type(exc).__name__,
            exc,
            exc_info=True,
        )
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {
                "code": -32603,
                "message": f"{tool_name} failed: {exc}",
                "data": {"category": category, "tool": tool_name},
            },
        }

    text = json.dumps(result, ensure_ascii=False, default=str)
    return {
        "jsonrpc": "2.0",
        "result": {"content": [{"type": "text", "text": text}]},
        "id": req_id,
    }


def run_stdio_server(
    handle_request: Callable[[Dict[str, Any]], Optional[Dict[str, Any]]],
    *,
    server_name: str = "mcp-server",
) -> None:
    """Shared stdin/stdout JSON-RPC loop.

    Replaces the per-server ``__main__`` boilerplate. Ensures malformed JSON
    and handler exceptions both become structured JSON-RPC errors (with the
    request id when recoverable) and that the loop never dies on a single bad
    line — the previous servers crashed the whole process on a parse error.
    """
    root = logging.getLogger("mcp")
    if not root.handlers:
        logging.basicConfig(
            level=logging.INFO,
            stream=sys.stderr,
            format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        )
    logger.info("%s starting (stdio)", server_name)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id: Any = None
        try:
            req = json.loads(line)
            if isinstance(req, dict):
                req_id = req.get("id")
        except json.JSONDecodeError as exc:
            logger.warning("malformed JSON-RPC line: %s", exc)
            print(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": None,
                        "error": {"code": -32700, "message": f"Parse error: {exc}"},
                    },
                    ensure_ascii=False,
                )
            )
            sys.stdout.flush()
            continue

        try:
            resp = handle_request(req)
        except Exception as exc:  # noqa: BLE001 — top-level boundary
            logger.error(
                "%s handler crashed (%s): %r",
                server_name,
                type(exc).__name__,
                exc,
                exc_info=True,
            )
            resp = {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {
                    "code": -32603,
                    "message": f"Internal error: {exc}",
                },
            }
        if resp is not None:
            print(json.dumps(resp, ensure_ascii=False))
            sys.stdout.flush()


def make_handle_request(tools, tool_dispatch, server_info, *, validate_call=None):
    """Factory: create a JSON-RPC ``handle_request`` function.

    Handles ``initialize``, ``notifications/initialized``, ``tools/list``,
    ``tools/call``, and unknown-method routes consistently, removing the
    ``if/elif`` boilerplate that was previously duplicated across the three
    first-party MCP servers (ashare, cn-macro, risk).

    Parameters
    ----------
    tools:
        List of tool definition dicts (each with ``name``, ``description``,
        ``inputSchema`` keys) returned by ``tools/list``.
    tool_dispatch:
        Dict mapping tool name to a callable that accepts a single ``args``
        dict and returns the tool result.
    server_info:
        Dict with ``"name"`` and ``"version"`` keys used in the ``initialize``
        response.
    validate_call:
        Optional ``callable(tool_name, args, req_id)`` invoked *before*
        dispatching a ``tools/call`` request.  Return a JSON-RPC response dict
        to short-circuit (e.g. for missing-required-param errors), or
        ``None`` to proceed normally.

    Returns
    -------
    A ``handle_request(req)`` function suitable for passing to
    :func:`run_stdio_server`.
    """
    server_name = server_info["name"]

    def handle_request(req):
        method = req.get("method", "")
        params = req.get("params", {})
        req_id = req.get("id")

        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {
                        "name": server_name,
                        "version": server_info["version"],
                    },
                },
                "id": req_id,
            }

        if method == "notifications/initialized":
            return None

        if method == "tools/list":
            return {"jsonrpc": "2.0", "result": {"tools": tools}, "id": req_id}

        if method == "tools/call":
            name = params.get("name", "")
            args = params.get("arguments", {})

            # Per-server pre-dispatch validation (e.g. required symbol check).
            if validate_call:
                error_resp = validate_call(name, args, req_id)
                if error_resp is not None:
                    return error_resp

            handler = tool_dispatch.get(name)
            if not handler:
                return {
                    "jsonrpc": "2.0",
                    "error": {"code": -32603, "message": f"Unknown tool: {name}"},
                    "id": req_id,
                }

            return dispatch_tool(name, handler, args, req_id)

        return {
            "jsonrpc": "2.0",
            "error": {"code": -32603, "message": f"Unknown method: {method}"},
            "id": req_id,
        }

    return handle_request


__all__ = [
    "classify_error",
    "error_envelope",
    "tool_errors",
    "dispatch_tool",
    "run_stdio_server",
    "make_handle_request",
]
