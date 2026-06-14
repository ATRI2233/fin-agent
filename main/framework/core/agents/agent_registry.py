"""Agent registry — reads agent config from opencode.json + .opencode/agents/*.md.

Data sources (merged at read time):
  1. `.opencode/agents/*.md` — YAML frontmatter provides description, mode.
     The agent *exists* only if its .md file exists.
  2. `.opencode/opencode.json` → `agent` section — supplements tools_whitelist,
     model assignments.  Keys that have no matching .md file are ignored.

Caching: results are cached for ``_CACHE_TTL`` seconds.  ``reload()`` forces
an immediate refresh.  The cache is per-process (module-level singleton).
"""

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

_CACHE_TTL = 30  # seconds


@dataclass
class AgentInfo:
    name: str
    description: str
    capabilities: list
    tools: list
    tools_whitelist: list = field(default_factory=list)
    mode: str = "agent"
    file_path: Optional[str] = None


def _project_root() -> Path:
    """Return the project root (4 levels up from this file)."""
    return Path(__file__).resolve().parents[4]


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


def _load_agents() -> dict[str, AgentInfo]:
    """Load agents by merging .md files with opencode.json config."""
    root = _project_root()
    agents_dir = root / ".opencode" / "agents"
    config_path = root / ".opencode" / "opencode.json"

    # Load opencode.json agent section for tool whitelists
    agent_cfg: dict = {}
    if config_path.exists():
        try:
            with open(config_path, encoding="utf-8") as f:
                agent_cfg = json.load(f).get("agent", {})
        except Exception:
            pass

    agents: dict[str, AgentInfo] = {}

    # Scan .md files — this is the source of truth for agent existence.
    # Only files with valid YAML frontmatter containing a "description"
    # key are treated as agent definitions; other .md files (e.g.
    # PROJECT_STATE.md) are documentation and skipped.
    if agents_dir.is_dir():
        for md_file in sorted(agents_dir.glob("*.md")):
            name = md_file.stem
            try:
                content = md_file.read_text(encoding="utf-8")
            except Exception:
                continue
            meta = _parse_frontmatter(content)
            if "description" not in meta:
                continue  # not an agent definition

            description = meta.get("description", name.replace("-", " ").title())
            mode = meta.get("mode", "agent")

            # Tool whitelist from opencode.json
            cfg = agent_cfg.get(name, {})
            tools_map = cfg.get("tools", {})
            allowed = [k for k, v in tools_map.items() if k != "*" and v is True]

            agents[name] = AgentInfo(
                name=name,
                description=description,
                capabilities=[],
                tools=allowed,
                tools_whitelist=allowed,
                mode=mode,
                file_path=str(md_file),
            )

    # NOTE: opencode.json entries without a matching .md file are intentionally
    # skipped — the .md file is the sole source of truth for agent existence
    # (see module docstring).  Orphaned entries in opencode.json are ignored.

    return agents


class AgentRegistry:
    """Singleton agent registry with TTL-based caching."""

    def __init__(self) -> None:
        self._cache: dict[str, AgentInfo] | None = None
        self._loaded_at: float = 0.0

    def _ensure_loaded(self) -> dict[str, AgentInfo]:
        now = time.monotonic()
        if self._cache is None or (now - self._loaded_at) > _CACHE_TTL:
            self._cache = _load_agents()
            self._loaded_at = now
        return self._cache

    def get_agent(self, name: str) -> AgentInfo | None:
        return self._ensure_loaded().get(name)

    def list_agents(self) -> list[AgentInfo]:
        return list(self._ensure_loaded().values())

    def register_agent(self, info: AgentInfo):
        cache = self._ensure_loaded()
        cache[info.name] = info

    def reload(self):
        """Force reload from disk, ignoring TTL."""
        self._cache = None
        self._loaded_at = 0.0


registry = AgentRegistry()
