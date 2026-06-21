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

import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from src.main.api.deps import service_dep
from src.main.api.v1.config import _get_settings, _read_json_or_jsonc, _resolve_project_root, _write_json
from src.main.infra.api_envelope import ApiResponse
from src.main.infra.tracing import current_trace_id
from src.main.modules.agent.repo.agent_definition_repo import (
    FileSystemAgentDefinitionRepository,
)

router = APIRouter(prefix="/api/v1/agents", tags=["agents"])


def _agent_to_dict(agent: object) -> dict:
    """把 ``AgentDefinition`` 序列化为 dict，补充前端所需的默认值。"""
    name: str = getattr(agent, "name", "")
    path: str = str(getattr(agent, "path", ""))
    system_prompt: str = getattr(agent, "system_prompt", "")

    # description: 取 system_prompt 前 100 字符，若不存在则为空字符串
    description = system_prompt[:100] if system_prompt else ""

    # mode: 从文件名规则推断，包含 "subagent" 则为 subagent，否则 primary
    path_lower = path.lower()
    mode = "subagent" if "subagent" in path_lower else "primary"

    return {
        "name": name,
        "path": path,
        "system_prompt": system_prompt,
        "description": description,
        "mode": mode,
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


class BatchModelBody(BaseModel):
    model: str = Field(..., min_length=1, max_length=128)


@router.get("/models")
async def get_agent_models(request: Request) -> dict:
    """GET /api/v1/agents/models - 读所有agent的model配置。

    读 ``opencode.json``，提取 ``agent`` 字段中每个 agent 的 model。

    Returns:
        ``ApiResponse`` 信封，``data`` 为 ``{models: Record<string, string>}``。
    """
    settings = _get_settings(request)
    project_root = _resolve_project_root(settings)
    config_path = project_root / ".opencode" / "opencode.json"
    config = await asyncio.to_thread(_read_json_or_jsonc, config_path)
    agent_section = config.get("agent", {})
    models: dict[str, str] = {}
    if isinstance(agent_section, dict):
        for name, cfg in agent_section.items():
            if isinstance(cfg, dict) and isinstance(cfg.get("model"), str):
                models[name] = cfg["model"]
    return ApiResponse.success({"models": models}, current_trace_id()).to_dict()


@router.post("/batch-model")
async def batch_set_agent_model(
    body: BatchModelBody,
    request: Request,
) -> dict:
    """POST /api/v1/agents/batch-model - 批量设置所有agent的model。

    读 ``opencode.json``，给所有 agents 设置 model。

    Returns:
        ``ApiResponse`` 信封，``data`` 为 ``{success: boolean, agentCount: number}``。
    """
    settings = _get_settings(request)
    project_root = _resolve_project_root(settings)
    agents_dir = project_root / ".opencode" / "agents"

    def _list_md_files() -> list:
        if not agents_dir.exists():
            return []
        return [f for f in agents_dir.iterdir() if f.suffix == ".md"]

    agent_files = await asyncio.to_thread(_list_md_files)

    config_path = project_root / ".opencode" / "opencode.json"
    config = await asyncio.to_thread(_read_json_or_jsonc, config_path)

    if not isinstance(config.get("agent"), dict):
        config["agent"] = {}
    agent_section = config["agent"]

    agent_count = 0
    for f in agent_files:
        name = f.stem
        if not isinstance(agent_section.get(name), dict):
            agent_section[name] = {}
        agent_section[name]["model"] = body.model
        agent_count += 1

    await asyncio.to_thread(_write_json, config_path, config)
    return ApiResponse.success(
        {"success": True, "agentCount": agent_count},
        current_trace_id(),
    ).to_dict()


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
    if not name or ".." in name or "/" in name or "\\" in name or "\0" in name:
        raise HTTPException(status_code=422, detail=f"Invalid agent name: {name!r}")
    agent = repo.get(name)
    return ApiResponse.success(_agent_to_dict(agent), current_trace_id()).to_dict()
