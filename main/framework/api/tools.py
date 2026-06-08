"""Tools API — reads tool definitions from opencode.json MCP config."""

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/v1/tools", tags=["tools"])


def _load_tools_from_opencode() -> list[dict]:
    """Load tools from all enabled MCP servers in opencode.json."""
    config_path = Path(__file__).resolve().parents[3] / ".opencode" / "opencode.json"
    if not config_path.exists():
        return []
    with open(config_path, encoding="utf-8") as f:
        config = json.load(f)
    tools = []
    for server_name, server_cfg in config.get("mcp", {}).items():
        if not server_cfg.get("enabled", True):
            continue
        for tool in server_cfg.get("tools", []):
            tools.append({
                "name": tool["name"],
                "description": tool.get("description", ""),
                "server": server_name,
                "category": tool.get("category", ""),
            })
    return tools


# Load once at import time
TOOLS: list[dict] = _load_tools_from_opencode()


@router.get("")
async def list_tools():
    return TOOLS


@router.get("/{name}/invoke")
async def invoke_tool(name: str, **kwargs):
    return {"error": "Direct tool invocation not implemented in v1", "name": name}


@router.get("/{name}")
async def get_tool(name: str):
    for t in TOOLS:
        if t["name"] == name:
            return t
    raise HTTPException(status_code=404, detail="Tool not found")
