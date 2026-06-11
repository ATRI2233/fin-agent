"""ToolQueryService — business logic for tool discovery and invocation.

Reads tool definitions from ``.opencode/opencode.json`` (the workspace's
MCP/tool manifest) and exposes a small focused surface to
``controllers/tools.py``.

Lazy loading: the manifest is read on the *first* call to any public method
(see :meth:`_ensure_loaded`) rather than at import time.  This keeps module
imports side-effect-free (no file IO, no missing-file crash on tooling like
``mypy``/``ruff --collect-only``) and makes service construction cheap.

Stub invocation: :meth:`invoke_tool` is intentionally a v1 stub — direct tool
invocation is not yet wired into the framework.  It returns the same error
shape the legacy ``api/tools.py`` route returned so existing clients keep
working unchanged.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from main.framework.services.exceptions import NotFoundError

logger = logging.getLogger(__name__)


def _load_tools_from_opencode() -> list[dict]:
    """Load tool definitions from all enabled MCP servers in ``opencode.json``.

    Returns an empty list if the config file is missing — never raises on a
    missing file.  Optional ``tool`` fields default to empty strings.
    """
    config_path = Path(__file__).resolve().parents[3] / ".opencode" / "opencode.json"
    if not config_path.exists():
        return []
    with open(config_path, encoding="utf-8") as f:
        config = json.load(f)
    tools: list[dict] = []
    for server_name, server_cfg in config.get("mcp", {}).items():
        if not server_cfg.get("enabled", True):
            continue
        for tool in server_cfg.get("tools", []):
            tools.append(
                {
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "server": server_name,
                    "category": tool.get("category", ""),
                }
            )
    return tools


class ToolQueryService:
    """Business-logic facade for tool discovery and invocation.

    Public surface (3 methods, all sync): list_tools, get_tool, invoke_tool.
    The ``_tools`` cache is populated on first access, never invalidated.
    """

    def __init__(self) -> None:
        # Lazy cache — None until first public-method call.
        self._tools: list[dict] | None = None

    def _ensure_loaded(self) -> list[dict]:
        """Return the tool manifest, loading it from disk on first call."""
        if self._tools is None:
            self._tools = _load_tools_from_opencode()
        return self._tools

    # ------------------------------------------------------------------
    # Tool discovery
    # ------------------------------------------------------------------

    def list_tools(self) -> list[dict]:
        """Return the full list of enabled tools, in manifest order."""
        return list(self._ensure_loaded())

    def get_tool(self, name: str) -> dict:
        """Return a single tool by name. Raises :class:`NotFoundError` if missing."""
        for tool in self._ensure_loaded():
            if tool["name"] == name:
                return tool
        raise NotFoundError(f"Tool {name} not found")

    # ------------------------------------------------------------------
    # Tool invocation (v1 stub)
    # ------------------------------------------------------------------

    def invoke_tool(self, name: str) -> dict:
        """Stub: direct tool invocation is not implemented in v1.

        Preserves the legacy response shape ``{"error": ..., "name": ...}`` so
        existing clients keep working.  A future iteration will dispatch via
        the MCP layer.
        """
        return {"error": "Direct tool invocation not implemented in v1", "name": name}


__all__ = ["ToolQueryService"]
