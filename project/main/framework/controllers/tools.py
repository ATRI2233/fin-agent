"""Tools HTTP routes — thin handlers that delegate to ToolQueryService.

Routes (3): GET / (list), GET /{name} (get), GET /{name}/invoke (v1 stub).
The re-export shim at ``api/tools.py`` re-publishes this ``router`` so
``main.py`` keeps working unchanged.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from main.framework.core.container import get_service
from main.framework.services.exceptions import NotFoundError
from main.framework.services.tool_query_service import ToolQueryService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/tools", tags=["tools"])


@router.get("")
async def list_tools(
    service: ToolQueryService = Depends(get_service(ToolQueryService)),
):
    """List all enabled tools (manifest order, all enabled MCP servers)."""
    return service.list_tools()


@router.get("/{name}")
async def get_tool(
    name: str,
    service: ToolQueryService = Depends(get_service(ToolQueryService)),
):
    """Get a single tool by name. 404 if it does not exist."""
    try:
        return service.get_tool(name)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Tool not found") from err


@router.get("/{name}/invoke")
async def invoke_tool(
    name: str,
    service: ToolQueryService = Depends(get_service(ToolQueryService)),
):
    """Invoke a tool (v1 stub — returns the legacy error shape)."""
    return service.invoke_tool(name)
