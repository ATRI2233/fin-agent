"""Skills HTTP routes — thin handlers that delegate to SkillQueryService.

Routes:
  GET    ""                  (list_skills)
  POST   "/{name}/trigger"  (trigger_skill, v1 stub)
  GET    "/{name}/content"  (get_skill_content)
  PUT    "/{name}/content"  (create_or_update_skill)
  DELETE "/{name}"          (delete_skill)
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from main.framework.core.infrastructure.container import get_service
from main.framework.services.exceptions import NotFoundError
from main.framework.services.skill_query_service import SkillQueryService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/skills", tags=["skills"])


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _skills_dir() -> Path:
    return _project_root() / ".opencode" / "skills"


@router.get("")
async def list_skills(
    service: SkillQueryService = Depends(get_service(SkillQueryService)),
):
    """List all registered skills (catalog order)."""
    return service.list_skills()


@router.post("/{name}/trigger")
async def trigger_skill(
    name: str,
    params: dict | None = Body(default=None),
    service: SkillQueryService = Depends(get_service(SkillQueryService)),
):
    """Trigger a skill by name (v1 stub)."""
    try:
        return service.trigger_skill(name, params)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Skill not found") from err


@router.get("/{name}/content")
async def get_skill_content(name: str):
    """Get skill markdown content from .opencode/skills/{name}/SKILL.md."""
    skill_md = _skills_dir() / name / "SKILL.md"
    if not skill_md.exists():
        raise HTTPException(status_code=404, detail="Skill file not found")
    try:
        content = skill_md.read_text(encoding="utf-8")
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err
    return PlainTextResponse(content)


@router.put("/{name}/content")
async def create_or_update_skill(
    name: str,
    content: str = Body(..., media_type="text/plain"),
):
    """Create or update a skill SKILL.md file."""
    skill_dir = _skills_dir() / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    skill_md = skill_dir / "SKILL.md"
    try:
        skill_md.write_text(content, encoding="utf-8")
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err

    # Reload skill service cache
    from main.framework.core.infrastructure.container import get_container
    container = get_container()
    svc = container.skill_query_service
    if hasattr(svc, "reload"):
        svc.reload()

    return {"success": True, "name": name, "path": str(skill_md)}


@router.delete("/{name}")
async def delete_skill(name: str):
    """Delete a skill directory."""
    import shutil
    skill_dir = _skills_dir() / name
    if skill_dir.exists():
        shutil.rmtree(skill_dir)

    # Reload skill service cache
    from main.framework.core.infrastructure.container import get_container
    container = get_container()
    svc = container.skill_query_service
    if hasattr(svc, "reload"):
        svc.reload()

    return {"success": True, "deleted": name}
