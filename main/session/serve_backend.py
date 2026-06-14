"""ServeBackend — AgentBackend implementation using opencode serve HTTP API.

Instead of spawning a subprocess per agent call, this backend communicates
with a long-running `opencode serve` process via its REST API. This eliminates
Node.js cold-start overhead and enables true parallel agent execution.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

import httpx

from main.framework.core.infrastructure.protocols import AgentBackend
from main.session.output_parser import strip_thinking

logger = logging.getLogger(__name__)


class ServeBackend(AgentBackend):
    """AgentBackend that dispatches to opencode serve via HTTP API.

    Unlike OpenCodeBackend which spawns a subprocess per call, this backend
    maintains a persistent connection to an `opencode serve` server process,
    eliminating process startup overhead for each agent invocation.

    The server is started automatically on first use and managed as a
    long-lived subprocess. Health checks ensure the server is alive before
    each request, with automatic restart on crash.
    """

    def __init__(
        self,
        server_url: str = "http://127.0.0.1:4096",
        opencode_bin: str | None = None,
        cwd: str = ".",
        default_timeout: int = 300,
    ):
        self._server_url = server_url.rstrip("/")
        self._opencode_bin = opencode_bin or "opencode"
        self._cwd = cwd
        self._default_timeout = default_timeout

        # HTTP client (lazy init)
        self._http: httpx.AsyncClient | None = None

        # Server process management
        self._server_process: asyncio.subprocess.Process | None = None
        self._server_ready = False

        # Session tracking: our_session_id -> opencode_session_id
        self._sessions: dict[str, str] = {}
        # Session message history (for get_messages / wait_for_completion)
        self._history: dict[str, list[dict]] = {}
        # Session agent mapping
        self._session_agents: dict[str, str] = {}

    # ------------------------------------------------------------------
    # HTTP client lifecycle
    # ------------------------------------------------------------------

    async def _get_http(self) -> httpx.AsyncClient:
        """Return the shared httpx client, creating it on first use."""
        if self._http is None:
            self._http = httpx.AsyncClient(
                base_url=self._server_url,
                timeout=httpx.Timeout(self._default_timeout, connect=10.0),
            )
        return self._http

    async def close(self) -> None:
        """Shut down HTTP client and server process."""
        if self._http is not None:
            await self._http.aclose()
            self._http = None
        await self._stop_server()

    # ------------------------------------------------------------------
    # Server lifecycle management
    # ------------------------------------------------------------------

    async def ensure_server(self) -> None:
        """Ensure the opencode serve process is running and healthy.

        Checks server liveness via HTTP. If the server is down, starts it
        and waits for it to become ready.
        """
        if self._server_ready and self._server_process is not None:
            # Check if process is still alive
            if self._server_process.returncode is not None:
                logger.warning(
                    "opencode serve exited with code %d, restarting",
                    self._server_process.returncode,
                )
                self._server_ready = False
                self._server_process = None

        if self._server_ready:
            # Quick health check
            try:
                http = await self._get_http()
                resp = await http.get("/session", timeout=5.0)
                if resp.status_code == 200:
                    return
                logger.warning("Health check returned %d, restarting server", resp.status_code)
                self._server_ready = False
            except Exception:
                logger.warning("Health check failed, restarting server")
                self._server_ready = False

        await self._start_server()

    async def _start_server(self) -> None:
        """Start the opencode serve process."""
        import shlex

        cmd = [self._opencode_bin, "serve", "--port", "4096"]
        logger.info("Starting opencode serve: %s", " ".join(cmd))

        try:
            self._server_process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self._cwd,
            )
        except FileNotFoundError:
            raise RuntimeError(
                f"opencode binary not found: {self._opencode_bin}"
            )

        # Wait for server to become ready (poll health endpoint)
        http = await self._get_http()
        for attempt in range(20):  # up to 10 seconds
            await asyncio.sleep(0.5)
            try:
                resp = await http.get("/session", timeout=3.0)
                if resp.status_code == 200:
                    self._server_ready = True
                    logger.info("opencode serve ready on %s", self._server_url)
                    return
            except Exception:
                pass

        # Server didn't start in time
        await self._stop_server()
        raise RuntimeError("opencode serve failed to start within 10 seconds")

    async def _stop_server(self) -> None:
        """Stop the server process if running."""
        if self._server_process is not None:
            try:
                self._server_process.kill()
                await self._server_process.wait()
            except Exception:
                pass
            self._server_process = None
            self._server_ready = False

    # ------------------------------------------------------------------
    # AgentBackend protocol implementation
    # ------------------------------------------------------------------

    async def create_session(self, cwd: str = ".", agent: str = "opencode") -> str:
        """Create a new session on the opencode serve server.

        Returns a logical session ID (our own UUID). The actual opencode
        session ID is returned by the server and stored for后续请求.
        """
        from uuid import uuid4

        await self.ensure_server()

        http = await self._get_http()
        resp = await http.post("/session", json={})
        resp.raise_for_status()

        data = resp.json()
        opencode_sid = data["id"]

        our_sid = str(uuid4())
        self._sessions[our_sid] = opencode_sid
        self._history[our_sid] = []
        self._session_agents[our_sid] = agent

        logger.info("Created session %s -> %s (agent=%s)", our_sid, opencode_sid, agent)
        return our_sid

    async def send_message(self, session_id: str, text: str) -> str:
        """Send a message to a session and wait for the agent's response.

        This is the core method. It sends the message via HTTP POST and
        blocks until the agent completes. The response is parsed and
        stored in history.
        """
        opencode_sid = self._sessions.get(session_id)
        if not opencode_sid:
            raise ValueError(f"Unknown session: {session_id}")

        agent = self._session_agents.get(session_id, "opencode")

        await self.ensure_server()
        http = await self._get_http()

        # Build request payload
        payload: dict[str, Any] = {
            "parts": [{"type": "text", "text": text}],
        }
        # Specify agent for routing
        if agent and agent != "opencode":
            payload["agent"] = agent

        # Store user message in history
        self._history.setdefault(session_id, []).append({
            "role": "user",
            "content": text,
        })

        # Send message (synchronous — waits for AI completion)
        try:
            resp = await http.post(
                f"/session/{opencode_sid}/message",
                json=payload,
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            error_msg = f"HTTP {e.response.status_code}: {e.response.text[:300]}"
            self._history[session_id].append({
                "role": "assistant",
                "content": f"[Error: {error_msg}]",
            })
            raise RuntimeError(f"Agent '{agent}' error: {error_msg}") from e
        except httpx.RequestError as e:
            error_msg = f"Request failed: {e}"
            self._history[session_id].append({
                "role": "assistant",
                "content": f"[Error: {error_msg}]",
            })
            raise RuntimeError(f"Agent '{agent}' error: {error_msg}") from e

        # Parse response
        data = resp.json()
        response_text = self._extract_text(data)

        # Strip thinking blocks
        clean_text = strip_thinking(response_text) if response_text else response_text

        # Store assistant message in history
        self._history[session_id].append({
            "role": "assistant",
            "content": clean_text,
        })

        logger.info(
            "Agent %s completed: session=%s text_len=%d",
            agent, session_id, len(clean_text or ""),
        )

        return "ok"

    async def get_messages(
        self, session_id: str, offset: int = 0, limit: int = 50
    ) -> list[dict]:
        """Return stored messages for this session."""
        history = self._history.get(session_id, [])
        return history[offset : offset + limit]

    async def wait_for_completion(
        self,
        session_id: str,
        timeout: int = 300,
        poll_interval: int = 3,
        after_count: int = 0,
    ) -> str:
        """Return the last assistant message.

        Since send_message already waits for completion via the synchronous
        HTTP endpoint, this just returns the last assistant message from
        the in-memory history.
        """
        history = self._history.get(session_id, [])
        for msg in reversed(history[after_count:]):
            if msg.get("role") == "assistant":
                return msg.get("content", "")
        return ""

    async def abort_session(self, session_id: str) -> None:
        """Abort a running session on the server."""
        opencode_sid = self._sessions.get(session_id)
        if not opencode_sid:
            return

        try:
            await self.ensure_server()
            http = await self._get_http()
            await http.post(f"/session/{opencode_sid}/abort")
        except Exception as e:
            logger.warning("Failed to abort session %s: %s", session_id, e)

    async def cleanup_sessions(self, session_ids: list[str]) -> dict[str, str]:
        """Delete sessions from the server and clean up local state."""
        results = {}
        for sid in session_ids:
            opencode_sid = self._sessions.pop(sid, None)
            self._history.pop(sid, None)
            self._session_agents.pop(sid, None)

            if opencode_sid:
                try:
                    await self.ensure_server()
                    http = await self._get_http()
                    await http.delete(f"/session/{opencode_sid}")
                    results[sid] = "cleaned"
                except Exception as e:
                    logger.warning("Failed to delete session %s: %s", sid, e)
                    results[sid] = f"failed: {e}"
            else:
                results[sid] = "not_found"
        return results

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_text(data: dict) -> str:
        """Extract the response text from the opencode serve message response.

        The response format is:
        {
            "info": { ... metadata ... },
            "parts": [
                {"type": "step-start", ...},
                {"type": "text", "text": "response text", ...},
                {"type": "step-finish", ...}
            ]
        }
        """
        parts = data.get("parts", [])
        text_parts = []
        for part in parts:
            if part.get("type") == "text":
                text = part.get("text", "")
                if text:
                    text_parts.append(text)
        return "".join(text_parts)

    def get_status(self) -> dict:
        """Return current backend status."""
        return {
            "type": "opencode-serve",
            "server_url": self._server_url,
            "server_ready": self._server_ready,
            "server_pid": self._server_process.pid if self._server_process else None,
            "active_sessions": len(self._sessions),
            "opencode_bin": self._opencode_bin,
        }
