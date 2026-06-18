"""ToolQueryService — business logic for tool discovery and invocation.

Reads tool definitions from ``.opencode/opencode.json`` (the workspace's
MCP/tool manifest) and exposes a small focused surface to
``controllers/tools.py``.

Data sources (merged at read time):
  1. ``opencode.json`` → ``mcp`` section — MCP-registered tools.
  2. ``opencode.json`` → ``tools`` section — custom tool overrides.
  3. Built-in tools (Read, Edit, Bash, etc.) — hardcoded once, here.

Caching: results are cached for ``_CACHE_TTL`` seconds. ``reload()`` forces
an immediate refresh.

Stub invocation: :meth:`invoke_tool` is intentionally a v1 stub.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from main.framework.services.exceptions import NotFoundError

logger = logging.getLogger(__name__)

_CACHE_TTL = 30 # seconds

# Built-in tools — the single source of truth for this list.
BUILTIN_TOOLS: list[dict] = [
    {"name": "read", "description": "从磁盘读取文件", "server": "", "category": "文件", "source": "builtin", "enabled": True},
    {"name": "edit", "description": "编辑磁盘文件", "server": "", "category": "文件", "source": "builtin", "enabled": True},
    {"name": "bash", "description": "执行 Shell 命令", "server": "", "category": "系统", "source": "builtin", "enabled": True},
    {"name": "grep", "description": "搜索文件内容", "server": "", "category": "文件", "source": "builtin", "enabled": True},
    {"name": "glob", "description": "按模式查找文件", "server": "", "category": "文件", "source": "builtin", "enabled": True},
    {"name": "websearch", "description": "搜索网页", "server": "", "category": "网络", "source": "builtin", "enabled": True},
    {"name": "webfetch", "description": "获取 URL", "server": "", "category": "网络", "source": "builtin", "enabled": True},
    {"name": "lsp_diagnostics", "description": "获取 LSP 错误/警告", "server": "", "category": "开发", "source": "builtin", "enabled": True},
]


def _load_tools_from_opencode() -> list[dict]:
    """Load tool definitions from all enabled MCP servers + custom tools + builtins.

    Returns builtins-only if the config file is missing.
    """
    config_path = Path(__file__).resolve().parents[3] / ".opencode" / "opencode.json"
    tools: list[dict] = []

    config: dict = {}
    if config_path.exists():
        try:
            with open(config_path, encoding="utf-8") as f:
                config = json.load(f)
        except Exception:
            pass

    # 1. MCP tools
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
                    "source": "mcp",
                    "enabled": True,
                }
            )

    # 2. Custom tools (from opencode.json "tools" section)
    for tool_key, tool_cfg in config.get("tools", {}).items():
        if isinstance(tool_cfg, dict):
            tools.append(
                {
                    "name": tool_cfg.get("name", tool_key),
                    "description": tool_cfg.get("description", ""),
                    "server": tool_cfg.get("mcpServer", ""),
                    "category": tool_cfg.get("category", ""),
                    "source": "custom",
                    "enabled": tool_cfg.get("enabled", True),
                }
            )

    # 3. Builtins
    tools.extend(BUILTIN_TOOLS)

    return tools


class ToolQueryService:
    """Business-logic facade for tool discovery and invocation.

    Public surface (3 methods, all sync): list_tools, get_tool, invoke_tool.
    """

    def __init__(self) -> None:
        self._tools: list[dict] | None = None
        self._loaded_at: float = 0.0

    def _ensure_loaded(self) -> list[dict]:
        now = time.monotonic()
        if self._tools is None or (now - self._loaded_at) > _CACHE_TTL:
            self._tools = _load_tools_from_opencode()
            self._loaded_at = now
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

    def reload(self):
        """Force reload from disk, ignoring TTL."""
        self._tools = None
        self._loaded_at = 0.0

    # ------------------------------------------------------------------
    # Tool invocation (v1 stub)
    # ------------------------------------------------------------------

    def invoke_tool(self, name: str) -> dict:
        """Stub: direct tool invocation is not implemented in v1."""
        return {"error": "Direct tool invocation not implemented in v1", "name": name}


__all__ = ["ToolQueryService"]
