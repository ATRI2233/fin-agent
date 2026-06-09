"""Lightweight dependency injection container.

Centralises the creation and lifecycle of all core services.
Modules receive their dependencies via constructor injection instead
of importing concrete classes or module-level singletons.
"""

from __future__ import annotations

from typing import Any, Callable, Type, TypeVar

from main.framework.config import Settings
from main.framework.core.agent_dispatcher import AgentDispatcher
from main.framework.core.protocols import AgentBackend
from main.framework.repositories.execution_repo import ExecutionRepository
from main.framework.repositories.agent_repo import AgentRepository
from main.framework.repositories.workflow_repo import WorkflowRepository
from main.framework.repositories.conversation_repo import ConversationRepository
from main.framework.repositories.maintenance_repo import MaintenanceRepository

T = TypeVar("T")


class Container:
    """DI container —?single source of truth for service instances."""

    def __init__(self, settings: Settings):
        self._settings = settings
        self._instances: dict[str, object] = {}
        self._factories: dict[str, Callable[[], Any]] = {}

    # ------------------------------------------------------------------
    # Registration helpers
    # ------------------------------------------------------------------

    def register_singleton(self, cls: type, instance: object) -> None:
        """Register an existing instance as a singleton for *cls*."""
        self._instances[cls.__name__] = instance

    def register_factory(self, cls: type, factory: Callable[[], Any]) -> None:
        """Register a factory callable for *cls*.

        The factory is invoked once on first access via ``get_service``
        and its return value is cached as a singleton.
        """
        self._factories[cls.__name__] = factory

    # ------------------------------------------------------------------
    # Core infrastructure
    # ------------------------------------------------------------------

    @property
    def settings(self) -> Settings:
        return self._settings

    @property
    def backend(self) -> AgentBackend:
        if "backend" not in self._instances:
            from main.session.opencode_backend import OpenCodeBackend

            self._instances["backend"] = OpenCodeBackend(
                opencode_bin=self._settings.OPENCODE_BIN,
                max_concurrent=self._settings.MAX_CONCURRENT_SESSIONS,
                cwd=".",
                default_timeout=self._settings.NODE_TIMEOUT_SECONDS,
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

    @property
    def agent_repo(self) -> AgentRepository:
        if "agent_repo" not in self._instances:
            self._instances["agent_repo"] = AgentRepository()
        return self._instances["agent_repo"]  # type: ignore[return-value]

    @property
    def workflow_repo(self) -> WorkflowRepository:
        if "workflow_repo" not in self._instances:
            self._instances["workflow_repo"] = WorkflowRepository()
        return self._instances["workflow_repo"]  # type: ignore[return-value]

    @property
    def conversation_repo(self) -> ConversationRepository:
        if "conversation_repo" not in self._instances:
            self._instances["conversation_repo"] = ConversationRepository()
        return self._instances["conversation_repo"]  # type: ignore[return-value]

    @property
    def maintenance_repo(self) -> MaintenanceRepository:
        if "maintenance_repo" not in self._instances:
            self._instances["maintenance_repo"] = MaintenanceRepository()
        return self._instances["maintenance_repo"]  # type: ignore[return-value]

    @property
    def session_manager(self):
        """Conversation —?session mapping (lazy, needs backend)."""
        if "session_manager" not in self._instances:
            from main.framework.api.conversations import ConvSessionManager

            self._instances["session_manager"] = ConvSessionManager(self.backend)
        return self._instances["session_manager"]

    # ------------------------------------------------------------------
    # Factory methods —?create per-request / per-execution instances
    # ------------------------------------------------------------------

    def create_workflow_engine(self, workflow_id: str, params: dict, db=None, status_callback=None, execution_id=None):
        """Create a fresh WorkflowEngine with injected dependencies."""
        from main.framework.core.workflow_engine import WorkflowEngine
        from main.framework.config.database import SessionLocal

        if db is None:
            db = SessionLocal()
        return WorkflowEngine(
            workflow_id=workflow_id,
            params=params,
            dispatcher=self.dispatcher,
            db=db,
            status_callback=status_callback,
            execution_id=execution_id,
        )

    def create_scheduler(self):
        """Create or return the WorkflowScheduler singleton."""
        from main.framework.core.scheduler import WorkflowScheduler
        from main.framework.config.database import SessionLocal

        if "scheduler" not in self._instances:
            self._instances["scheduler"] = WorkflowScheduler(
                session_factory=SessionLocal,
                engine_factory=self.create_workflow_engine,
            )
        return self._instances["scheduler"]  # type: ignore[return-value]

    def create_debate_executor(self):
        """Create a DebateExecutor with injected dependencies."""
        from main.framework.core.debate_executor import DebateExecutor

        return DebateExecutor(dispatcher=self.dispatcher)


# ------------------------------------------------------------------
# Module-level container reference & FastAPI dependency factory
# ------------------------------------------------------------------

_container: Container | None = None


def configure(container: Container) -> None:
    """Set the global container instance (called once at startup)."""
    global _container
    _container = container


def get_container() -> Container:
    """Return the global container. Raises if not configured."""
    if _container is None:
        raise RuntimeError("Container not configured —?call configure() first")
    return _container


# Interface —?container-property mapping for get_service lookup
_SERVICE_MAP: dict[type, str] = {
    ExecutionRepository: "execution_repo",
    AgentRepository: "agent_repo",
    WorkflowRepository: "workflow_repo",
    ConversationRepository: "conversation_repo",
    MaintenanceRepository: "maintenance_repo",
}


def get_service(interface: Type[T]):
    """FastAPI ``Depends`` factory —?resolve *interface* from the DI container.

    Usage::

        @router.get("/agents")
        async def list_agents(
            repo: AgentRepository = Depends(get_service(AgentRepository)),
        ):
            ...
    """
    prop = _SERVICE_MAP.get(interface)
    if prop is not None:

        def _from_property() -> T:
            return getattr(get_container(), prop)  # type: ignore[return-value]

        return _from_property

    # Fall back to registered factories
    def _from_factory() -> T:
        c = get_container()
        key = interface.__name__
        if key in c._instances:
            return c._instances[key]  # type: ignore[return-value]
        if key in c._factories:
            instance = c._factories[key]()
            c._instances[key] = instance
            return instance  # type: ignore[return-value]
        raise ValueError(f"No service registered for {interface.__name__}")

    return _from_factory
