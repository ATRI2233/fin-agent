"""API v1 skills router — exposes aggregated skill metadata on FastAPI 8000.

Mirrors the surface of ``src/webui/server/skills.ts`` so the dashboard
(or any other consumer) can read skills without a second hop through
the Express proxy at 9876. Keeping the read path inside FastAPI also
means responses always carry the standard ``ApiResponse`` envelope and
the dashboard no longer has to do a chain-fetch
(``/v1/config/scope`` → ``/skills?scope=...``) just to render a count.

Endpoints:
    - GET /api/v1/skills/count?scope=global|project
        Returns ``{count: int, scope: str}``. ``scope`` defaults to the
        active skills scope stored in ``.opencode/.scope_prefs.json``
        (falling back to ``"project"`` when the prefs file is missing).
    - GET /api/v1/skills?scope=global|project
        Returns the full skill metadata array (same shape as the
        Express endpoint) for clients that want more than a count.

Scope semantics match ``webui/server/skills.ts#getSkillsForScope``:
    - ``global``: read the ``skills`` section of the global opencode
      config (``~/.config/opencode/opencode.json``).
    - ``project``: prefer the ``skills`` section of
      ``{project_root}/.opencode/opencode.json``; fall back to scanning
      ``{project_root}/.opencode/skills/<name>/SKILL.md`` directories
      when the config section is absent or empty.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Literal

import yaml
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from src.main.infra.api_envelope import ApiResponse
from src.main.infra.settings import Settings
from src.main.infra.tracing import current_trace_id

# Re-use the helpers already exposed by config.py so the project-root
# resolution rules stay in lockstep with the rest of the FastAPI API.
from src.main.api.v1.config import (
    _global_config_dir,
    _read_json_or_jsonc,
    _resolve_project_root,
    _write_json,
)

router = APIRouter(prefix="/api/v1/skills", tags=["skills"])

Scope = Literal["global", "project"]
_DEFAULT_SCOPE: Scope = "project"


# ── File locks for RMW safety ──
# Per-path locks serialise read-modify-write operations on opencode.json
# (both global and project copies) so concurrent toggles/moves do not
# lose updates. A process-wide guard protects the registry itself.
_skills_locks: dict[str, threading.Lock] = {}
_skills_locks_guard = threading.Lock()


def _get_skills_lock(path: Path) -> threading.Lock:
    """Return a per-path lock for skill config files."""
    key = str(path.resolve())
    with _skills_locks_guard:
        lock = _skills_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _skills_locks[key] = lock
        return lock


# ── Pydantic schemas ──


class SkillContentUpdate(BaseModel):
    content: str


class SkillMoveBody(BaseModel):
    model_config = {"populate_by_name": True}
    from_: str = Field(alias="from")


# ── Frontmatter + skill listing (Python port of skills.ts) ──


def _parse_frontmatter(content: str) -> dict[str, str]:
    """Parse YAML frontmatter from a ``SKILL.md`` body.

    Mirrors ``parseFrontmatter`` in ``webui/server/skills.ts``: only the
    ``---`` delimited block at the top of the file is read, and we
    tolerate CRLF line endings plus BOM-less UTF-8 input. Falls back
    to an empty dict when no frontmatter block is present.
    """
    lines = content.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    end = None
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            end = idx
            break
    if end is None:
        return {}
    block = "\n".join(lines[1:end])
    try:
        parsed = yaml.safe_load(block) or {}
    except yaml.YAMLError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in parsed.items():
        if isinstance(v, str):
            out[k] = v
    return out


def _read_skill_file(path: Path, fallback_name: str) -> dict[str, object]:
    """Read a skill file at ``path`` and return its metadata dict.

    Missing or unreadable files yield a minimal record so callers can
    still count them. The shape matches ``SkillMeta`` from the Express
    side: ``{name, description, filePath, enabled}``.
    """
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return {
            "name": fallback_name,
            "description": "",
            "filePath": str(path),
            "enabled": True,
        }
    fm = _parse_frontmatter(content)
    return {
        "name": fm.get("name") or fallback_name,
        "description": fm.get("description", ""),
        "filePath": str(path),
        "enabled": True,
    }


def _read_configured_skills(
    config_path: Path,
    scope: Scope,
) -> list[dict[str, object]]:
    """Read the ``skills`` section of a config file (project or global).

    Each entry is expected to look like
    ``{"path": "/abs/path/SKILL.md", "disabled": false}`` (matching the
    shape ``webui/server/skills.ts#getGlobalSkillsFromConfig`` reads).
    Entries that point to non-existent files are silently skipped so a
    count always reflects the actually-materialized skill set.
    """
    if not config_path.exists():
        return []
    data = _read_json_or_jsonc(config_path)
    section = data.get("skills")
    if not isinstance(section, dict):
        return []
    out: list[dict[str, object]] = []
    for skill_name, entry in section.items():
        if not isinstance(entry, dict):
            continue
        skill_path = entry.get("path")
        if not isinstance(skill_path, str) or not Path(skill_path).exists():
            continue
        meta = _read_skill_file(Path(skill_path), skill_name)
        meta["enabled"] = entry.get("disabled") is not True
        out.append(meta)
    return out


def _scan_project_skills_dir(project_root: Path) -> list[dict[str, object]]:
    """Scan ``{project_root}/.opencode/skills/<name>/SKILL.md`` directories."""
    skills_dir = project_root / ".opencode" / "skills"
    if not skills_dir.is_dir():
        return []
    out: list[dict[str, object]] = []
    for child in sorted(skills_dir.iterdir()):
        if not child.is_dir():
            continue
        skill_md = child / "SKILL.md"
        if not skill_md.is_file():
            continue
        out.append(_read_skill_file(skill_md, child.name))
    return out


def _list_skills(scope: Scope, project_root: Path) -> list[dict[str, object]]:
    """Return skill metadata for the given scope (Python port of
    ``getSkillsForScope`` in ``webui/server/skills.ts``).

    The global scope always reads ``~/.config/opencode/opencode.json``;
    the project scope prefers the project-level opencode.json skills
    section and falls back to scanning the ``.opencode/skills/`` dir.
    """
    if scope == "global":
        return _read_configured_skills(
            _global_config_dir() / "opencode.json",
            scope,
        )

    project_cfg = project_root / ".opencode" / "opencode.json"
    configured = _read_configured_skills(project_cfg, scope)
    if configured:
        return configured
    return _scan_project_skills_dir(project_root)


def _resolve_scope(request: Request, scope: Scope | None) -> Scope:
    """Resolve the effective scope.

    Honors the explicit query param first, then falls back to the
    active skills scope stored in ``.opencode/.scope_prefs.json``
    (the same file the Express ``/api/config/scope`` endpoint reads),
    and finally defaults to ``"project"``.
    """
    if scope is not None:
        return scope
    settings: Settings = request.app.state.settings
    project_root = _resolve_project_root(settings)
    prefs = _read_json_or_jsonc(project_root / ".opencode" / ".scope_prefs.json")
    raw = prefs.get("skills") if isinstance(prefs, dict) else None
    return raw if raw in ("global", "project") else _DEFAULT_SCOPE


# ── Additional helpers ──


def _safe_name(name: str) -> bool:
    """Security: validate name to prevent path traversal."""
    return (
        bool(name)
        and ".." not in name
        and "/" not in name
        and "\\" not in name
        and "\0" not in name
    )


def _resolve_skill_path(
    name: str,
    scope: str,
    project_root: Path,
) -> Path | None:
    """Resolve the SKILL.md path for a skill by name and scope.

    Mirrors ``resolveSkillPath`` in ``webui/server/skills.ts``.
    """
    if scope == "global":
        config_path = _global_config_dir() / "opencode.json"
        if not config_path.exists():
            return None
        data = _read_json_or_jsonc(config_path)
        section = data.get("skills")
        if not isinstance(section, dict):
            return None
        entry = section.get(name)
        if not isinstance(entry, dict):
            return None
        skill_path = entry.get("path")
        if isinstance(skill_path, str):
            p = Path(skill_path)
            if p.exists():
                return p
        return None

    # Project scope: check .opencode/skills/<name>/SKILL.md
    skill_md = project_root / ".opencode" / "skills" / name / "SKILL.md"
    return skill_md if skill_md.is_file() else None


def _read_skill_from_path(path: Path, name: str) -> dict[str, str]:
    """Read skill content from a given file path.

    Mirrors ``readSkillFromPath`` in ``webui/server/skills.ts``.
    """
    content = path.read_text(encoding="utf-8")
    fm = _parse_frontmatter(content)
    return {
        "name": fm.get("name") or name,
        "content": content,
        "description": fm.get("description", ""),
    }


# ── Endpoints ──


@router.get("/count")
def get_skills_count(
    request: Request,
    scope: Scope | None = Query(default=None, description="global | project;省略时读 scope_prefs"),
) -> dict:
    """Return the number of skills in the given (or active) scope.

    Used by the Dashboard's stat card so it does not need to chain
    ``/v1/config/scope`` + ``/skills?scope=...``. The response is a
    small envelope ``{count, scope}`` — easy to memoize on the client.
    """
    effective_scope = _resolve_scope(request, scope)
    settings: Settings = request.app.state.settings
    project_root = _resolve_project_root(settings)
    count = len(_list_skills(effective_scope, project_root))
    payload = {"count": count, "scope": effective_scope}
    return ApiResponse.success(payload, current_trace_id()).to_dict()


@router.get("")
def list_skills(
    request: Request,
    scope: Scope | None = Query(default=None, description="global | project;省略时读 scope_prefs"),
) -> dict:
    """Return the full skill metadata list for the given scope.

    The shape mirrors the Express endpoint so existing frontend pages
    that consume ``/api/skills?scope=...`` could be re-pointed at this
    FastAPI route without further changes. (Dashboard itself still uses
    the Express route for the full list — this endpoint is provided
    for symmetry and future migration.)
    """
    effective_scope = _resolve_scope(request, scope)
    settings: Settings = request.app.state.settings
    project_root = _resolve_project_root(settings)
    skills = _list_skills(effective_scope, project_root)
    return ApiResponse.success(
        {"skills": skills},
        current_trace_id(),
    ).to_dict()


@router.get("/{name}/content")
def get_skill_content(
    request: Request,
    name: str,
    scope: Scope | None = Query(default=None, description="global | project; 省略时读 scope_prefs"),
) -> dict:
    """GET /api/v1/skills/:name/content?scope=..."""
    if not _safe_name(name):
        raise HTTPException(status_code=400, detail="Invalid skill name")

    effective_scope = _resolve_scope(request, scope)
    settings: Settings = request.app.state.settings
    project_root = _resolve_project_root(settings)

    skill_path = _resolve_skill_path(name, effective_scope, project_root)
    if skill_path is None:
        raise HTTPException(
            status_code=404,
            detail=f"Skill '{name}' not found in {effective_scope} scope",
        )

    result = _read_skill_from_path(skill_path, name)
    return ApiResponse.success(result, current_trace_id()).to_dict()


@router.put("/{name}/content")
def update_skill_content(
    request: Request,
    name: str,
    body: SkillContentUpdate,
    scope: Scope | None = Query(default=None, description="global | project; 省略时读 scope_prefs"),
) -> dict:
    """PUT /api/v1/skills/:name/content?scope=..."""
    if not _safe_name(name):
        raise HTTPException(status_code=400, detail="Invalid skill name")

    effective_scope = _resolve_scope(request, scope)
    settings: Settings = request.app.state.settings
    project_root = _resolve_project_root(settings)

    if not body.content:
        raise HTTPException(status_code=400, detail="Content is required")

    if effective_scope == "global":
        config_path = _global_config_dir() / "opencode.json"
        if not config_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Global skill '{name}' not found in config",
            )
        data = _read_json_or_jsonc(config_path)
        section = data.get("skills")
        if not isinstance(section, dict):
            raise HTTPException(
                status_code=404,
                detail=f"Global skill '{name}' not found in config",
            )
        entry = section.get(name)
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            raise HTTPException(
                status_code=404,
                detail=f"Global skill '{name}' not found in config",
            )
        skill_path = Path(entry["path"])
    else:
        skill_dir = project_root / ".opencode" / "skills" / name
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_path = skill_dir / "SKILL.md"

    skill_path.write_text(body.content, encoding="utf-8")
    return ApiResponse.success(
        {"success": True, "name": name, "path": str(skill_path)},
        current_trace_id(),
    ).to_dict()


@router.post("/{name}/toggle")
def toggle_skill(
    request: Request,
    name: str,
    scope: Scope | None = Query(default=None, description="global | project; 省略时读 scope_prefs"),
) -> dict:
    """POST /api/v1/skills/:name/toggle?scope=..."""
    if not _safe_name(name):
        raise HTTPException(status_code=400, detail="Invalid skill name")

    effective_scope = _resolve_scope(request, scope)
    settings: Settings = request.app.state.settings
    project_root = _resolve_project_root(settings)

    enabled = True

    if effective_scope == "global":
        config_path = _global_config_dir() / "opencode.json"
        lock = _get_skills_lock(config_path)
        with lock:
            data = _read_json_or_jsonc(config_path)
            section = data.get("skills")
            if not isinstance(section, dict):
                section = {}
                data["skills"] = section
            entry = section.get(name)
            if isinstance(entry, dict):
                entry["disabled"] = not entry.get("disabled", False)
                enabled = not entry["disabled"]
            else:
                section[name] = {"disabled": False}
                enabled = True
            _write_json(config_path, data)
    else:
        config_path = project_root / ".opencode" / "opencode.json"
        if config_path.exists():
            lock = _get_skills_lock(config_path)
            with lock:
                # Re-read inside lock to avoid TOCTOU with concurrent toggles
                data = _read_json_or_jsonc(config_path)
                section = data.get("skills")
                if isinstance(section, dict):
                    entry = section.get(name)
                    if isinstance(entry, dict):
                        entry["disabled"] = not entry.get("disabled", False)
                        enabled = not entry["disabled"]
                _write_json(config_path, data)

    return ApiResponse.success(
        {"success": True, "name": name, "enabled": enabled},
        current_trace_id(),
    ).to_dict()


@router.post("/{name}/move")
def move_skill(
    request: Request,
    name: str,
    body: SkillMoveBody,
) -> dict:
    """POST /api/v1/skills/:name/move"""
    if not _safe_name(name):
        raise HTTPException(status_code=400, detail="Invalid skill name")

    from_scope = body.from_
    if from_scope not in ("global", "project"):
        raise HTTPException(status_code=400, detail="Invalid 'from' scope")

    settings: Settings = request.app.state.settings
    project_root = _resolve_project_root(settings)

    if from_scope == "global":
        # Remove from global config, add to project
        global_path = _global_config_dir() / "opencode.json"
        global_data = _read_json_or_jsonc(global_path)
        section = global_data.get("skills")
        skill_path = ""
        if isinstance(section, dict):
            entry = section.get(name)
            if isinstance(entry, dict) and isinstance(entry.get("path"), str):
                skill_path = entry["path"]
            section.pop(name, None)
        _write_json(global_path, global_data)

        project_cfg_path = project_root / ".opencode" / "opencode.json"
        project_data = _read_json_or_jsonc(project_cfg_path)
        if not isinstance(project_data.get("skills"), dict):
            project_data["skills"] = {}
        project_data["skills"][name] = {"path": skill_path, "disabled": False}
        _write_json(project_cfg_path, project_data)

        return ApiResponse.success(
            {"success": True, "name": name, "to": "project"},
            current_trace_id(),
        ).to_dict()
    else:
        # Remove from project config, add to global
        project_cfg_path = project_root / ".opencode" / "opencode.json"
        project_data = _read_json_or_jsonc(project_cfg_path)
        section = project_data.get("skills")
        skill_path = ""
        if isinstance(section, dict):
            entry = section.get(name)
            if isinstance(entry, dict) and isinstance(entry.get("path"), str):
                skill_path = entry["path"]
            section.pop(name, None)
        _write_json(project_cfg_path, project_data)

        # Fallback: if no path found, use project skills dir
        if not skill_path:
            fallback = project_root / ".opencode" / "skills" / name / "SKILL.md"
            if fallback.is_file():
                skill_path = str(fallback)

        global_path = _global_config_dir() / "opencode.json"
        global_data = _read_json_or_jsonc(global_path)
        if not isinstance(global_data.get("skills"), dict):
            global_data["skills"] = {}
        global_data["skills"][name] = {"path": skill_path, "disabled": False}
        _write_json(global_path, global_data)

        return ApiResponse.success(
            {"success": True, "name": name, "to": "global"},
            current_trace_id(),
        ).to_dict()


@router.delete("/{name}")
def delete_skill(
    request: Request,
    name: str,
    scope: Scope | None = Query(default=None, description="global | project; 省略时读 scope_prefs"),
) -> dict:
    """DELETE /api/v1/skills/:name?scope=..."""
    if not _safe_name(name):
        raise HTTPException(status_code=400, detail="Invalid skill name")

    effective_scope = _resolve_scope(request, scope)
    settings: Settings = request.app.state.settings
    project_root = _resolve_project_root(settings)

    if effective_scope == "global":
        config_path = _global_config_dir() / "opencode.json"
        data = _read_json_or_jsonc(config_path)
        section = data.get("skills")
        if isinstance(section, dict):
            section.pop(name, None)
        _write_json(config_path, data)
    else:
        config_path = project_root / ".opencode" / "opencode.json"
        if config_path.exists():
            data = _read_json_or_jsonc(config_path)
            section = data.get("skills")
            if isinstance(section, dict):
                section.pop(name, None)
                _write_json(config_path, data)

    return ApiResponse.success(
        {"success": True, "deleted": name},
        current_trace_id(),
    ).to_dict()