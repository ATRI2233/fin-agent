"""Agent HTTP routes — thin handlers that delegate to AgentQueryService.

Routes:
  GET "" (list_agents)
  GET "/stats" (agent_stats)
  GET "/{name}" (get_agent)
  GET "/{name}/content" (get_agent_content)
  PUT "/{name}" (create_or_update_agent)
  DELETE "/{name}" (delete_agent)
  GET "/{name}/tools-whitelist" (get_tools_whitelist)
  PUT "/{name}/tools-whitelist" (update_tools_whitelist)
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from main.framework.core.infrastructure.container import get_service
from main.framework.repositories.execution_repo import ExecutionRepository
from main.framework.services.agent_query_service import AgentQueryService
from main.framework.services.exceptions import NotFoundError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/agents", tags=["agents"])


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _agents_dir() -> Path:
    return _project_root() / ".opencode" / "agents"


def _config_path() -> Path:
    return _project_root() / ".opencode" / "opencode.json"


def _read_config() -> dict:
    p = _config_path()
    if p.exists():
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _write_config(config: dict):
    p = _config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("")
async def list_agents(
    service: AgentQueryService = Depends(get_service(AgentQueryService)),
):
    """List all registered agents."""
    return service.list_agents()


@router.get("/stats")
async def agent_stats(
    exec_repo: ExecutionRepository = Depends(get_service(ExecutionRepository)),
    service: AgentQueryService = Depends(get_service(AgentQueryService)),
):
    """Agent usage stats from workflow execution nodes."""
    with exec_repo._session() as db:
        return service.agent_stats(db)


@router.get("/{name}")
async def get_agent(
    name: str,
    service: AgentQueryService = Depends(get_service(AgentQueryService)),
):
    """Get agent details by name."""
    try:
        return service.get_by_name(name)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Agent not found") from err


@router.get("/{name}/content")
async def get_agent_content(name: str):
    """Get agent markdown content from .opencode/agents/{name}.md."""
    md_path = _agents_dir() / f"{name}.md"
    if not md_path.exists():
        raise HTTPException(status_code=404, detail="Agent file not found")
    try:
        content = md_path.read_text(encoding="utf-8")
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err
    return PlainTextResponse(content)


@router.put("/{name}")
async def create_or_update_agent(
    name: str,
    content: str = Body(..., media_type="text/plain"),
):
    """Create or update an agent .md file."""
    agents_dir = _agents_dir()
    agents_dir.mkdir(parents=True, exist_ok=True)
    md_path = agents_dir / f"{name}.md"
    try:
        md_path.write_text(content, encoding="utf-8")
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err

    # Reload registry so the new agent is immediately visible
    from main.framework.core.agents.agent_registry import registry
    registry.reload()

    return {"success": True, "name": name, "path": str(md_path)}


@router.delete("/{name}")
async def delete_agent(name: str):
    """Delete an agent .md file and its config entry."""
    md_path = _agents_dir() / f"{name}.md"
    if md_path.exists():
        md_path.unlink()

    # Clean up opencode.json agent entry
    config = _read_config()
    if name in config.get("agent", {}):
        del config["agent"][name]
        _write_config(config)

    # Reload registry
    from main.framework.core.agents.agent_registry import registry
    registry.reload()

    return {"success": True, "deleted": name}


@router.get("/{name}/tools-whitelist")
async def get_tools_whitelist(name: str):
    """Get the tools whitelist for an agent from opencode.json."""
    config = _read_config()
    agent_cfg = config.get("agent", {}).get(name, {})
    tools_map = agent_cfg.get("tools", {})
    allowed = [k for k, v in tools_map.items() if k != "*" and v is True]
    return {"name": name, "tools_whitelist": allowed}


@router.put("/{name}/tools-whitelist")
async def update_tools_whitelist(
    name: str,
    body: dict = Body(...),
):
    """Update the tools whitelist for an agent in opencode.json."""
    whitelist = body.get("tools_whitelist", [])
    config = _read_config()
    if "agent" not in config:
        config["agent"] = {}
    if name not in config["agent"]:
        config["agent"][name] = {}

    # Build tools map: all whitelisted tools = true, * = false
    tools_map: dict = {"*": False}
    for tool_name in whitelist:
        tools_map[tool_name] = True
    config["agent"][name]["tools"] = tools_map
    _write_config(config)

    # Reload registry
    from main.framework.core.agents.agent_registry import registry
    registry.reload()

    return {"success": True, "name": name, "tools_whitelist": whitelist}
