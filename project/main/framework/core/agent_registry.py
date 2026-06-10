"""Agent registry — reads agent config from opencode.json at startup."""

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class AgentInfo:
    name: str
    description: str
    capabilities: list
    tools: list
    mode: str = "agent"


def _load_agents_from_opencode() -> dict[str, AgentInfo]:
    """Load agent definitions from .opencode/opencode.json."""
    config_path = Path(__file__).resolve().parents[3] / ".opencode" / "opencode.json"
    if not config_path.exists():
        return {}
    with open(config_path, encoding="utf-8") as f:
        config = json.load(f)
    agents = {}
    for name, cfg in config.get("agent", {}).items():
        tools_map = cfg.get("tools", {})
        # Extract allowed tool names (value == true, key != "*")
        allowed = [k for k, v in tools_map.items() if k != "*" and v is True]
        # Infer mode from name
        mode = "orchestrator" if "orchestrator" in name else "fusion" if "fusion" in name else "agent"
        agents[name] = AgentInfo(
            name=name,
            description=name.replace("-", " ").title(),
            capabilities=[],
            tools=allowed,
            mode=mode,
        )
    return agents


# Load once at import time; call reload() to refresh
AGENTS: dict[str, AgentInfo] = _load_agents_from_opencode()


class AgentRegistry:
    def get_agent(self, name: str) -> AgentInfo | None:
        return AGENTS.get(name)

    def list_agents(self) -> list:
        return list(AGENTS.values())

    def register_agent(self, info: AgentInfo):
        AGENTS[info.name] = info

    def reload(self):
        """Reload agents from opencode.json."""
        global AGENTS
        AGENTS = _load_agents_from_opencode()


registry = AgentRegistry()
