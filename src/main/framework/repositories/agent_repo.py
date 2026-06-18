"""Repository for Agent configuration persistence."""

from __future__ import annotations

from typing import Any

from main.framework.models.agent import Agent
from main.framework.models.database import SessionLocal


class AgentRepository:
    """Encapsulates all DB operations for Agent records."""

    def __init__(self, session_factory=SessionLocal):
        self._sf = session_factory

    def get(self, name: str) -> Agent | None:
        """Get agent by name (primary key)."""
        with self._sf() as db:
            return db.query(Agent).get(name)

    def list(self, limit: int = 100, offset: int = 0) -> list[Agent]:
        """List all agents."""
        with self._sf() as db:
            return db.query(Agent).offset(offset).limit(limit).all()

    def create(self, name: str, **kwargs: Any) -> Agent:
        """Create a new agent. Commits immediately."""
        with self._sf() as db:
            agent = Agent(name=name, **kwargs)
            db.add(agent)
            db.commit()
            db.refresh(agent)
            return agent

    def update(self, name: str, **kwargs: Any) -> Agent | None:
        """Update an agent by name. Commits immediately."""
        with self._sf() as db:
            agent = db.query(Agent).get(name)
            if agent is None:
                return None
            for k, v in kwargs.items():
                setattr(agent, k, v)
            db.commit()
            db.refresh(agent)
            return agent

    def delete(self, name: str) -> bool:
        """Delete an agent by name. Returns True if deleted."""
        with self._sf() as db:
            agent = db.query(Agent).get(name)
            if agent is None:
                return False
            db.delete(agent)
            db.commit()
            return True

    def exists(self, name: str) -> bool:
        """Check if agent exists."""
        with self._sf() as db:
            return db.query(Agent).filter_by(name=name).first() is not None
