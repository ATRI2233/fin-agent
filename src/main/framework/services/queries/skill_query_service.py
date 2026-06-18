"""SkillQueryService — business logic for skill discovery and triggering.

Reads skill definitions from ``.opencode/skills/*/SKILL.md`` (filesystem
discovery) and exposes a small surface to ``controllers/skills.py``.

Caching: results are cached for ``_CACHE_TTL`` seconds. ``reload()`` forces
an immediate refresh.

Stub triggering: :meth:`trigger_skill` is intentionally a stub.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

from main.framework.services.exceptions import NotFoundError

logger = logging.getLogger(__name__)

_CACHE_TTL = 30 # seconds


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _parse_frontmatter(text: str) -> dict:
    """Extract YAML frontmatter delimited by '---' lines."""
    lines = text.strip().splitlines()
    if len(lines) < 2 or lines[0].strip() != "---":
        return {}
    end = -1
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end < 0:
        return {}
    meta: dict = {}
    for line in lines[1:end]:
        if ":" in line:
            key, _, val = line.partition(":")
            meta[key.strip()] = val.strip().strip('"').strip("'")
    return meta


def _load_skills() -> list[dict]:
    """Load skills from .opencode/skills/*/SKILL.md."""
    skills_dir = _project_root() / ".opencode" / "skills"
    skills: list[dict] = []

    if not skills_dir.is_dir():
        return skills

    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue
        try:
            content = skill_md.read_text(encoding="utf-8")
        except Exception:
            continue
        meta = _parse_frontmatter(content)
        name = meta.get("name", skill_dir.name)
        description = meta.get("description", "")

        # Parse agents list from content (look for "agents:" line)
        agents: list[str] = []
        for line in content.splitlines():
            stripped = line.strip()
            if stripped.startswith("agents:"):
                # Could be a YAML list or inline
                rest = stripped[len("agents:"):].strip()
                if rest.startswith("["):
                    # Inline list: [agent1, agent2]
                    agents = [a.strip().strip('"').strip("'") for a in rest.strip("[]").split(",") if a.strip()]
                break
            # Also handle indented list items under "agents:"
            if stripped.startswith("- ") and agents is not None:
                # This would be a continuation — skip for now
                pass

        # If no agents found in frontmatter, try parsing from body
        if not agents:
            in_agents = False
            for line in content.splitlines():
                stripped = line.strip()
                if stripped == "agents:":
                    in_agents = True
                    continue
                if in_agents:
                    if stripped.startswith("- "):
                        agents.append(stripped[2:].strip().strip('"').strip("'"))
                    elif stripped and not stripped.startswith("#"):
                        in_agents = False

        skills.append({
            "name": name,
            "description": description,
            "agents": agents,
            "file_path": str(skill_md),
        })

    return skills


class SkillQueryService:
    """Business-logic facade for skill discovery and triggering.

    Public surface (2 methods, both sync):
      list_skills, trigger_skill
    """

    def __init__(self) -> None:
        self._skills: list[dict] | None = None
        self._loaded_at: float = 0.0

    def _ensure_loaded(self) -> list[dict]:
        now = time.monotonic()
        if self._skills is None or (now - self._loaded_at) > _CACHE_TTL:
            self._skills = _load_skills()
            self._loaded_at = now
        return self._skills

    # ------------------------------------------------------------------
    # Skill discovery
    # ------------------------------------------------------------------

    def list_skills(self) -> list[dict]:
        """Return the full list of registered skills, in catalog order."""
        return list(self._ensure_loaded())

    def reload(self):
        """Force reload from disk, ignoring TTL."""
        self._skills = None
        self._loaded_at = 0.0

    # ------------------------------------------------------------------
    # Skill triggering (v1 stub)
    # ------------------------------------------------------------------

    def trigger_skill(self, name: str, params: dict | None = None) -> dict:
        """Stub: trigger a skill by name."""
        for skill in self._ensure_loaded():
            if skill["name"] == name:
                return {
                    "message": f"Skill {name} triggered",
                    "agents": skill["agents"],
                    "params": params or {},
                }
        raise NotFoundError(f"Skill {name} not found")


__all__ = ["SkillQueryService"]
