"""Lightweight dependency injection container.

Centralises the creation and lifecycle of all core services.
Modules receive their dependencies via constructor injection instead
of importing concrete classes or module-level singletons.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any, TypeVar

from main.framework.config import Settings
from main.framework.core.agents.agent_dispatcher import AgentDispatcher
from main.framework.core.infrastructure.protocols import AgentBackend
from main.framework.repositories.agent_repo import AgentRepository
from main.framework.repositories.conversation_repo import ConversationRepository
from main.framework.repositories.execution_repo import ExecutionRepository
from main.framework.repositories.maintenance_repo import MaintenanceRepository
from main.framework.repositories.workflow_repo import WorkflowRepository

T = TypeVar("T")


class Container:
    """DI container — single source of truth for service instances."""

    def __init__(self, settings: Settings):
        self._settings = settings
        self._instances: dict[str, object] = {}
        self._factories: dict[str, Callable[[], Any]] = {}
        self._lock = threading.RLock()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_or_create(
        self,
        key: str,
        class_name: str | None,
        default_factory: Callable[[], Any],
    ) -> Any:
        """Thread-safe resolution: ``_instances`` -> ``_factories`` -> *default_factory*.

        If *class_name* is given and present in ``_factories``, that factory is
        preferred over *default_factory* so that ``register_factory`` overrides
        are honoured by property getters (avoids double-cache path).
        """
        with self._lock:
            if key in self._instances:
                return self._instances[key]
            if class_name and class_name in self._factories:
                instance = self._factories[class_name]()
                self._instances[key] = instance
                return instance
            instance = default_factory()
            self._instances[key] = instance
            return instance

    # ------------------------------------------------------------------
    # Registration helpers
    # ------------------------------------------------------------------

    def register_singleton(self, cls: type, instance: object) -> None:
        """Register an existing instance as a singleton for *cls*."""
        with self._lock:
            self._instances[cls.__name__] = instance

    def register_factory(self, cls: type, factory: Callable[[], Any]) -> None:
        """Register a factory callable for *cls*.

        The factory is invoked once on first access via ``get_service``
        and its return value is cached as a singleton.
        """
        with self._lock:
            self._factories[cls.__name__] = factory

    def register(self, name: str, instance: object) -> None:
        """Register *instance* under *name* (idempotent — replaces any prior value).

        Generic string-keyed helper. Used by test fixtures (see
        ``tests/conftest.py``) and any other manual wiring where a
        class-based key is inconvenient. Production code should prefer
        :meth:`register_singleton` (typed) or :meth:`register_factory`
        (lazy).
        """
        with self._lock:
            self._instances[name] = instance

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def shutdown(self) -> None:
        """Clean up all held resource instances.

        Iterates over every cached singleton and calls ``close()``,
        ``cleanup()``, ``shutdown()``, or ``stop()`` if the instance
        exposes such a method. Errors are swallowed to ensure best-effort
        teardown. Clears both ``_instances`` and ``_factories``.
        """
        with self._lock:
            for _name, instance in list(self._instances.items()):
                for method_name in ("close", "cleanup", "shutdown", "stop"):
                    closer = getattr(instance, method_name, None)
                    if callable(closer):
                        try:
                            closer()
                        except Exception: # noqa: BLE001
                            pass
            self._instances.clear()
            self._factories.clear()

    # ------------------------------------------------------------------
    # Core infrastructure
    # ------------------------------------------------------------------

    @property
    def settings(self) -> Settings:
        return self._settings

    @property
    def backend(self) -> AgentBackend:
        def _create():
            from main.session.serve_backend import ServeBackend

            return ServeBackend(
                server_url=getattr(self._settings, "SERVE_BACKEND_URL", "http://127.0.0.1:4096"),
                opencode_bin=self._settings.OPENCODE_BIN,
                cwd=".",
                default_timeout=self._settings.NODE_TIMEOUT_SECONDS,
            )

        return self._get_or_create("backend", None, _create)

    @property
    def dispatcher(self) -> AgentDispatcher:
        return self._get_or_create(
            "dispatcher", None, lambda: AgentDispatcher(self.backend)
        )

    # ------------------------------------------------------------------
    # Repositories
    # ------------------------------------------------------------------

    @property
    def execution_repo(self) -> ExecutionRepository:
        return self._get_or_create(
            "execution_repo", "ExecutionRepository", ExecutionRepository
        )

    @property
    def agent_repo(self) -> AgentRepository:
        return self._get_or_create("agent_repo", "AgentRepository", AgentRepository)

    @property
    def workflow_repo(self) -> WorkflowRepository:
        return self._get_or_create(
            "workflow_repo", "WorkflowRepository", WorkflowRepository
        )

    @property
    def conversation_repo(self) -> ConversationRepository:
        return self._get_or_create(
            "conversation_repo", "ConversationRepository", ConversationRepository
        )

    @property
    def maintenance_repo(self) -> MaintenanceRepository:
        return self._get_or_create(
            "maintenance_repo", "MaintenanceRepository", MaintenanceRepository
        )

    @property
    def event_bus(self):
        """EventBus singleton — see :meth:`create_event_bus`."""
        def _create():
            from main.framework.core.infrastructure.event_bus import EventBus
            return EventBus()
        return self._get_or_create("event_bus", "EventBus", _create)

    @property
    def workflow_query_service(self):
        """WorkflowQueryService (lazy singleton) — see :meth:`create_workflow_query_service`."""

        def _create():
            from main.framework.services.workflow_query_service import WorkflowQueryService

            return WorkflowQueryService(
                workflow_repo=self.workflow_repo,
                exec_repo=self.execution_repo,
                conv_repo=self.conversation_repo,
            )

        return self._get_or_create(
            "workflow_query_service", "WorkflowQueryService", _create
        )

    @property
    def dispatch_query_service(self):
        """DispatchQueryService (lazy singleton) — see :meth:`create_dispatch_query_service`."""

        def _create():
            from main.framework.services.dispatch_query_service import DispatchQueryService

            return DispatchQueryService(dispatcher=self.dispatcher)

        return self._get_or_create(
            "dispatch_query_service", "DispatchQueryService", _create
        )

    @property
    def tool_query_service(self):
        """ToolQueryService (lazy singleton) — see :meth:`create_tool_query_service`.

        No constructor dependencies. The tool manifest is loaded lazily on
        first call to a public method, so container init has zero file IO.
        """

        def _create():
            from main.framework.services.tool_query_service import ToolQueryService

            return ToolQueryService()

        return self._get_or_create("tool_query_service", "ToolQueryService", _create)

    @property
    def agent_query_service(self):
        """AgentQueryService (lazy singleton) — see :meth:`create_agent_query_service`.

        Business-logic facade for the agents controller ( pilot).
        Registry-backed reads (list, get_by_name) hit the in-memory
        ``core.agent_registry``; ``agent_stats`` aggregates ``ExecutionNode``
        rows bound to the caller's session.
        """

        def _create():
            from main.framework.services.agent_query_service import AgentQueryService

            return AgentQueryService(agent_repo=self.agent_repo)

        return self._get_or_create("agent_query_service", "AgentQueryService", _create)

    @property
    def system_query_service(self):
        """SystemQueryService (lazy singleton) — see :meth:`create_system_query_service`.

        Business-logic facade for the system controller ( migration).
        Aggregates cross-subsystem state (opencode binary, JobExecutor,
        ConcurrencyLimiter, SchedulerService, LogCollector, workflow cache)
        for the WebUI dashboard ``/api/v1/system/*`` endpoints. Depends on
        ``SchedulerService`` (created via :meth:`create_scheduler_service`)
        and an optional ``session_factory`` for the historical
        ``ExecutionNode`` row count.
        """

        def _create():
            from main.framework.config.database import SessionLocal
            from main.framework.services.system_query_service import SystemQueryService

            return SystemQueryService(
                scheduler_service=self.create_scheduler_service(),
                session_factory=SessionLocal,
            )

        return self._get_or_create("system_query_service", "SystemQueryService", _create)

    @property
    def session_manager(self):
        """Conversation — session mapping (lazy, needs backend)."""

        def _create():
            from main.framework.core.workflow.session_manager import ConvSessionManager

            return ConvSessionManager(self.backend)

        return self._get_or_create("session_manager", None, _create)

    # ------------------------------------------------------------------
    # Service properties ( — DI hardening)
    #
    # These thin wrappers expose the ``create_*`` factories as properties
    # so ``_SERVICE_MAP`` can reference them and ``get_service(...)`` can
    # resolve through ``getattr(container, prop)`` (the fast path). The
    # underlying ``create_*`` methods remain the canonical factories for
    # callers that prefer explicit method syntax.
    # ------------------------------------------------------------------

    @property
    def conversation_service(self):
        """Lazy singleton — see :meth:`create_conversation_service`."""
        return self.create_conversation_service()

    @property
    def execution_service(self):
        """Lazy singleton — see :meth:`create_execution_service`."""
        return self.create_execution_service()

    @property
    def workflow_service(self):
        """Lazy singleton — see :meth:`create_workflow_service`."""
        return self.create_workflow_service()

    @property
    def scheduler_service(self):
        """Lazy singleton — see :meth:`create_scheduler_service`."""
        return self.create_scheduler_service()

    @property
    def session_service(self):
        """Lazy singleton — see :meth:`create_session_service`."""
        return self.create_session_service()

    @property
    def execution_query_service(self):
        """Lazy singleton — see :meth:`create_execution_query_service`."""
        return self.create_execution_query_service()

    @property
    def skill_query_service(self):
        """Lazy singleton — see :meth:`create_skill_query_service`."""
        return self.create_skill_query_service()

    @property
    def maintenance_query_service(self):
        """Lazy singleton — see :meth:`create_maintenance_query_service`."""
        return self.create_maintenance_query_service()

    # ------------------------------------------------------------------
    # Factory methods — create per-request / per-execution instances
    # ------------------------------------------------------------------

    def create_workflow_engine(self, workflow_id: str, params: dict, db=None, status_callback=None, execution_id=None):
        """Create a fresh WorkflowEngine with injected dependencies."""
        from main.framework.config.database import SessionLocal
        from main.framework.core.workflow.workflow_engine import WorkflowEngine

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

        def _create():
            from main.framework.config.database import SessionLocal
            from main.framework.core.workflow.scheduler import WorkflowScheduler

            return WorkflowScheduler(
                session_factory=SessionLocal,
                engine_factory=self.create_workflow_engine,
            )

        return self._get_or_create("scheduler", None, _create)

    def create_debate_executor(self):
        """Create a DebateExecutor with injected dependencies."""
        from main.framework.core.agents.debate_executor import DebateExecutor

        return DebateExecutor(dispatcher=self.dispatcher)

    # ------------------------------------------------------------------
    # Service factories ( — DI registration)
    # ------------------------------------------------------------------

    def create_conversation_service(self):
        """@singleton — ConversationService(conv_repo, workflow_repo).

        Business-logic facade for conversations / messages. Repos are
        resolved lazily from the container so no eager DB connections are
        created at container init.
        """

        def _create():
            from main.framework.services.conversation_service import ConversationService

            return ConversationService(
                conv_repo=self.conversation_repo,
                workflow_repo=self.workflow_repo,
            )

        return self._get_or_create(
            "conversation_service", "ConversationService", _create
        )

    def create_execution_service(self):
        """@singleton — ExecutionService(exec_repo).

        Manages WorkflowExecution + ExecutionNode lifecycle (status
        updates, failure cascade, recording).
        """

        def _create():
            from main.framework.services.execution_service import ExecutionService

            return ExecutionService(exec_repo=self.execution_repo)

        return self._get_or_create(
            "execution_service", "ExecutionService", _create
        )

    def create_workflow_service(self):
        """@singleton — WorkflowService(workflow_repo, exec_service, registry).

        Orchestrates workflow DAG execution: topological sort, level-walking,
        dispatch, failure cascade. Depends on ExecutionService (created via
        :meth:`create_execution_service`) and NodeExecutorRegistry.
        """

        def _create():
            from main.framework.core.workflow.node_executors.registry import (
                NodeExecutorRegistry,
            )
            from main.framework.services.workflow_service import WorkflowService

            return WorkflowService(
                workflow_repo=self.workflow_repo,
                exec_service=self.create_execution_service(), # type: ignore[arg-type]
                registry=NodeExecutorRegistry(),
                dispatcher=self.dispatcher,
            )

        return self._get_or_create("workflow_service", "WorkflowService", _create)

    def create_scheduler_service(self):
        """@singleton — SchedulerService(session_factory, workflow_service).

        APScheduler wrapper for cron-based workflow execution. Depends on
        WorkflowService (created via :meth:`create_workflow_service`).
        """

        def _create():
            from main.framework.config.database import SessionLocal
            from main.framework.services.scheduler_service import SchedulerService

            return SchedulerService(
                session_factory=SessionLocal,
                workflow_service=self.create_workflow_service(),
            )

        return self._get_or_create(
            "scheduler_service", "SchedulerService", _create
        )

    def create_message_processor(self):
        """@per_execution — MessageProcessor.

        ``message_processor.py`` exposes standalone async functions
        (``process_agent_message``, ``execute_workflow_async``) rather than
        a class, so there is nothing to instantiate. This factory is a
        no-op placeholder kept for API symmetry; callers should import the
        functions directly.
        """
        return None

    def create_workflow_query_service(self):
        """@singleton — WorkflowQueryService(workflow_repo, exec_repo, conv_repo).

        Business-logic facade for the workflows controller ( pilot).
        Replaces the inline handlers that previously lived in
        ``api/workflows.py`` and supersedes ``WorkflowCrudService``. Exposes
        CRUD, stats, and trigger-workflow as a single coherent surface.
        """

        def _create():
            from main.framework.services.workflow_query_service import WorkflowQueryService

            return WorkflowQueryService(
                workflow_repo=self.workflow_repo,
                exec_repo=self.execution_repo,
                conv_repo=self.conversation_repo,
            )

        return self._get_or_create(
            "workflow_query_service", "WorkflowQueryService", _create
        )

    def create_execution_query_service(self):
        """@singleton — ExecutionQueryService(exec_repo).

        Business-logic facade for the executions controller .
        Read-only + sync operations over ``WorkflowExecution`` /
        ``ExecutionNode`` / ``Workflow``: list, detail, timeline, retry
        (creates a fresh row), abort. Replaces the inline handlers that
        previously lived in ``api/executions.py``. Async side-effects
        (engine spawn, session cleanup) remain in the controller.

        Distinct from :meth:`create_execution_service`, which owns the
        lifecycle side (status transitions, failure cascade).
        """

        def _create():
            from main.framework.services.execution_query_service import (
                ExecutionQueryService,
            )

            return ExecutionQueryService(
                exec_repo=self.execution_repo,
                workflow_repo=self.workflow_repo,
            )

        return self._get_or_create(
            "execution_query_service", "ExecutionQueryService", _create
        )

    def create_dispatch_query_service(self):
        """@singleton — DispatchQueryService(dispatcher).

        Business-logic facade for the dispatch controller ( pilot).
        Wraps :class:`AgentDispatcher` with timing, error normalisation,
        and result shaping for the ``/api/v1/dispatch`` HTTP API. Replaces
        the inline handlers that previously lived in ``api/dispatch.py``.
        """

        def _create():
            from main.framework.services.dispatch_query_service import DispatchQueryService

            return DispatchQueryService(dispatcher=self.dispatcher)

        return self._get_or_create(
            "dispatch_query_service", "DispatchQueryService", _create
        )

    def create_session_service(self):
        """@singleton — SessionService(exec_repo, conv_repo, backend).

        Session listing, lookup, and cleanup.
        """

        def _create():
            from main.framework.services.session_service import SessionService

            return SessionService(
                exec_repo=self.execution_repo,
                conv_repo=self.conversation_repo,
                backend=self.backend,
            )

        return self._get_or_create("session_service", "SessionService", _create)

    def create_tool_query_service(self):
        """@singleton — ToolQueryService().

        Business-logic facade for the tools controller ( pilot). Reads
        the tool manifest lazily on first public-method call so the container
        does not do file IO at init time. No constructor dependencies.
        """

        def _create():
            from main.framework.services.tool_query_service import ToolQueryService

            return ToolQueryService()

        return self._get_or_create("tool_query_service", "ToolQueryService", _create)

    def create_system_query_service(self):
        """@singleton — SystemQueryService(scheduler_service).

        Business-logic facade for the system controller ( pilot).
        Aggregates opencode / executor / concurrency / scheduler / sessions
        / log-collector / workflow-cache state for the ``/api/v1/system``
        HTTP API. Depends on :class:`SchedulerService` (created via
        :meth:`create_scheduler_service`).
        """

        def _create():
            from main.framework.services.system_query_service import SystemQueryService

            return SystemQueryService(
                scheduler_service=self.create_scheduler_service(),
            )

        return self._get_or_create(
            "system_query_service", "SystemQueryService", _create
        )

    def create_skill_query_service(self):
        """@singleton — SkillQueryService().

        Business-logic facade for the skills controller . No
        constructor dependencies; the static catalog lives on the
        module-level ``SKILLS`` constant.
        """

        def _create():
            from main.framework.services.skill_query_service import SkillQueryService

            return SkillQueryService()

        return self._get_or_create("skill_query_service", "SkillQueryService", _create)

    def create_conv_session_manager(self):
        """@singleton — ConvSessionManager(backend).

        Maps conversation IDs to HAPI session IDs. Delegates to the
        existing ``session_manager`` property which already handles lazy
        init and caching.
        """
        return self.session_manager


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
        raise RuntimeError("Container not configured — call configure() first")
    return _container


# Interface — container-property mapping for get_service lookup.
# Keys are class-name strings (e.g. "WorkflowQueryService"), values are the
# attribute name on the Container instance to fetch. (DI hardening)
# extends this to every service class so Depends(get_service(...)) resolves
# through the property path (lazy singleton) rather than the factory
# fallback. Tests that pre-register instances should use the matching
# property name (e.g. ``register("conversation_service", instance)``) to
# override the lazy default; class-name keys remain supported via the
# factory fallback for backwards compatibility.
_SERVICE_MAP: dict[str, str] = {
    # ----- Repositories -------------------------------------------------
    "ExecutionRepository": "execution_repo",
    "AgentRepository": "agent_repo",
    "WorkflowRepository": "workflow_repo",
    "ConversationRepository": "conversation_repo",
    "MaintenanceRepository": "maintenance_repo",
    # ----- Business-logic services -----------------------------
    "ConversationService": "conversation_service",
    "ExecutionService": "execution_service",
    "WorkflowService": "workflow_service",
    "SchedulerService": "scheduler_service",
    "SessionService": "session_service",
    # ----- Query services ( pilot + + ) --------------
    "WorkflowQueryService": "workflow_query_service",
    "ExecutionQueryService": "execution_query_service",
    "AgentQueryService": "agent_query_service",
    "SystemQueryService": "system_query_service",
    "DispatchQueryService": "dispatch_query_service",
    "ToolQueryService": "tool_query_service",
    "SkillQueryService": "skill_query_service",
    "MaintenanceQueryService": "maintenance_query_service",
    # ----- Infrastructure -----------------------------------------------
    "EventBus": "event_bus",
}


def get_service(interface: type[T]):
    """FastAPI ``Depends`` factory — resolve *interface* from the DI container.

    Usage::

        @router.get("/agents")
        async def list_agents(
            repo: AgentRepository = Depends(get_service(AgentRepository)),
        ):
            ...
    """
    prop = _SERVICE_MAP.get(interface.__name__)
    if prop is not None:

        def _from_property() -> T:
            return getattr(get_container(), prop) # type: ignore[return-value]

        return _from_property

    # Fall back to registered factories
    def _from_factory() -> T:
        c = get_container()
        key = interface.__name__
        with c._lock:
            if key in c._instances:
                return c._instances[key] # type: ignore[return-value]
            if key in c._factories:
                instance = c._factories[key]()
                c._instances[key] = instance
                return instance # type: ignore[return-value]
        raise ValueError(f"No service registered for {interface.__name__}")

    return _from_factory
