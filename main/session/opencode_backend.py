"""OpenCodeBackend — AgentBackend implementation using opencode CLI.

Talks to opencode directly via subprocess with --agent flag for routing.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import List
from uuid import uuid4

from main.framework.core.protocols import AgentBackend
from main.session.output_parser import strip_thinking
from main.session.process_pool import ProcessPool

logger = logging.getLogger(__name__)


class OpenCodeBackend(AgentBackend):
    """AgentBackend that dispatches to opencode CLI as subprocess.

    Each agent call spawns `opencode run --agent {name} --format json "{prompt}"`.
    The --agent flag routes directly to the named agent (no @prefix needed).
    """

    def __init__(
        self,
        opencode_bin: str | None = None,
        max_concurrent: int = 10,
        cwd: str = ".",
        default_timeout: int = 300,
    ):
        self._pool = ProcessPool(
            max_concurrent=max_concurrent,
            opencode_bin=opencode_bin,
            cwd=cwd,
        )
        self._default_timeout = default_timeout

        # Session tracking: our_session_id -> opencode_session_id
        self._sessions: dict[str, str] = {}
        # Session message history (for get_messages)
        self._history: dict[str, list[dict]] = {}
        # Session agent mapping
        self._session_agents: dict[str, str] = {}

    async def create_session(self, cwd: str = ".", agent: str = "opencode") -> str:
        """Create a logical session. No subprocess yet — deferred to send_message."""
        session_id = str(uuid4())
        self._sessions[session_id] = ""  # opencode session ID filled on first message
        self._history[session_id] = []
        self._session_agents[session_id] = agent
        logger.info("Created session %s for agent=%s", session_id, agent)
        return session_id

    async def send_message(self, session_id: str, text: str) -> str:
        """Send a message to a session. Blocks until agent completes.

        This is the core method — it spawns the opencode subprocess,
        waits for completion, and returns the response.
        """
        agent = self._session_agents.get(session_id, "opencode")
        opencode_sid = self._sessions.get(session_id, "")

        # Run the agent
        result = await self._pool.execute(
            agent=agent,
            prompt=text,
            session_id=opencode_sid or None,
            timeout=self._default_timeout,
        )

        # Update opencode session ID for multi-turn
        if result.session_id:
            self._sessions[session_id] = result.session_id

        # Store in history
        self._history.setdefault(session_id, []).append({
            "role": "user",
            "content": text,
        })

        if result.error and not result.text:
            self._history[session_id].append({
                "role": "assistant",
                "content": f"[Error: {result.error}]",
            })
            raise RuntimeError(f"Agent '{agent}' error: {result.error}")

        # Strip thinking blocks before storing
        clean_text = strip_thinking(result.text) if result.text else result.text
        self._history[session_id].append({
            "role": "assistant",
            "content": clean_text,
        })

        return "ok"

    async def get_message_count(self, session_id: str) -> int:
        """Get current message count for a session."""
        return len(self._history.get(session_id, []))

    async def get_messages(
        self, session_id: str, offset: int = 0, limit: int = 50
    ) -> list[dict]:
        """Return stored messages for this session."""
        history = self._history.get(session_id, [])
        return history[offset: offset + limit]

    async def wait_for_completion(
        self,
        session_id: str,
        timeout: int = 300,
        poll_interval: int = 3,
        after_count: int = 0,
    ) -> str:
        """Return the last assistant message.

        Since send_message already waits for completion, this just
        returns the last assistant message from history.
        """
        history = self._history.get(session_id, [])
        # Find the last assistant message after after_count
        for msg in reversed(history[after_count:]):
            if msg.get("role") == "assistant":
                return msg.get("content", "")
        return ""

    async def abort_session(self, session_id: str) -> None:
        """Abort a running session."""
        opencode_sid = self._sessions.get(session_id, "")
        if opencode_sid:
            await self._pool.abort(opencode_sid)
        # Also try with session_id as key
        await self._pool.abort(session_id)

    async def cleanup_sessions(self, session_ids: List[str]) -> dict[str, str]:
        """Clean up session state."""
        results = {}
        for sid in session_ids:
            if sid in self._sessions:
                # Abort if still running
                await self.abort_session(sid)
                del self._sessions[sid]
                self._history.pop(sid, None)
                self._session_agents.pop(sid, None)
                results[sid] = "cleaned"
            else:
                results[sid] = "not_found"
        return results

    def get_status(self) -> dict:
        """Return current backend status."""
        return {
            "type": "opencode",
            "active_processes": self._pool.active_count,
            "active_sessions": len(self._sessions),
            "opencode_bin": self._pool._opencode_bin,
        }
