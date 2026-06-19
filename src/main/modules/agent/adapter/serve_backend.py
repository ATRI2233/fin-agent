"""ServeBackend — AgentBackend implementation using opencode serve HTTP API.

Encapsulates the long-running ``opencode serve`` process and its REST API.
All configuration (port, binary path, env var for trace id) is sourced from
``Settings``; all transport-level errors are translated into the structured
``FinAgentError`` hierarchy defined in ``src.main.infra.errors``.

Key design points
-----------------
* ``create_session`` receives ``trace_id`` as a parameter and injects it
  into the spawned subprocess's environment via ``settings.TRACE_ID_ENV_VAR``.
  It does **not** read from any ``ContextVar`` because ``asyncio.gather``
  workers inherit the parent's context and would all see the same value
  (see TARGET_ARCHITECTURE_v2 §7.6, revision T-7).
* HTTP failures are classified by ``status_code`` range:
    - 5xx  → ``AgentHttp5xxError``
    - 4xx  → ``McpServerError``
    - ``RequestError`` / ``TimeoutException`` → ``OpencodeUnavailableError``
    - ``asyncio.TimeoutError`` → ``AgentTimeoutError``
* The server subprocess is spawned lazily on first use and re-checked
  before every request. Crash recovery is handled transparently.
"""

from __future__ import annotations

import asyncio
import logging
import os

import httpx

from src.main.infra.domain import AgentReference, SessionId, TraceId
from src.main.infra.errors import (
    AgentHttp5xxError,
    AgentTimeoutError,
    McpServerError,
    OpencodeUnavailableError,
)
from src.main.infra.settings import Settings
from src.main.modules.agent.protocol import AgentBackend

logger = logging.getLogger(__name__)


