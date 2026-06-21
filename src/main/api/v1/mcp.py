"""API v1 MCP router — tool catalog endpoints.

TASK-408 §3.3.5 端点定义:
    - GET /api/v1/mcp/tools (list, by server/category)
    - GET /api/v1/mcp/servers
    - GET /api/v1/mcp/agents/{name}/allowed-tools

底层服务: ``ToolCatalog`` Protocol,实现为
``OpencodeJsonToolCatalog``(``modules/mcp/service/tool_query_service.py``)。

约定:
- 全部方法 sync(``ToolCatalog`` Protocol 全是 ``def``)。
- ``trace_id`` 取自 ``current_trace_id()``。
- 不吞异常(Do Not #3)。
"""

from __future__ import annotations

import asyncio
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from src.main.api.deps import service_dep
from src.main.api.v1.config import (
    _get_settings,
    _read_json_or_jsonc,
    _resolve_file_path,
    _resolve_project_root,
    _write_json,
)
from src.main.infra.api_envelope import ApiResponse
from src.main.infra.domain import AgentReference
from src.main.infra.tracing import current_trace_id
from src.main.modules.mcp.protocol import ToolCatalog

router = APIRouter(prefix="/api/v1/mcp", tags=["mcp"])

# ── File locks for RMW safety ──
# Per-path locks prevent TOCTOU races when multiple workers mutate the same
# opencode.json. Single-process threading.Lock is sufficient for FastAPI's
# multi-worker model when each worker serialises its own RMW; for true
# multi-process safety, fcntl.flock would be needed at the OS level.
_mcp_locks: dict[str, threading.Lock] = {}
_mcp_locks_guard = threading.Lock()


def _get_mcp_lock(path: Path) -> threading.Lock:
    """Return a per-path lock, creating it on first use."""
    key = str(path.resolve())
    with _mcp_locks_guard:
        lock = _mcp_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _mcp_locks[key] = lock
        return lock


# ── Pydantic schemas ──


class McpToolConfig(BaseModel):
    name: str
    description: str
    category: str | None = None


class McpServerConfig(BaseModel):
    type: str
    command: str | list[str]
    args: list[str] | None = None
    enabled: bool
    description: str | None = None
    env: dict[str, str] | None = None
    tools: list[McpToolConfig] | None = None


class McpMoveRequest(BaseModel):
    model_config = {"populate_by_name": True}
    from_: str = Field(..., alias="from")


# ── Helpers ──


async def _read_mcp_data(request: Request) -> tuple[dict[str, Any], Path]:
    """读取 opencode.json（自动发现 global → project），返回 (data, path)。"""
    settings = _get_settings(request)
    project_root = _resolve_project_root(settings)
    path, _ = await asyncio.to_thread(_resolve_file_path, "opencode", None, project_root)
    data = await asyncio.to_thread(_read_json_or_jsonc, path)
    return data, path



@router.get("/tools")
def list_tools(
    server: str | None = Query(default=None),
    category: str | None = Query(default=None),
    catalog: ToolCatalog = Depends(service_dep(ToolCatalog)),
) -> dict:
    """列出 MCP 工具,支持按 server / category 筛选。

    Args:
        server: 可选,按 server 精确筛选。
        category: 可选,按 category 精确筛选。
        catalog: ``ToolCatalog`` 注入。

    Returns:
        ``ApiResponse`` 信封,``data`` 为 ``ToolDescriptor`` 字典列表。
    """
    tools = catalog.list_tools(server=server, category=category)
    return ApiResponse.success(list(tools), current_trace_id()).to_dict()


@router.get("/servers")
def list_servers(
    catalog: ToolCatalog = Depends(service_dep(ToolCatalog)),
) -> dict:
    """列出所有 MCP server 及其工具。

    Args:
        catalog: ``ToolCatalog`` 注入。

    Returns:
        ``ApiResponse`` 信封,``data`` 为 ``ToolServerDescriptor`` 字典列表。
    """
    servers = catalog.list_servers()
    return ApiResponse.success(list(servers), current_trace_id()).to_dict()


@router.get("/agents/{name}/allowed-tools")
def list_allowed_tools(
    name: str,
    catalog: ToolCatalog = Depends(service_dep(ToolCatalog)),
) -> dict:
    """列出指定 Agent 被授权使用的 MCP 工具。

    Args:
        name: Agent 名称(``AgentReference.name``)。
        catalog: ``ToolCatalog`` 注入。

    Returns:
        ``ApiResponse`` 信封,``data`` 为允许工具的字典列表。
    """
    agent = AgentReference(name=name, definition_path=None)
    tools = catalog.list_allowed_for_agent(agent)
    return ApiResponse.success(list(tools), current_trace_id()).to_dict()


# ── Config endpoints (aligned with 9876 Express) ──


