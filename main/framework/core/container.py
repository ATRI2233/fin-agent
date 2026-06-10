"""Lightweight dependency injection container.

Centralises the creation and lifecycle of all core services.
Modules receive their dependencies via constructor injection instead
of importing concrete classes or module-level singletons.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypeVar

from main.framework.config import Settings
from main.framework.core.agent_dispatcher import AgentDispatcher
from main.framework.core.protocols import AgentBackend
from main.framework.repositories.agent_repo import AgentRepository
from main.framework.repositories.conversation_repo import ConversationRepository
from main.framework.repositories.execution_repo import ExecutionRepository
from main.framework.repositories.maintenance_repo import MaintenanceRepository
from main.framework.repositories.workflow_repo import WorkflowRepository

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

    def register(self, name: str, instance: object) -> None:
        """Register *instance* under *name* (idempotent — replaces any prior value).

        Generic string-keyed helper.  Used by test fixtures (see
        ``tests/conftest.py``) and any other manual wiring where a
        class-based key is inconvenient.  Production code should prefer
        :meth:`register_singleton` (typed) or :meth:`register_factory`
        (lazy).
        """
        self._instances[name] = instance

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
    def workflow_query_service(self):
        """WorkflowQueryService (lazy singleton) — see :meth:`create_workflow_query_service`."""
        if "workflow_query_service" not in self._instances:
            from main.framework.services.workflow_query_service import WorkflowQueryService

            self._instances["workflow_query_service"] = WorkflowQueryService(
                workflow_repo=self.workflow_repo,
                exec_repo=self.execution_repo,
                conv_repo=self.conversation_repo,
            )
        return self._instances["workflow_query_service"]

    @property
    def dispatch_query_service(self):
        """DispatchQueryService (lazy singleton) — see :meth:`create_dispatch_query_service`."""
        if "dispatch_query_service" not in self._instances:
            from main.framework.services.dispatch_query_service import DispatchQueryService

            self._instances["dispatch_query_service"] = DispatchQueryService(
                dispatcher=self.dispatcher,
            )
        return self._instances["dispatch_query_service"]

    @property
    def tool_query_service(self):
        """ToolQueryService (lazy singleton) — see :meth:`create_tool_query_service`.

        No constructor dependencies.  The tool manifest is loaded lazily on
        first call to a public method, so container init has zero file IO.
        """
        if "tool_query_service" not in self._instances:
            from main.framework.services.tool_query_service import ToolQueryService

            self._instances["tool_query_service"] = ToolQueryService()
        return self._instances["tool_query_service"]

    @property
    def agent_query_service(self):
        """AgentQueryService (lazy singleton) — see :meth:`create_agent_query_service`.

        Business-logic facade for the agents controller (Wave 2 pilot).
        Registry-backed reads (list, get_by_name) hit the in-memory
        ``core.agent_registry``; ``agent_stats`` aggregates ``ExecutionNode``
        rows bound to the caller's session.
        """
        if "agent_query_service" not in self._instances:
            from main.framework.services.agent_query_service import AgentQueryService

            self._instances["agent_query_service"] = AgentQueryService(
                agent_repo=self.agent_repo,
            )
        return self._instances["agent_query_service"]

    @property
    def system_query_service(self):
        """SystemQueryService (lazy singleton) — see :meth:`create_system_query_service`.

        Business-logic facade for the system controller (Wave 3 migration).
        Aggregates cross-subsystem state (opencode binary, JobExecutor,
        ConcurrencyLimiter, SchedulerService, LogCollector, workflow cache)
        for the WebUI dashboard ``/api/v1/system/*`` endpoints.  Depends on
        ``SchedulerService`` (created via :meth:`create_scheduler_service`)
        and an optional ``session_factory`` for the historical
        ``ExecutionNode`` row count.
        """
        if "system_query_service" not in self._instances:
            from main.framework.config.database import SessionLocal
            from main.framework.services.system_query_service import SystemQueryService

            self._instances["system_query_service"] = SystemQueryService(
                scheduler_service=self.create_scheduler_service(),
                session_factory=SessionLocal,
            )
        return self._instances["system_query_service"]

    @property
    def session_manager(self):
        """Conversation —?session mapping (lazy, needs backend)."""
        if "session_manager" not in self._instances:
            from main.framework.core.session_manager import ConvSessionManager

            self._instances["session_manager"] = ConvSessionManager(self.backend)
        return self._instances["session_manager"]

    # ------------------------------------------------------------------
    # Service properties (Wave 4 — DI hardening)
    #
    # These thin wrappers expose the ``create_*`` factories as properties
    # so ``_SERVICE_MAP`` can reference them and ``get_service(...)`` can
    # resolve through ``getattr(container, prop)`` (the fast path).  The
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
    # Factory methods —?create per-request / per-execution instances
    # ------------------------------------------------------------------

    def create_workflow_engine(self, workflow_id: str, params: dict, db=None, status_callback=None, execution_id=None):
        """Create a fresh WorkflowEngine with injected dependencies."""
        from main.framework.config.database import SessionLocal
        from main.framework.core.workflow_engine import WorkflowEngine

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
        from main.framework.config.database import SessionLocal
        from main.framework.core.scheduler import WorkflowScheduler

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
    # Service factories (Wave 6 — DI registration)
    # ------------------------------------------------------------------

    def create_conversation_service(self):
        """@singleton — ConversationService(conv_repo, workflow_repo).

        Business-logic facade for conversations / messages.  Repos are
        resolved lazily from the container so no eager DB connections are
        created at container init.
        """
        from main.framework.services.conversation_service import ConversationService

        if "conversation_service" not in self._instances:
            self._instances["conversation_service"] = ConversationService(
                conv_repo=self.conversation_repo,
                workflow_repo=self.workflow_repo,
            )
        return self._instances["conversation_service"]

    def create_execution_service(self):
        """@singleton — ExecutionService(exec_repo).

        Manages WorkflowExecution + ExecutionNode lifecycle (status
        updates, failure cascade, recording).
        """
        from main.framework.services.execution_service import ExecutionService

        if "execution_service" not in self._instances:
            self._instances["execution_service"] = ExecutionService(
                exec_repo=self.execution_repo,
            )
        return self._instances["execution_service"]

    def create_workflow_service(self):
        """@singleton — WorkflowService(workflow_repo, exec_service, registry).

        Orchestrates workflow DAG execution: topological sort, level-walking,
        dispatch, failure cascade.  Depends on ExecutionService (created via
        :meth:`create_execution_service`) and NodeExecutorRegistry.
        """
        from main.framework.core.workflow.node_executors.registry import (
            NodeExecutorRegistry,
        )
        from main.framework.services.workflow_service import WorkflowService

        if "workflow_service" not in self._instances:
            self._instances["workflow_service"] = WorkflowService(
                workflow_repo=self.workflow_repo,
                exec_service=self.create_execution_service(),  # type: ignore[arg-type]
                registry=NodeExecutorRegistry(),
                dispatcher=self.dispatcher,
            )
        return self._instances["workflow_service"]

    def create_scheduler_service(self):
        """@singleton — SchedulerService(session_factory, workflow_service).

        APScheduler wrapper for cron-based workflow execution.  Depends on
        WorkflowService (created via :meth:`create_workflow_service`).
        """
        from main.framework.config.database import SessionLocal
        from main.framework.services.scheduler_service import SchedulerService

        if "scheduler_service" not in self._instances:
            self._instances["scheduler_service"] = SchedulerService(
                session_factory=SessionLocal,
                workflow_service=self.create_workflow_service(),
            )
        return self._instances["scheduler_service"]

    def create_message_processor(self):
        """@per_execution — MessageProcessor.

        ``message_processor.py`` exposes standalone async functions
        (``process_agent_message``, ``execute_workflow_async``) rather than
        a class, so there is nothing to instantiate.  This factory is a
        no-op placeholder kept for API symmetry; callers should import the
        functions directly.
        """
        return None

    def create_workflow_query_service(self):
        """@singleton — WorkflowQueryService(workflow_repo, exec_repo, conv_repo).

        Business-logic facade for the workflows controller (Wave 2 pilot).
        Replaces the inline handlers that previously lived in
        ``api/workflows.py`` and supersedes ``WorkflowCrudService``.  Exposes
        CRUD, stats, and trigger-workflow as a single coherent surface.
        """
        from main.framework.services.workflow_query_service import WorkflowQueryService

        if "workflow_query_service" not in self._instances:
            self._instances["workflow_query_service"] = WorkflowQueryService(
                workflow_repo=self.workflow_repo,
                exec_repo=self.execution_repo,
                conv_repo=self.conversation_repo,
            )
        return self._instances["workflow_query_service"]

    def create_execution_query_service(self):
        """@singleton — ExecutionQueryService(exec_repo).

        Business-logic facade for the executions controller (Wave 3).
        Read-only + sync operations over ``WorkflowExecution`` /
        ``ExecutionNode`` / ``Workflow``: list, detail, timeline, retry
        (creates a fresh row), abort.  Replaces the inline handlers that
        previously lived in ``api/executions.py``.  Async side-effects
        (engine spawn, session cleanup) remain in the controller.

        Distinct from :meth:`create_execution_service`, which owns the
        lifecycle side (status transitions, failure cascade).
        """
        from main.framework.services.execution_query_service import (
            ExecutionQueryService,
        )

        if "execution_query_service" not in self._instances:
            self._instances["execution_query_service"] = ExecutionQueryService(
                exec_repo=self.execution_repo,
            )
        return self._instances["execution_query_service"]

    def create_dispatch_query_service(self):
        """@singleton — DispatchQueryService(dispatcher).

        Business-logic facade for the dispatch controller (Wave 2 pilot).
        Wraps :class:`AgentDispatcher` with timing, error normalisation,
        and result shaping for the ``/api/v1/dispatch`` HTTP API.  Replaces
        the inline handlers that previously lived in ``api/dispatch.py``.
        """
        from main.framework.services.dispatch_query_service import DispatchQueryService

        if "dispatch_query_service" not in self._instances:
            self._instances["dispatch_query_service"] = DispatchQueryService(
                dispatcher=self.dispatcher,
            )
        return self._instances["dispatch_query_service"]

    def create_session_service(self):
        """@singleton — SessionService(exec_repo, conv_repo, backend).

        Session listing, lookup, and cleanup.
        """
        from main.framework.services.session_service import SessionService

        if "session_service" not in self._instances:
            self._instances["session_service"] = SessionService(
                exec_repo=self.execution_repo,
                conv_repo=self.conversation_repo,
                backend=self.backend,
            )
        return self._instances["session_service"]

    def create_tool_query_service(self):
        """@singleton — ToolQueryService().

        Business-logic facade for the tools controller (Wave 2 pilot).  Reads
        the tool manifest lazily on first public-method call so the container
        does not do file IO at init time.  No constructor dependencies.
        """
        from main.framework.services.tool_query_service import ToolQueryService

        if "tool_query_service" not in self._instances:
            self._instances["tool_query_service"] = ToolQueryService()
        return self._instances["tool_query_service"]

    def create_system_query_service(self):
        """@singleton — SystemQueryService(scheduler_service).

        Business-logic facade for the system controller (Wave 2 pilot).
        Aggregates opencode / executor / concurrency / scheduler / sessions
        / log-collector / workflow-cache state for the ``/api/v1/system``
        HTTP API.  Depends on :class:`SchedulerService` (created via
        :meth:`create_scheduler_service`).
        """
        from main.framework.services.system_query_service import SystemQueryService

        if "system_query_service" not in self._instances:
            self._instances["system_query_service"] = SystemQueryService(
                scheduler_service=self.create_scheduler_service(),
            )
        return self._instances["system_query_service"]

    def create_skill_query_service(self):
        """@singleton — SkillQueryService().

        Business-logic facade for the skills controller (Wave 3).  No
        constructor dependencies; the static catalog lives on the
        module-level ``SKILLS`` constant.
        """
        from main.framework.services.skill_query_service import SkillQueryService

        if "skill_query_service" not in self._instances:
            self._instances["skill_query_service"] = SkillQueryService()
        return self._instances["skill_query_service"]

    def create_maintenance_query_service(self):
        """@singleton — MaintenanceQueryService(maintenance_service).

        Business-logic facade for the data-maintenance controller
        (Wave 7).  Depends on a ``DataMaintenanceService`` core.  In
        production, ``main.py`` startup registers a factory that
        captures the freshly-initialised core; in tests, the conftest
        pre-registers an instance under ``"maintenance_query_service"``
        (property name) so this fallback path is bypassed.

        The fallback below uses ``dispatcher=self.dispatcher`` so the
        instance is fully constructible in any container context.
        """
        from main.data_maintenance.core.data_maintenance import DataMaintenanceService
        from main.data_maintenance.services.maintenance_query_service import (
            MaintenanceQueryService,
        )

        if "maintenance_query_service" not in self._instances:
            self._instances["maintenance_query_service"] = MaintenanceQueryService(
                DataMaintenanceService(dispatcher=self.dispatcher, scheduler=None)
            )
        return self._instances["maintenance_query_service"]

    def create_conv_session_manager(self):
        """@singleton — ConvSessionManager(backend).

        Maps conversation IDs to HAPI session IDs.  Delegates to the
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
        raise RuntimeError("Container not configured —?call configure() first")
    return _container


# Interface —?container-property mapping for get_service lookup.
# Keys are class-name strings (e.g. "WorkflowQueryService"), values are the
# attribute name on the Container instance to fetch.  Wave 4 (DI hardening)
# extends this to every service class so Depends(get_service(...)) resolves
# through the property path (lazy singleton) rather than the factory
# fallback.  Tests that pre-register instances should use the matching
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
    # ----- Business-logic services (Wave 6) -----------------------------
    "ConversationService": "conversation_service",
    "ExecutionService": "execution_service",
    "WorkflowService": "workflow_service",
    "SchedulerService": "scheduler_service",
    "SessionService": "session_service",
    # ----- Query services (Wave 2 pilot + Wave 3 + Wave 7) --------------
    "WorkflowQueryService": "workflow_query_service",
    "ExecutionQueryService": "execution_query_service",
    "AgentQueryService": "agent_query_service",
    "SystemQueryService": "system_query_service",
    "DispatchQueryService": "dispatch_query_service",
    "ToolQueryService": "tool_query_service",
    "SkillQueryService": "skill_query_service",
    "MaintenanceQueryService": "maintenance_query_service",
}


def get_service(interface: type[T]):
    """FastAPI ``Depends`` factory —?resolve *interface* from the DI container.

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
