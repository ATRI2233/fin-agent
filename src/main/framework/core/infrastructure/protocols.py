"""Protocol definitions for dependency inversion.

All core modules depend on these protocols (abstractions) rather than
concrete implementations.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

# ---------------------------------------------------------------------------
# Agent execution backend
# ---------------------------------------------------------------------------

@runtime_checkable
class AgentBackend(Protocol):
    """Abstract interface for agent session management.

    ServeBackend is the current implementation, using opencode serve HTTP API.
    """

    async def create_session(self, cwd: str = ".", agent: str = "opencode") -> str:
        """Spawn a new agent session. Returns the session ID."""
        ...

    async def send_message(self, session_id: str, text: str, agent: str | None = None) -> str:
        """Send *text* to an existing session. Optionally specify *agent* to switch
        the active agent for this message (Tab-switch style within the same session)."""
        ...

    async def get_messages(self, session_id: str, offset: int = 0, limit: int = 50) -> list[dict]:
        """Return messages from *session_id*."""
        ...

    async def wait_for_completion(
        self,
        session_id: str,
        timeout: int = 300,
        poll_interval: int = 3,
        after_count: int = 0,
    ) -> str:
        """Block until the agent finishes; return its final reply text."""
        ...

    async def abort_session(self, session_id: str) -> None:
        """Abort a running session."""
        ...

    async def cleanup_sessions(self, session_ids: list[str]) -> dict[str, str]:
        """Delete multiple sessions. Returns {id: 'cleaned' | 'failed: ...'}."""
        ...