@router.get("")
async def list_mcp_servers(request: Request) -> dict:
    """GET /api/v1/mcp - list mcp servers.

    读取 opencode.json 的 mcp 字段，返回 Record<string, McpServerConfig> 裸字典。
    """
    data, _ = await _read_mcp_data(request)
    mcp = data.get("mcp", {})
    if not isinstance(mcp, dict):
        mcp = {}
    return ApiResponse.success(mcp, current_trace_id()).to_dict()


@router.put("/{name}")
async def upsert_mcp_server(name: str, body: McpServerConfig, request: Request) -> dict:
    """PUT /api/v1/mcp/:name - upsert mcp server."""
    data, path = await _read_mcp_data(request)
    mcp = data.get("mcp", {})
    if not isinstance(mcp, dict):
        mcp = {}
    config_dict = body.model_dump(exclude_none=True)
    mcp[name] = config_dict
    data["mcp"] = mcp
    await asyncio.to_thread(_write_json, path, data)
    return ApiResponse.success(
        {"success": True, "name": name, "config": config_dict},
        current_trace_id(),
    ).to_dict()


@router.delete("/{name}")
async def delete_mcp_server(name: str, request: Request) -> dict:
    """DELETE /api/v1/mcp/:name."""
    data, path = await _read_mcp_data(request)
    mcp = data.get("mcp", {})
    if not isinstance(mcp, dict):
        mcp = {}
    if name not in mcp:
        raise HTTPException(status_code=404, detail=f"MCP server '{name}' not found")
    del mcp[name]
    data["mcp"] = mcp
    await asyncio.to_thread(_write_json, path, data)
    return ApiResponse.success(
        {"success": True, "deleted": name},
        current_trace_id(),
    ).to_dict()


@router.post("/{name}/toggle")
async def toggle_mcp_server(name: str, request: Request) -> dict:
    """POST /api/v1/mcp/:name/toggle."""
    data, path = await _read_mcp_data(request)
    lock = _get_mcp_lock(path)
    with lock:
        # Re-read inside lock to avoid TOCTOU with concurrent deletes/upserts
        data = await asyncio.to_thread(_read_json_or_jsonc, path)
        mcp = data.get("mcp", {})
        if not isinstance(mcp, dict):
            mcp = {}
        if name not in mcp:
            raise HTTPException(status_code=404, detail=f"MCP server '{name}' not found")
        current_enabled = mcp[name].get("enabled", True)
        mcp[name]["enabled"] = not current_enabled
        data["mcp"] = mcp
        await asyncio.to_thread(_write_json, path, data)
    return ApiResponse.success(
        {"success": True, "name": name, "enabled": mcp[name]["enabled"]},
        current_trace_id(),
    ).to_dict()


@router.post("/{name}/move")
async def move_mcp_server(name: str, body: McpMoveRequest, request: Request) -> dict:
    """POST /api/v1/mcp/:name/move - move config reference across scopes."""
    from_scope = body.from_
    if from_scope not in ("global", "project"):
        raise HTTPException(status_code=400, detail="from must be 'global' or 'project'")

    settings = _get_settings(request)
    project_root = _resolve_project_root(settings)

    source_path, _ = await asyncio.to_thread(_resolve_file_path, "opencode", from_scope, project_root)
    to_scope = "project" if from_scope == "global" else "global"
    target_path, _ = await asyncio.to_thread(_resolve_file_path, "opencode", to_scope, project_root)

    # Lock both source and target paths in deterministic order to avoid
    # deadlocks when two concurrent moves swap between scopes.
    source_lock = _get_mcp_lock(source_path)
    target_lock = _get_mcp_lock(target_path)
    first, second = (
        (source_lock, target_lock) if str(source_path) <= str(target_path) else (target_lock, source_lock)
    )

    with first:
        with second:
            # Read source
            source_data = await asyncio.to_thread(_read_json_or_jsonc, source_path)
            source_mcp = source_data.get("mcp", {})
            if not isinstance(source_mcp, dict):
                source_mcp = {}

            if name not in source_mcp:
                raise HTTPException(
                    status_code=404, detail=f"MCP server '{name}' not found in {from_scope}"
                )

            config_to_move = source_mcp[name]
            del source_mcp[name]
            source_data["mcp"] = source_mcp
            await asyncio.to_thread(_write_json, source_path, source_data)

            # Write target
            target_data = await asyncio.to_thread(_read_json_or_jsonc, target_path)
            target_mcp = target_data.get("mcp", {})
            if not isinstance(target_mcp, dict):
                target_mcp = {}
            target_mcp[name] = config_to_move
            target_data["mcp"] = target_mcp
            await asyncio.to_thread(_write_json, target_path, target_data)

    return ApiResponse.success(
        {"success": True, "name": name, "to": to_scope},
        current_trace_id(),
    ).to_dict()
