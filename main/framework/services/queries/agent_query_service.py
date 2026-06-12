"""AgentQueryService — business logic for the agents HTTP API.

Replaces the inline handlers that previously lived in ``api/agents.py``.
The class is intentionally sync; the registry-backed methods
(``list_agents``, ``get_by_name``) hit an in-memory
:class:`core.agent_registry.registry`, while ``agent_stats`` aggregates
DB rows from ``models.workflow_execution.ExecutionNode``.

Design notes
------------
- **Registry-backed reads** (list / get) never touch the DB.  They are
  delegated to ``core.agent_registry.registry`` which holds the
  declarative agent configuration.  Keeping the read path purely in
  memory preserves the legacy behaviour where the agents list was
  available even when the DB was unreachable.
- **Stats aggregation** is the one method that needs ``db: Session``;
  it issues a single ``GROUP BY agent, status`` query and folds the
  rows into the per-agent summary dict.  The legacy try/except
  fallback to ``[]`` is preserved so a DB error does not 500 the
  whole endpoint.
- **``NotFoundError``** is raised by ``get_by_name`` for missing
  agents; the controller translates it to ``HTTPException(404)``.
"""

from __future__ import annotations

import logging
from typing import Any

from main.framework.repositories.agent_repo import AgentRepository
from main.framework.services.exceptions import NotFoundError
from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class AgentQueryService:
    """Business-logic facade over the agent registry + execution stats.

    Public surface (3 methods, all sync):
      list_agents, get_by_name, agent_stats
    """

    def __init__(self, agent_repo: AgentRepository) -> None:
        # Injected for symmetry with sibling query services; the registry
        # itself is read from ``core.agent_registry.registry`` at call time
        # (lazy import avoids a circular dep with core bootstrap).
        self._agent_repo = agent_repo

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _to_summary(agent: Any) -> dict[str, Any]:
        """Build the public summary dict used by list / get endpoints."""
        return {
            "name": agent.name,
            "description": agent.description,
            "capabilities": agent.capabilities,
            "tools": agent.tools,
            "tools_whitelist": getattr(agent, "tools_whitelist", agent.tools),
            "mode": agent.mode,
        }

    # ------------------------------------------------------------------
    # Registry-backed reads
    # ------------------------------------------------------------------

    def list_agents(self) -> list[dict[str, Any]]:
        """List all registered agents (summary view)."""
        from main.framework.core.agents.agent_registry import registry

        return [self._to_summary(a) for a in registry.list_agents()]

    def get_by_name(self, name: str) -> dict[str, Any]:
        """Get a single agent by name.

        Raises :class:`NotFoundError` when ``name`` is not in the registry.
        """
        from main.framework.core.agents.agent_registry import registry

        agent = registry.get_agent(name)
        if not agent:
            raise NotFoundError("agent", name)
        return self._to_summary(agent)

    # ------------------------------------------------------------------
    # Stats — DB aggregation over ExecutionNode rows
    # ------------------------------------------------------------------

    def agent_stats(self, db: Session) -> list[dict[str, Any]]:
        """Return per-agent execution stats joined with the agent registry.

        Response shape (preserved for backward compatibility with the
        pre-refactor ``/stats`` endpoint):

            [
                {
                    "name": str,
                    "description": str,
                    "mode": str,
                    "executions_total":   int,
                    "executions_completed": int,
                    "executions_failed":  int,
                    "success_rate": float,   # percent, denominator = completed + failed
                },
                ...
            ]

        On any DB failure the legacy behaviour of returning ``[]`` is
        preserved so the stats endpoint never 5xx's the UI.
        """
        try:
            from main.framework.core.agents.agent_registry import registry
            from main.framework.models.workflow_execution import ExecutionNode

            rows = (
                db.query(ExecutionNode.agent, ExecutionNode.status, func.count(ExecutionNode.id))
                .group_by(ExecutionNode.agent, ExecutionNode.status)
                .all()
            )
            stats: dict = {}
            for agent, s, count in rows:
                if agent not in stats:
                    stats[agent] = {"total": 0, "completed": 0, "failed": 0}
                stats[agent][s] = stats[agent].get(s, 0) + count
                stats[agent]["total"] += count

            result = []
            for a in registry.list_agents():
                s = stats.get(a.name, {"total": 0, "completed": 0, "failed": 0})
                total_terminal = s["completed"] + s["failed"]
                result.append(
                    {
                        "name": a.name,
                        "description": a.description,
                        "mode": a.mode,
                        "executions_total": s["total"],
                        "executions_completed": s["completed"],
                        "executions_failed": s["failed"],
                        "success_rate": round(s["completed"] / max(total_terminal, 1) * 100, 1),
                    }
                )
            return result
        except Exception:  # noqa: BLE001 — legacy fallback preserves the empty-list response
            return []


__all__ = ["AgentQueryService"]
