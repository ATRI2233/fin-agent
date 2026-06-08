"""Lightweight dependency injection container.

Centralises the creation and lifecycle of all core services.
Modules receive their dependencies via constructor injection instead
of importing concrete classes or module-level singletons.
"""

from __future__ import annotations

from main.framework.config import Settings
from main.framework.core.agent_dispatcher import AgentDispatcher
from main.framework.core.hapi_bridge import HAPIBridge
from main.framework.core.protocols import AgentBackend
from main.framework.repositories.execution_repo import ExecutionRepository


class Container:
    """DI container — single source of truth for service instances."""

    def __init__(self, settings: Settings):
        self._settings = settings
        self._instances: dict[str, object] = {}

    # ------------------------------------------------------------------
    # Core infrastructure
    # ------------------------------------------------------------------

    @property
    def settings(self) -> Settings:
        return self._settings

    @property
    def backend(self) -> AgentBackend:
        if "backend" not in self._instances:
            self._instances["backend"] = HAPIBridge(
                hub_url=self._settings.HAPI_HUB_URL,
                api_token=self._settings.HAPI_API_TOKEN,
            )
        return self._instances["backend"]  # type: ignore[return-value]

    @property
    def dispatcher(self) -> AgentDispatcher:
        if "dispatcher" not in self._instances:
            self._instances["dispatcher"] = AgentDispatcher(self.backend)
        return self._instances["dispatcher"]  # type: ignore[return-value]

    # ------------------------------------------------------------------
    # Repositories
    # ------------------------------------------------------------------

    @property
    def execution_repo(self) -> ExecutionRepository:
        if "execution_repo" not in self._instances:
            self._instances["execution_repo"] = ExecutionRepository()
        return self._instances["execution_repo"]  # type: ignore[return-value]

    # ------------------------------------------------------------------
    # Factory methods — create per-request / per-execution instances
    # ------------------------------------------------------------------

    def create_workflow_engine(
        self, workflow_id: str, params: dict, status_callback=None
    ):
        """Create a fresh WorkflowEngine with injected dependencies."""
        from main.framework.core.workflow_engine import WorkflowEngine

        return WorkflowEngine(
            workflow_id=workflow_id,
            params=params,
            dispatcher=self.dispatcher,
            status_callback=status_callback,
        )

    def create_scheduler(self):
        """Create or return the WorkflowScheduler singleton."""
        from main.framework.core.scheduler import WorkflowScheduler

        if "scheduler" not in self._instances:
            self._instances["scheduler"] = WorkflowScheduler()
        return self._instances["scheduler"]  # type: ignore[return-value]

    def create_debate_executor(self):
        """Create a DebateExecutor with injected dependencies."""
        from main.framework.core.debate_executor import DebateExecutor

        return DebateExecutor(dispatcher=self.dispatcher)
