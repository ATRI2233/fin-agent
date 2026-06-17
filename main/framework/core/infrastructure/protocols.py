"""Protocol definitions for dependency inversion.

All core modules depend on these protocols (abstractions) rather than
concrete implementations.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

# ---------------------------------------------------------------------------
# Agent execution backend
# ---------------------------------------------------------------------------

@runtime_checkable
class AgentBackend(Protocol):
    """Abstract interface for agent session management.

    ServeBackend is the current implementation, using opencode serve HTTP API.
    """

    async def create_session(self, cwd: str = ".", agent: str = "opencode") -> str:
        """Spawn a new agent session.  Returns the session ID."""
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
        """Delete multiple sessions.  Returns {id: 'cleaned' | 'failed: ...'}."""
        ...


# ---------------------------------------------------------------------------
# Persistence — workflow / execution
# ---------------------------------------------------------------------------

@runtime_checkable
class ExecutionStore(Protocol):
    """Abstract interface for workflow execution persistence."""

    def create_execution(self, workflow_id: str, **kwargs: Any) -> Any:
        """Create and persist a new WorkflowExecution.  Return the object."""
        ...

    def get_execution(self, execution_id: str) -> Any | None:
        """Load a WorkflowExecution by ID."""
        ...

    def update_execution(self, execution_id: str, **kwargs: Any) -> None:
        """Update fields on a WorkflowExecution."""
        ...

    def create_node(self, execution_id: str, node_id: str, agent: str, **kwargs: Any) -> Any:
        """Create and persist a new ExecutionNode."""
        ...

    def get_node(self, node_id: str, execution_id: str) -> Any | None:
        """Load an ExecutionNode by (node_id, execution_id)."""
        ...

    def update_node(self, node_id: str, execution_id: str, **kwargs: Any) -> None:
        """Update fields on an ExecutionNode."""
        ...

    def get_execution_nodes(self, execution_id: str) -> list[Any]:
        """Return all ExecutionNode rows for an execution."""
        ...

    def get_failed_nodes(self, execution_id: str) -> list[Any]:
        """Return ExecutionNode rows with status='failed'."""
        ...


# ---------------------------------------------------------------------------
# Persistence — jobs
# ---------------------------------------------------------------------------

@runtime_checkable
class JobStore(Protocol):
    """Abstract interface for job persistence."""

    def create_job(self, agent: str, prompt: str, **kwargs: Any) -> Any:
        """Create and persist a new Job.  Return the object."""
        ...

    def get_job(self, job_id: str) -> Any | None:
        """Load a Job by ID."""
        ...

    def list_jobs(self, status: str | None = None, limit: int = 100) -> list[Any]:
        """List jobs, optionally filtered by status."""
        ...

    def update_job(self, job_id: str, **kwargs: Any) -> None:
        """Update fields on a Job."""
        ...

    def complete_job(self, job_id: str, result: dict) -> None:
        """Mark a job as completed with its result."""
        ...

    def fail_job(self, job_id: str, error: str) -> None:
        """Mark a job as failed."""
        ...

    def cancel_job(self, job_id: str) -> None:
        """Cancel a job."""
        ...
