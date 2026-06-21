"""API v1 tools router — 暴露 9876 Express 同款 tools 接口到 8000 FastAPI。

对齐 ``src/webui/server/tools.ts`` 的字段形状，使前端 ``useOpencodeTools``
可以无差别地走 8000 端口（或切换到 9876，数据一致）。

端点:
    - GET  /api/v1/tools
        返回 ``Record<string, ToolConfig>`` (opencode.json 的 ``tools`` 字段)
    - PUT  /api/v1/tools/{name}
        body: ToolConfig。读 opencode.json，合并 ``tools[name]``，写回。
        返回 ``{ success: bool, name: str, config: ToolConfig }``
    - GET  /api/v1/tools/allowed
        返回 ``list[str]``，当前所有 Agent 被授权的工具全名集合（去重）。
    - GET  /api/v1/tools/servers
        返回 ``list[str]``，所有 MCP server 的名称列表。
    - GET  /api/v1/tools/allowed-tools
        返回 ``list[dict]``，每个工具含 ``name`` / ``server`` / ``description``
        字段（仅列至少被一个 Agent 允许使用的工具）。

约定:
- ``trace_id`` 取自 ``current_trace_id()``。
- 文件读写异常由全局异常处理器统一包装，不在 API 层 catch 通用 Exception。
"""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
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
from src.main.infra.tracing import current_trace_id
from src.main.modules.mcp.protocol import ToolCatalog

router = APIRouter(prefix="/api/v1/tools", tags=["tools"])


# ── Pydantic schemas ──


class ToolConfig(BaseModel):
    """工具配置结构。

    对应 ``9876-shape-snapshot.md`` 中的 ToolConfig 定义。
    """

    name: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_\-\.]+$")
    description: str | None = Field(default=None, max_length=500)
    enabled: bool
    source: Literal["builtin", "mcp", "custom"]
    mcpServer: str | None = Field(default=None, max_length=500)


class ToolUpdateResult(BaseModel):
    """更新工具配置响应结构。"""

    success: bool
    name: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_\-\.]+$")
    config: ToolConfig


# ── Endpoints ──


@router.get("")
async def get_tools(request: Request) -> dict:
    """GET /api/v1/tools - 读 opencode.json tools 字段。

    Returns:
        ``ApiResponse`` 信封，``data`` 为 ``Record<string, ToolConfig>``。
    """
    settings = _get_settings(request)
    project_root = _resolve_project_root(settings)
    target_path, _source = await asyncio.to_thread(_resolve_file_path, "opencode", None, project_root)
    data = await asyncio.to_thread(_read_json_or_jsonc, target_path)
    tools = data.get("tools")
    if not isinstance(tools, dict):
        tools = {}
    return ApiResponse.success(tools, current_trace_id()).to_dict()


@router.put("/{name}")
async def update_tool(name: str, body: ToolConfig, request: Request) -> dict:
    """PUT /api/v1/tools/:name - 更新/新增工具配置。

    Args:
        name: 工具名称（路径参数），非空校验。
        body: 工具配置请求体。

    Returns:
        ``ApiResponse`` 信封，``data`` 为
        ``{ success: True, name: str, config: ToolConfig }``。
    """
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="Tool name is required")

    settings = _get_settings(request)
    project_root = _resolve_project_root(settings)
    target_path, _source = await asyncio.to_thread(_resolve_file_path, "opencode", None, project_root)
    data = await asyncio.to_thread(_read_json_or_jsonc, target_path)

    # 确保 tools 字段存在且为 dict
    if not isinstance(data.get("tools"), dict):
        data["tools"] = {}

    # 合并配置，强制使用路径参数中的 name（与 Express 行为一致）
    merged_config = {**body.model_dump(), "name": name}
    data["tools"][name] = merged_config
    await asyncio.to_thread(_write_json, target_path, data)

    result = ToolUpdateResult(
        success=True,
        name=name,
        config=ToolConfig.model_validate(merged_config),
    )
    return ApiResponse.success(result.model_dump(), current_trace_id()).to_dict()


