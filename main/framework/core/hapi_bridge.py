"""HAPI Bridge — concrete AgentBackend implementation.

Manages sessions via the HAPI Hub HTTP API.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import List

import httpx

logger = logging.getLogger(__name__)


class HAPIBridge:
    """Concrete implementation of the AgentBackend protocol."""

    def __init__(self, hub_url: str, api_token: str = ""):
        self.hub_url = hub_url.rstrip("/")
        self._cli_token = api_token
        self._jwt_token = None
        self._jwt_expires_at = 0
        self._machine_id = None
        self.headers = {}

    async def _ensure_jwt(self):
        """Get or refresh JWT token from /api/auth."""
        if self._jwt_token and time.time() < self._jwt_expires_at - 60:
            return
        if not self._cli_token:
            raise RuntimeError("No CLI API token configured")
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.hub_url}/api/auth",
                json={"accessToken": f"{self._cli_token}:default"},
            )
            resp.raise_for_status()
            data = resp.json()
            self._jwt_token = data["token"]
            self._jwt_expires_at = time.time() + 900  # 15 min
            self.headers = {"Authorization": f"Bearer {self._jwt_token}"}

    async def _ensure_machine(self):
        """Get an online machine ID."""
        if self._machine_id:
            return
        await self._ensure_jwt()
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{self.hub_url}/api/machines",
                headers=self.headers,
            )
            resp.raise_for_status()
            machines = resp.json().get("machines", [])
            if not machines:
                raise RuntimeError("No online machines available")
            self._machine_id = machines[0]["id"]

    async def create_session(self, cwd: str = ".", agent: str = "opencode") -> str:
        """Create a new opencode session. Returns the session ID."""
        await self._ensure_jwt()
        await self._ensure_machine()
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{self.hub_url}/api/machines/{self._machine_id}/spawn",
                json={"directory": cwd, "agent": agent, "hidden": True},
                headers=self.headers,
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("type") != "success":
                raise RuntimeError(f"Failed to spawn session: {data}")
            return data["sessionId"]

    async def send_message(self, session_id: str, text: str) -> str:
        """Send a message to a session."""
        await self._ensure_jwt()
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.hub_url}/api/sessions/{session_id}/messages",
                json={"text": text},
                headers=self.headers,
            )
            resp.raise_for_status()
            return "ok"

    async def get_message_count(self, session_id: str) -> int:
        """Get current message count."""
        messages = await self.get_messages(session_id)
        return len(messages)

    async def get_messages(
        self, session_id: str, offset: int = 0, limit: int = 50
    ) -> list:
        """Get messages from a session."""
        await self._ensure_jwt()
        params: dict = {"limit": limit}
        if offset > 0:
            params["offset"] = offset
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{self.hub_url}/api/sessions/{session_id}/messages",
                params=params,
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json().get("messages", [])

    async def wait_for_completion(
        self,
        session_id: str,
        timeout: int = 300,
        poll_interval: int = 3,
        after_count: int = 0,
    ) -> str:
        """Wait for agent to complete and return the response.

        Args:
            after_count: Only look for messages after this count
                         (to ignore old responses in reused sessions).
        """
        start = time.time()
        while (time.time() - start) < timeout:
            messages = await self.get_messages(session_id)
            new_messages = messages[after_count:] if after_count > 0 else messages
            for msg in reversed(new_messages):
                content = msg.get("content", {})
                if content.get("role") == "agent":
                    inner = content.get("content", {})
                    if inner.get("type") == "codex":
                        data = inner.get("data", {})
                        if data.get("type") == "message":
                            return data.get("message", "")
                    elif inner.get("type") == "text":
                        return inner.get("text", "")
            await asyncio.sleep(poll_interval)
        raise TimeoutError(f"Session {session_id} timed out after {timeout}s")

    async def abort_session(self, session_id: str) -> None:
        """Abort a session."""
        await self._ensure_jwt()
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.hub_url}/api/sessions/{session_id}/abort",
                headers=self.headers,
            )
            resp.raise_for_status()

    async def list_sessions(self) -> list:
        """List all sessions from HAPI Hub."""
        await self._ensure_jwt()
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{self.hub_url}/api/sessions",
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json().get("sessions", [])

    async def cleanup_sessions(self, session_ids: List[str]) -> dict:
        """Delete multiple sessions. Returns {id: 'cleaned' | 'failed: ...'}."""
        await self._ensure_jwt()
        results = {}
        for session_id in session_ids:
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.delete(
                        f"{self.hub_url}/api/sessions/{session_id}",
                        headers=self.headers,
                    )
                    resp.raise_for_status()
                    results[session_id] = "cleaned"
            except Exception as e:
                results[session_id] = f"failed: {str(e)}"
        return results
