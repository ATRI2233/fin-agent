"""Unified agent dispatch — single point of agent session management.

All agent execution (WorkflowEngine, JobExecutor, DebateExecutor) goes
through this dispatcher instead of directly calling HAPIBridge.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from main.framework.core.protocols import AgentBackend

logger = logging.getLogger(__name__)


class AgentDispatcher:
    """Unified agent session dispatcher.

    Accepts an AgentBackend (protocol) so the concrete implementation
    (HAPIBridge, mock, etc.) is injected rather than imported.
    """

    def __init__(self, backend: AgentBackend):
        self._backend = backend

    # ------------------------------------------------------------------
    # Core dispatch
    # ------------------------------------------------------------------

    async def dispatch(
        self,
        agent: str,
        prompt: str,
        *,
        timeout: int = 300,
        session_id: str | None = None,
        reuse_session: bool = False,
    ) -> dict[str, Any]:
        """Dispatch a prompt to an agent and return the parsed result.

        Args:
            agent: Target agent name.
            prompt: The prompt text.
            timeout: Seconds to wait for completion.
            session_id: Existing session to reuse (sends message to it).
            reuse_session: If True, do NOT abort the session after completion
                          (caller is responsible for cleanup).

        Returns:
            {"result": <parsed>, "session_id": str, "raw": str}
        """
        created_new = False

        if session_id:
            # Reuse existing session (e.g. serial chain)
            await self._backend.send_message(session_id, prompt)
        else:
            session_id = await self._backend.create_session(agent=agent)
            await self._backend.send_message(session_id, prompt)
            created_new = True

        try:
            raw = await self._backend.wait_for_completion(
                session_id, timeout=timeout
            )
            return {
                "result": self._parse_response(raw),
                "session_id": session_id,
                "raw": raw,
            }
        finally:
            if created_new and not reuse_session:
                await self._backend.abort_session(session_id)

    # ------------------------------------------------------------------
    # Multi-agent parallel dispatch (for debates, etc.)
    # ------------------------------------------------------------------

    async def dispatch_parallel(
        self,
        agents: list[str],
        prompt: str,
        *,
        timeout: int = 300,
    ) -> list[dict[str, Any]]:
        """Dispatch the same prompt to multiple agents in parallel.

        Returns a list of {"agent": str, "result": Any, "error": str | None}.
        """
        import asyncio

        async def _one(agent_name: str) -> dict[str, Any]:
            try:
                resp = await self.dispatch(agent_name, prompt, timeout=timeout)
                return {"agent": agent_name, "result": resp["result"], "error": None}
            except Exception as e:
                logger.error(f"Agent {agent_name} failed: {e}")
                return {"agent": agent_name, "result": None, "error": str(e)}

        return await asyncio.gather(*[_one(a) for a in agents])

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_response(raw: str) -> Any:
        """Try to JSON-parse the response; fall back to raw text."""
        try:
            return json.loads(raw)
        except Exception:
            return raw