# ── Catalog-derived endpoints ──


async def _collect_allowed_names_from_config(request: Request) -> set[str]:
    """直接读 opencode.json 的 ``agent.*.tools`` 字段,汇总所有被允许的工具全名。

    这是 ``tools/allowed`` 和 ``tools/allowed-tools`` 的统一数据源,避免
    对未知 Agent 名称做枚举。

    Args:
        request: FastAPI 请求对象,用于解析 settings。

    Returns:
        去重后的工具全名集合。
    """
    settings = _get_settings(request)
    project_root = _resolve_project_root(settings)
    target_path, _source = await asyncio.to_thread(_resolve_file_path, "opencode", None, project_root)
    data = await asyncio.to_thread(_read_json_or_jsonc, target_path)
    agent_section = data.get("agent", {})
    if not isinstance(agent_section, dict):
        return set()
    allowed: set[str] = set()
    for _agent_name, agent_dict in agent_section.items():
        if not isinstance(agent_dict, dict):
            continue
        tools_allowlist = agent_dict.get("tools", {})
        if not isinstance(tools_allowlist, dict):
            continue
        for tool_full_name, flag in tools_allowlist.items():
            if flag is True:
                allowed.add(tool_full_name)
    return allowed


@router.get("/allowed")
async def list_allowed_tools(request: Request) -> dict:
    """GET /api/v1/tools/allowed - 列出当前所有 Agent 被允许的工具全名（去重）。

    数据来源: opencode.json 的 ``agent.*.tools`` 字段。

    Returns:
        ``ApiResponse`` 信封，``data`` 为 ``list[str]``（已排序）。
    """
    allowed = await _collect_allowed_names_from_config(request)
    return ApiResponse.success(sorted(allowed), current_trace_id()).to_dict()


@router.get("/servers")
async def list_tool_servers(
    catalog: ToolCatalog = Depends(service_dep(ToolCatalog)),
) -> dict:
    """GET /api/v1/tools/servers - 列出所有 MCP server 名称。

    数据来源: ``ToolCatalog.list_servers()``。

    Returns:
        ``ApiResponse`` 信封，``data`` 为 ``list[str]``（server 名,已排序）。
    """
    servers = catalog.list_servers()
    names = sorted({srv["name"] for srv in servers})
    return ApiResponse.success(names, current_trace_id()).to_dict()


@router.get("/allowed-tools")
async def list_allowed_tools_detailed(
    request: Request,
    catalog: ToolCatalog = Depends(service_dep(ToolCatalog)),
) -> dict:
    """GET /api/v1/tools/allowed-tools - 详细列出所有被允许的工具元数据。

    数据来源: ``opencode.json`` 的 ``agent.*.tools`` 白名单 ∩
    ``ToolCatalog`` 中的所有工具集合。每个 tool 字典包含
    ``name`` / ``server`` / ``description`` 三个字段。

    Returns:
        ``ApiResponse`` 信封，``data`` 为 ``list[dict]``。
    """
    allowed = await _collect_allowed_names_from_config(request)
    if not allowed:
        return ApiResponse.success([], current_trace_id()).to_dict()
    # 构造 (server, tool_name) → description 反查表
    desc_map: dict[tuple[str, str], str] = {}
    for srv in catalog.list_servers():
        srv_name = srv["name"]
        for tool in srv["tools"]:
            desc_map[(srv_name, tool["name"])] = tool["description"]
    result: list[dict] = []
    for full_name in sorted(allowed):
        # 全名格式 {server}_{tool_name};若 server 名含下划线,切分取首段
        if "_" not in full_name:
            continue
        server_name, tool_name = full_name.split("_", 1)
        description = desc_map.get((server_name, tool_name), "")
        result.append(
            {
                "name": full_name,
                "server": server_name,
                "description": description,
            }
        )
    return ApiResponse.success(result, current_trace_id()).to_dict()
