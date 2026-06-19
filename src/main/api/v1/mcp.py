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

from fastapi import APIRouter, Depends, Query

from src.main.api.deps import service_dep
from src.main.infra.api_envelope import ApiResponse
from src.main.infra.domain import AgentReference
from src.main.infra.tracing import current_trace_id
from src.main.modules.mcp.protocol import ToolCatalog

router = APIRouter(prefix="/api/v1/mcp", tags=["mcp"])


@router.get("/tools")
async def list_tools(
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
async def list_servers(
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
async def list_allowed_tools(
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
