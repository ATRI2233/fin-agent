"""API v1 agents router — list / get Agent definitions.

TASK-408 §3.3.4 端点定义:
    - GET  /api/v1/agents (list available)
    - GET  /api/v1/agents/{name} (get definition)

底层服务: ``FileSystemAgentDefinitionRepository``(sync),通过
``service_dep`` 注入;读 ``.opencode/agents/*.md``。

约定:
- ``trace_id`` 取自 ``current_trace_id()``。
- 不在 API 层 catch Exception(Do Not #3);``AgentNotFoundError``
  由 repo 抛 -> 走全局异常映射。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from src.main.api.deps import service_dep
from src.main.infra.api_envelope import ApiResponse
from src.main.infra.tracing import current_trace_id
from src.main.modules.agent.repo.agent_definition_repo import (
    FileSystemAgentDefinitionRepository,
)

router = APIRouter(prefix="/api/v1/agents", tags=["agents"])


def _agent_to_dict(agent: object) -> dict:
    """把 ``AgentDefinition`` 序列化为 dict。"""
    return {
        "name": getattr(agent, "name", ""),
        "path": str(getattr(agent, "path", "")),
        "system_prompt": getattr(agent, "system_prompt", ""),
    }


@router.get("")
async def list_agents(
    repo: FileSystemAgentDefinitionRepository = Depends(
        service_dep(FileSystemAgentDefinitionRepository)
    ),
) -> dict:
    """列出所有可用 Agent 定义。

    Args:
        repo: 文件系统 Agent 定义仓库,通过 ``service_dep`` 注入。

    Returns:
        ``ApiResponse`` 信封,``data`` 为 agent 字典列表。
    """
    items = repo.list_all()
    payload = [_agent_to_dict(a) for a in items]
    return ApiResponse.success(payload, current_trace_id()).to_dict()


@router.get("/{name}")
async def get_agent(
    name: str,
    repo: FileSystemAgentDefinitionRepository = Depends(
        service_dep(FileSystemAgentDefinitionRepository)
    ),
) -> dict:
    """按名称获取 Agent 定义。

    Args:
        name: Agent 名称(.md 文件 stem)。
        repo: 文件系统仓库注入。

    Returns:
        ``ApiResponse`` 信封,``data`` 为单个 agent 字典。

    Raises:
        AgentNotFoundError: 对应 .md 不存在(由 repo 抛出)。
    """
    if not name or ".." in name or "/" in name or "\\" in name:
        raise HTTPException(status_code=422, detail=f"Invalid agent name: {name!r}")
    agent = repo.get(name)
    return ApiResponse.success(_agent_to_dict(agent), current_trace_id()).to_dict()
