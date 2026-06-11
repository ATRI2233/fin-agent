"""Skills HTTP routes — thin handlers that delegate to SkillQueryService.

Routes (2): GET / (list), POST /{name}/trigger (v1 stub).
The re-export shim at ``api/skills.py`` re-publishes this ``router`` so
``main.py`` keeps working unchanged.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from main.framework.core.container import get_service
from main.framework.services.exceptions import NotFoundError
from main.framework.services.skill_query_service import SkillQueryService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/skills", tags=["skills"])


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
    """Trigger a skill by name (v1 stub — preserves the legacy response shape).

    Body is an optional ``{"params": ...}`` object forwarded verbatim to the
    service.  Raises 404 when the skill name is not registered.
    """
    try:
        return service.trigger_skill(name, params)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Skill not found") from err
