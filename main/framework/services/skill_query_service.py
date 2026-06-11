"""SkillQueryService — business logic for skill discovery and triggering.

Replaces the inline handlers + module-level ``SKILLS`` constant that previously
lived in ``api/skills.py``.  The service holds the static skill catalog as a
module-level constant (the catalog is intentionally hardcoded — it mirrors
the entries declared in ``.opencode/opencode.json``'s ``skills`` section and
is not yet backed by a database) and exposes a small surface to the
``controllers/skills.py`` HTTP layer.

Stub triggering
---------------
:meth:`trigger_skill` is intentionally a stub — actual skill execution is not
yet wired into the framework.  It preserves the legacy response shape
(``{"message": ..., "agents": ..., "params": ...}``) so existing clients keep
working unchanged.  A future iteration will dispatch through the workflow
engine.
"""

from __future__ import annotations

import logging

from main.framework.services.exceptions import NotFoundError

logger = logging.getLogger(__name__)


# Static catalog of available skills.  Each entry is a thin description used
# by the WebUI to render the skill picker; ``agents`` is the ordered list of
# agents the skill composes (matches the ``.opencode/opencode.json`` manifest).
SKILLS: list[dict] = [
    {
        "name": "market-briefing",
        "description": "Daily market snapshot - market/sector/sentiment/technical/macro",
        "agents": [
            "macro-scout",
            "sector-rotator",
            "sentiment-decoder",
            "technical-chartist",
        ],
    },
    {
        "name": "stock-deep",
        "description": "Deep stock analysis - technical/fundamental/sentiment/smart-money",
        "agents": [
            "technical-chartist",
            "fundamental-auditor",
            "sentiment-decoder",
            "smart-money-hound",
        ],
    },
    {
        "name": "fin-review",
        "description": "Weekly review - portfolio/risk/attribution",
        "agents": ["risk-gatekeeper", "fusion-brain", "macro-scout"],
    },
    {
        "name": "position-watch",
        "description": "Position monitoring - real-time risk monitoring",
        "agents": ["risk-gatekeeper", "smart-money-hound"],
    },
]


class SkillQueryService:
    """Business-logic facade for skill discovery and triggering.

    Public surface (2 methods, both sync):
      list_skills, trigger_skill

    No constructor dependencies — the skill catalog is module-level.
    """

    def __init__(self) -> None:
        # Reference (not copy) so tests can monkey-patch the catalog if needed.
        self._skills: list[dict] = SKILLS

    # ------------------------------------------------------------------
    # Skill discovery
    # ------------------------------------------------------------------

    def list_skills(self) -> list[dict]:
        """Return the full list of registered skills, in catalog order."""
        return list(self._skills)

    # ------------------------------------------------------------------
    # Skill triggering (v1 stub)
    # ------------------------------------------------------------------

    def trigger_skill(self, name: str, params: dict | None = None) -> dict:
        """Stub: trigger a skill by name.  Preserves the legacy response shape.

        Raises :class:`NotFoundError` if ``name`` does not match a registered
        skill.  Actual skill execution is not yet implemented — a future
        iteration will dispatch through the workflow engine and return an
        execution ID instead of the synchronous stub response.
        """
        for skill in self._skills:
            if skill["name"] == name:
                return {
                    "message": f"Skill {name} triggered",
                    "agents": skill["agents"],
                    "params": params or {},
                }
        raise NotFoundError(f"Skill {name} not found")


__all__ = ["SkillQueryService"]
