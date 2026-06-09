"""Process pool for concurrent opencode subprocesses.

Manages asyncio subprocesses running `opencode run --agent {name} --format json`.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from typing import Optional

from main.framework.config.settings import settings
from main.session.output_parser import ParsedOutput, parse_stream

logger = logging.getLogger(__name__)


class ProcessPool:
    """Manages concurrent opencode subprocesses.

    Each agent dispatch spawns `opencode run --agent {name} --format json "{prompt}"`.
    A semaphore limits the number of concurrent processes.
    """

    def __init__(
        self,
        max_concurrent: int = 10,
        opencode_bin: str | None = None,
        cwd: str = ".",
    ):
        self._max_concurrent = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._opencode_bin = opencode_bin or settings.OPENCODE_BIN or "opencode"
        self._cwd = cwd
        # session_id -> process (for abort support)
        self._active_processes: dict[str, asyncio.subprocess.Process] = {}

    async def execute(
        self,
        agent: str,
        prompt: str,
        session_id: str | None = None,
        timeout: int = 300,
    ) -> ParsedOutput:
        """Run opencode with the given agent and prompt.

        Args:
            agent: Agent name (e.g., "macro-scout").
            prompt: The message to send.
            session_id: Optional existing session ID to continue.
            timeout: Max seconds to wait for completion.

        Returns:
            ParsedOutput with the agent's response.
        """
        await self._semaphore.acquire()
        try:
            return await self._run_agent(agent, prompt, session_id, timeout)
        finally:
            self._semaphore.release()

    async def _run_agent(
        self,
        agent: str,
        prompt: str,
        session_id: str | None,
        timeout: int,
    ) -> ParsedOutput:
        """Internal: spawn and manage one opencode subprocess."""
        cmd = [
            self._opencode_bin,
            "run",
            "--agent",
            agent,
            "--format",
            "json",
            "--dangerously-skip-permissions",
        ]

        if session_id:
            cmd.extend(["--session", session_id, "--continue"])

        cmd.append(prompt)

        logger.info("Spawning: %s (agent=%s)", " ".join(cmd[:6]), agent)

        env = os.environ.copy()
        # Ensure opencode can find its config
        env.setdefault("NO_COLOR", "1")

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self._cwd,
                env=env,
            )

            # Track for abort support
            proc_key = session_id or str(id(process))
            self._active_processes[proc_key] = process

            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    process.communicate(),
                    timeout=timeout,
                )
            except TimeoutError:
                logger.warning("Process timed out after %ds, killing", timeout)
                process.kill()
                await process.wait()
                return ParsedOutput(error=f"Agent '{agent}' timed out after {timeout}s")
            finally:
                self._active_processes.pop(proc_key, None)

            stdout_lines = stdout_bytes.decode("utf-8", errors="ignore").splitlines()
            stderr_text = stderr_bytes.decode("utf-8", errors="ignore")

            if process.returncode != 0 and not stdout_lines:
                logger.error("opencode exited %d: %s", process.returncode, stderr_text[:500])
                return ParsedOutput(error=f"opencode exited with code {process.returncode}: {stderr_text[:300]}")

            result = parse_stream(stdout_lines)

            if stderr_text and not result.text:
                logger.warning("opencode stderr: %s", stderr_text[:500])

            if not result.text and not result.error:
                result.error = f"No response from agent '{agent}'"

            logger.info(
                "Agent %s completed: session=%s reason=%s text_len=%d",
                agent,
                result.session_id,
                result.reason,
                len(result.text),
            )

            return result

        except FileNotFoundError:
            logger.error("opencode binary not found: %s", self._opencode_bin)
            return ParsedOutput(error=f"opencode binary not found: {self._opencode_bin}")
        except Exception as e:
            logger.error("Failed to run agent %s: %s", agent, e)
            return ParsedOutput(error=str(e))

    async def abort(self, proc_key: str) -> None:
        """Kill a running process by key."""
        process = self._active_processes.get(proc_key)
        if process and process.returncode is None:
            logger.info("Aborting process %s", proc_key)
            try:
                process.kill()
                await process.wait()
            except ProcessLookupError:
                pass
            self._active_processes.pop(proc_key, None)

    @property
    def active_count(self) -> int:
        """Number of currently running processes."""
        return len(self._active_processes)