class ServeBackend(AgentBackend):
    """AgentBackend that talks to ``opencode serve`` over HTTP.

    The backend owns a long-lived ``opencode serve`` subprocess and a
    single ``httpx.AsyncClient`` pointed at it. Sessions are identified
    by the opencode session id (``ses_xxx``) which the server returns
    on ``POST /session`` and which we surface to callers as ``SessionId``.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings: Settings = settings
        self._http: httpx.AsyncClient | None = None
        self._proc: asyncio.subprocess.Process | None = None
        self._ready: bool = False

    # ───────────────────────────────────────────────────────────────────
    # HTTP client lifecycle
    # ───────────────────────────────────────────────────────────────────

    async def _get_http(self) -> httpx.AsyncClient:
        """Return the shared ``httpx.AsyncClient``, creating it on first use."""
        if self._http is None:
            self._http = httpx.AsyncClient(
                base_url=self.settings.opencode_serve_url,
                timeout=httpx.Timeout(
                    self.settings.NODE_TIMEOUT_SECONDS, connect=10.0
                ),
            )
        return self._http

    async def close(self) -> None:
        """Close the HTTP client and terminate the server subprocess.

        Safe to call when nothing has been spawned.
        """
        if self._http is not None:
            await self._http.aclose()
            self._http = None
        await _kill_proc(self._proc)
        self._proc = None
        self._ready = False

    # ───────────────────────────────────────────────────────────────────
    # Server subprocess lifecycle
    # ───────────────────────────────────────────────────────────────────

    async def _ensure_server(self, trace_id: TraceId) -> None:
        """Make sure the ``opencode serve`` subprocess is alive and ready.

        Args:
            trace_id: Trace id to inject into the subprocess environment
                (revision T-7: must be a parameter, never read from a
                ``ContextVar``).
        """
        if self._ready and self._proc is not None:
            if self._proc.returncode is not None:
                logger.warning(
                    "opencode serve exited (returncode=%s), respawning",
                    self._proc.returncode,
                )
                self._ready = False
                self._proc = None

        if self._ready:
            try:
                http = await self._get_http()
                resp = await http.get("/session", timeout=5.0)
                if resp.status_code == 200:
                    return
            except (httpx.RequestError, httpx.TimeoutException) as e:
                logger.warning("opencode health check failed: %s", e)
            except Exception as e:  # pragma: no cover - defensive
                logger.warning("opencode health check raised: %s", e)
            self._ready = False

        await self._spawn(trace_id)

    async def _spawn(self, trace_id: TraceId) -> None:
        """Spawn ``opencode serve`` with the given ``trace_id`` in its env.

        The trace id is exposed to the opencode subprocess via the env var
        ``FIN_AGENT_TRACE_ID`` (sourced from ``settings.TRACE_ID_ENV_VAR``).
        This is the env-var handoff that lets the opencode CLI / MCP servers
        pick up the trace id without going through Python contextvars.

        Args:
            trace_id: Trace id to expose to the subprocess via
                ``settings.TRACE_ID_ENV_VAR`` (= ``FIN_AGENT_TRACE_ID``).
        """
        cmd = [
            self.settings.OPENCODE_BIN,
            "serve",
            "--port",
            str(self.settings.OPENCODE_SERVE_PORT),
        ]
        env = {**os.environ, self.settings.TRACE_ID_ENV_VAR: str(trace_id)}
        logger.info("Spawning opencode serve: %s", " ".join(cmd))

        try:
            self._proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
        except FileNotFoundError as e:
            self._proc = None
            self._ready = False
            raise OpencodeUnavailableError(
                f"opencode binary not found: {self.settings.OPENCODE_BIN}",
                details={"binary": self.settings.OPENCODE_BIN},
                cause=e,
            ) from e

        # Wait for server to become ready.
        http = await self._get_http()
        for _ in range(20):  # up to ~10 seconds
            await asyncio.sleep(0.5)
            try:
                resp = await http.get("/session", timeout=3.0)
                if resp.status_code == 200:
                    self._ready = True
                    logger.info("opencode serve ready on %s", self.settings.opencode_serve_url)
                    return
            except (httpx.RequestError, httpx.TimeoutException):
                continue
            except Exception:  # pragma: no cover - defensive
                continue

        # Failed to come up: kill and surface as unavailability.
        await _kill_proc(self._proc)
        self._proc = None
        self._ready = False
        raise OpencodeUnavailableError(
            "opencode serve failed to start within 10 seconds",
            details={"url": self.settings.opencode_serve_url},
        )

    # ───────────────────────────────────────────────────────────────────
    # AgentBackend protocol implementation
    # ───────────────────────────────────────────────────────────────────

    async def create_session(
        self,
        agent: AgentReference,
        trace_id: TraceId,
    ) -> SessionId:
        """Create a new opencode session bound to ``agent``.

        ``trace_id`` is **required as a parameter** (revision T-7) so that
        ``asyncio.gather`` workers don't all inherit the parent's
        ``ContextVar`` value and pollute the trace.
        """
        await self._ensure_server(trace_id)

        payload: dict = {}
        if agent.name and agent.name != "opencode":
            payload["agent"] = agent.name

        http = await self._get_http()
        try:
            resp = await http.post("/session", json=payload)
        except (httpx.RequestError, httpx.TimeoutException) as e:
            raise OpencodeUnavailableError(
                "opencode serve unreachable on create_session",
                details={"url": self.settings.opencode_serve_url},
                cause=e,
            ) from e
        except asyncio.TimeoutError as e:
            raise AgentTimeoutError(
                "opencode serve timed out on create_session",
                details={"url": self.settings.opencode_serve_url},
                cause=e,
            ) from e

        _raise_for_status(resp)

        data = resp.json()
        opencode_sid = data["id"]  # ses_xxx
        logger.info(
            "Created opencode session %s (agent=%s)", opencode_sid, agent.name
        )
        return SessionId(opencode_sid)

    async def send_message(
        self,
        session_id: SessionId,
        text: str,
        agent: AgentReference | None,
        trace_id: TraceId,
    ) -> None:
        """Send ``text`` to ``session_id`` and block until completion.

        opencode's HTTP endpoint is synchronous: the POST returns only
        once the assistant reply is available, so no separate polling is
        required here.
        """
        await self._ensure_server(trace_id)

        payload: dict = {"parts": [{"type": "text", "text": text}]}
        if agent is not None and agent.name:
            payload["agent"] = agent.name

        http = await self._get_http()
        try:
            resp = await http.post(
                f"/session/{session_id}/message",
                json=payload,
            )
        except (httpx.RequestError, httpx.TimeoutException) as e:
            raise OpencodeUnavailableError(
                f"opencode serve unreachable on send_message (session={session_id})",
                details={"session_id": str(session_id)},
                cause=e,
            ) from e
        except asyncio.TimeoutError as e:
            raise AgentTimeoutError(
                f"opencode serve timed out on send_message (session={session_id})",
                details={"session_id": str(session_id)},
                cause=e,
            ) from e

        _raise_for_status(resp)

    async def wait_for_completion(
        self,
        session_id: SessionId,
        *,
        timeout: float,
        after_count: int,
        trace_id: TraceId,
    ) -> str:
        """Return the last assistant message for ``session_id``.

        ``send_message`` already blocks on the opencode HTTP endpoint, so
        by the time it returns the reply is fully available. We fetch the
        stored history and return the most recent assistant text after
        position ``after_count``.
        """
        await self._ensure_server(trace_id)

        http = await self._get_http()
        try:
            resp = await http.get(f"/session/{session_id}/messages")
        except (httpx.RequestError, httpx.TimeoutException) as e:
            raise OpencodeUnavailableError(
                f"opencode serve unreachable on wait_for_completion (session={session_id})",
                details={"session_id": str(session_id)},
                cause=e,
            ) from e
        except asyncio.TimeoutError as e:
            raise AgentTimeoutError(
                f"opencode serve timed out on wait_for_completion (session={session_id})",
                details={"session_id": str(session_id)},
                cause=e,
            ) from e

        _raise_for_status(resp)
        data = resp.json()
        messages = data.get("messages", [])
        for msg in reversed(messages[after_count:]):
            if msg.get("role") == "assistant":
                return _extract_assistant_text(msg)
        return ""

    async def abort_session(self, session_id: SessionId) -> None:
        """Abort a running session on the opencode server.

        Best-effort: errors are mapped to ``OpencodeUnavailableError`` so
        the caller still sees a structured failure.
        """
        await self._ensure_server_safe()
        http = await self._get_http()
        try:
            resp = await http.post(f"/session/{session_id}/abort")
        except (httpx.RequestError, httpx.TimeoutException) as e:
            raise OpencodeUnavailableError(
                f"opencode serve unreachable on abort_session (session={session_id})",
                details={"session_id": str(session_id)},
                cause=e,
            ) from e
        _raise_for_status(resp)

    async def cleanup_sessions(
        self,
        ids: list[SessionId],
    ) -> dict[SessionId, str]:
        """Delete a batch of sessions, returning ``{session_id: status}``."""
        results: dict[SessionId, str] = {}
        await self._ensure_server_safe()
        http = await self._get_http()
        for sid in ids:
            try:
                resp = await http.delete(f"/session/{sid}")
                _raise_for_status(resp)
                results[sid] = "cleaned"
            except (AgentHttp5xxError, AgentTimeoutError, McpServerError, OpencodeUnavailableError) as e:
                results[sid] = f"failed: {e.__class__.__name__}: {e.message}"
            except (httpx.RequestError, httpx.TimeoutException) as e:
                results[sid] = f"failed: OpencodeUnavailable: {e}"
            except Exception as e:  # pragma: no cover - defensive
                results[sid] = f"failed: {e!r}"
        return results

    # ───────────────────────────────────────────────────────────────────
    # Internal helpers
    # ───────────────────────────────────────────────────────────────────

    async def _ensure_server_safe(self) -> None:
        """Variant of ``_ensure_server`` that uses a placeholder trace id.

        ``abort_session`` and ``cleanup_sessions`` don't receive a
        ``trace_id`` per the protocol; we still need a valid value in the
        env to spawn the subprocess, so we fall back to a clear sentinel.
        """
        await self._ensure_server(TraceId("__serve_backend_internal__"))


# ───────────────────────────────────────────────────────────────────────
# Module-level helpers
# ───────────────────────────────────────────────────────────────────────


async def _kill_proc(proc: asyncio.subprocess.Process | None) -> None:
    """Terminate ``proc`` if it's still alive. Best-effort, never raises."""
    if proc is None:
        return
    try:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("Failed to kill opencode serve subprocess: %s", e)


def _raise_for_status(resp: httpx.Response) -> None:
    """Map an ``httpx.Response`` to a structured ``FinAgentError`` if non-2xx.

    Classification:
        * 5xx → ``AgentHttp5xxError``
        * 4xx → ``McpServerError``
    """
    if resp.status_code < 400:
        return
    body = resp.text[:500] if resp.text else ""
    if 500 <= resp.status_code < 600:
        raise AgentHttp5xxError(
            f"opencode returned {resp.status_code}",
            details={"status": resp.status_code, "body": body},
        )
    raise McpServerError(
        f"opencode returned {resp.status_code}",
        details={"status": resp.status_code, "body": body},
    )


def _extract_assistant_text(message: dict) -> str:
    """Pull the concatenated text out of an opencode message dict."""
    parts = message.get("parts", [])
    chunks: list[str] = []
    for part in parts:
        if isinstance(part, dict) and part.get("type") == "text":
            text = part.get("text")
            if text:
                chunks.append(text)
    return "".join(chunks)
