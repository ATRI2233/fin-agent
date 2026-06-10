"""Unit tests for ``Container._SERVICE_MAP`` — lock the DI contract.

These tests lock the invariants of the container's dependency-injection
surface so future refactors cannot silently break
``Depends(get_service(...))`` in the FastAPI routers:

  1. **Coverage** — every service class the app needs is registered
     (repos, services, query services).
  2. **Key consistency** — dict key equals the class ``__name__``.
  3. **Registration API** — ``register_singleton`` / ``register_factory``
     place instances / callables into ``_instances`` / ``_factories``
     keyed by class name; second call overwrites the first.
  4. **Resolution** — ``get_service(Class)`` returns a factory that
     resolves the class from the global container, and raises a
     descriptive ``ValueError`` for unregistered classes.

The coverage lists adapt to the *current* ``_SERVICE_MAP`` state
(5 repos + 1 service + 4 query services = 10 entries).  Extend them
as Wave 4.1+4.2 adds ``ConversationService`` / ``ExecutionService`` /
``WorkflowService`` / ``SchedulerService`` / ``AgentQueryService`` /
``ExecutionQueryService`` / ``SkillQueryService``.

The global ``_container`` is reset per-test via the
``_clean_global_container`` autouse fixture so ``configure()`` calls
don't leak across tests.
"""

from __future__ import annotations

import importlib
import inspect

import pytest

from main.framework.config import Settings
from main.framework.core.container import (
    Container,
    _SERVICE_MAP,
    configure,
    get_service,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def settings() -> Settings:
    """Fresh ``Settings()`` from env defaults — no .env required."""
    return Settings()


@pytest.fixture
def container(settings: Settings) -> Container:
    """Fresh ``Container`` per test — no shared mutable state."""
    return Container(settings)


@pytest.fixture(autouse=True)
def _clean_global_container():
    """Reset module-level ``_container`` before and after each test.

    ``configure()`` mutates a module-level singleton; without this
    fixture a test's ``configure(c)`` would leak into the next test.
    """
    import main.framework.core.container as cm

    saved = cm._container
    cm._container = None
    try:
        yield
    finally:
        cm._container = saved


# ---------------------------------------------------------------------------
# Coverage lists (current state — extend as Wave 4.1+4.2 adds entries)
# ---------------------------------------------------------------------------

EXPECTED_REPOS: frozenset[str] = frozenset(
    {
        "ExecutionRepository",
        "AgentRepository",
        "WorkflowRepository",
        "ConversationRepository",
        "MaintenanceRepository",
    }
)

# Wave 4.1 will add: ConversationService, ExecutionService,
# WorkflowService, SchedulerService.
EXPECTED_SERVICES: frozenset[str] = frozenset({"SessionService"})

# Wave 4.1 will add: ExecutionQueryService, AgentQueryService,
# SkillQueryService.
EXPECTED_QUERY_SERVICES: frozenset[str] = frozenset(
    {
        "WorkflowQueryService",
        "DispatchQueryService",
        "ToolQueryService",
        "SystemQueryService",
    }
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _to_snake_case(class_name: str) -> str:
    """``WorkflowQueryService`` → ``workflow_query_service``."""
    out: list[str] = []
    for i, ch in enumerate(class_name):
        if ch.isupper() and i > 0 and not class_name[i - 1].isupper():
            out.append("_")
        out.append(ch.lower())
    return "".join(out)


def _try_import_class(class_name: str) -> type | None:
    """Best-effort import of *class_name* from framework modules.

    Tries the services path, the fully-expanded repo path, and the
    ``<name>_repo`` short form (the framework's two repo-naming
    conventions).  Returns ``None`` if no module exposes the class.
    """
    snake = _to_snake_case(class_name)
    if class_name.endswith("Repository"):
        short_repo = _to_snake_case(class_name[: -len("Repository")]) + "_repo"
    else:
        short_repo = snake
    for mod_path in (
        f"main.framework.services.{snake}",
        f"main.framework.repositories.{snake}",
        f"main.framework.repositories.{short_repo}",
        f"main.data_maintenance.services.{snake}",
    ):
        try:
            mod = importlib.import_module(mod_path)
        except ImportError:
            continue
        cls = getattr(mod, class_name, None)
        if inspect.isclass(cls):
            return cls
    return None


def _resolve_service(container: Container, prop: str) -> object | None:
    """Return ``container.<prop>`` or ``container.create_<prop>()`` fallback.

    Some entries (``session_service``) are served by factory methods
    rather than properties; this helper hides that detail so the
    constructibility test stays focused on the "does the map point to
    something real?" invariant.
    """
    if hasattr(container, prop):
        try:
            return getattr(container, prop)
        except Exception:
            pass
    factory = getattr(container, f"create_{prop}", None)
    if callable(factory):
        try:
            return factory()
        except Exception:
            return None
    return None


# ---------------------------------------------------------------------------
# 1. Coverage — repos
# ---------------------------------------------------------------------------


def test_service_map_contains_all_repos(container: Container) -> None:
    """Lock: every repository class the app uses is in ``_SERVICE_MAP``."""
    missing = EXPECTED_REPOS - _SERVICE_MAP.keys()
    assert not missing, f"Repositories missing from _SERVICE_MAP: {sorted(missing)}"


# ---------------------------------------------------------------------------
# 2. Coverage — services
# ---------------------------------------------------------------------------


def test_service_map_contains_all_services(container: Container) -> None:
    """Lock: every business-logic service class is in ``_SERVICE_MAP``."""
    missing = EXPECTED_SERVICES - _SERVICE_MAP.keys()
    assert not missing, f"Services missing from _SERVICE_MAP: {sorted(missing)}"


# ---------------------------------------------------------------------------
# 3. Coverage — query services
# ---------------------------------------------------------------------------


def test_service_map_contains_all_query_services(container: Container) -> None:
    """Lock: every read-only query service is in ``_SERVICE_MAP``."""
    missing = EXPECTED_QUERY_SERVICES - _SERVICE_MAP.keys()
    assert not missing, f"Query services missing from _SERVICE_MAP: {sorted(missing)}"


# ---------------------------------------------------------------------------
# 4. Key consistency
# ---------------------------------------------------------------------------


def test_service_map_keys_match_class_names(container: Container) -> None:
    """Lock: every key is a real, importable class whose ``__name__`` matches.

    ``get_service(SomeClass)`` looks up ``_SERVICE_MAP[SomeClass.__name__]``,
    so a typo (e.g. ``"Workflowqueryservice"``) silently falls through
    to the factory path and raises at resolution time.  We verify
    (a) the key is a valid identifier starting uppercase, and
    (b) the class is importable with a matching ``__name__``.
    """
    assert _SERVICE_MAP, "_SERVICE_MAP is empty — container is unconfigured"
    for key in _SERVICE_MAP:
        assert isinstance(key, str), f"Key {key!r} is not a string"
        assert key.isidentifier(), f"Key {key!r} is not a valid Python identifier"
        assert key[0:1].isupper(), f"Key {key!r} should start with uppercase"

        cls = _try_import_class(key)
        assert cls is not None, f"_SERVICE_MAP key {key!r} does not correspond to any importable class"
        assert cls.__name__ == key, f"Key {key!r} does not match class.__name__ {cls.__name__!r}"


# ---------------------------------------------------------------------------
# 5. Registration API — register_singleton adds
# ---------------------------------------------------------------------------


def test_register_method_adds_instance(container: Container) -> None:
    """Lock: ``register_singleton(cls, instance)`` stores under ``_instances[cls.__name__]``.

    The spec's forward-looking ``register("X", instance)`` helper
    (Wave 4.2) is a thin wrapper over the existing
    ``register_singleton(cls, instance)`` — both write to
    ``_instances[cls.__name__]``.  This test locks that invariant.
    """
    from main.framework.repositories.agent_repo import AgentRepository

    sentinel = object()
    container.register_singleton(AgentRepository, sentinel)

    assert "AgentRepository" in container._instances
    assert container._instances["AgentRepository"] is sentinel


# ---------------------------------------------------------------------------
# 6. Registration API — register_singleton overwrites
# ---------------------------------------------------------------------------


def test_register_method_overwrites_existing(container: Container) -> None:
    """Lock: a second ``register_singleton`` call replaces the first instance.

    "Last writer wins" lets test fixtures swap a real service for a
    mock without first unregistering.  If a future refactor introduces
    explicit "already-registered" guards, this test fails loudly —
    which is the correct signal to update the contract.
    """
    from main.framework.repositories.conversation_repo import ConversationRepository

    first = object()
    second = object()
    assert first is not second

    container.register_singleton(ConversationRepository, first)
    container.register_singleton(ConversationRepository, second)

    assert container._instances["ConversationRepository"] is second
    assert container._instances["ConversationRepository"] is not first


# ---------------------------------------------------------------------------
# 7. Resolution — get_service() works for a registered class
# ---------------------------------------------------------------------------


def test_get_service_works_for_registered_class(container: Container) -> None:
    """Lock: ``get_service(SomeService)()`` returns a real instance.

    This is the round-trip FastAPI controllers depend on:
    ``Depends(get_service(WorkflowQueryService))`` → closure →
    ``container.workflow_query_service`` → ``WorkflowQueryService(...)``.
    Tested directly (no ASGI client) to keep it a unit test.
    """
    from main.framework.services.workflow_query_service import WorkflowQueryService

    configure(container)
    factory = get_service(WorkflowQueryService)
    instance = factory()

    assert isinstance(instance, WorkflowQueryService)
    # Same factory call should return the same singleton (lazy caching).
    assert factory() is instance


# ---------------------------------------------------------------------------
# 8. Resolution — get_service() raises for unregistered
# ---------------------------------------------------------------------------


def test_get_service_raises_for_unregistered(container: Container) -> None:
    """Lock: ``get_service(UnregisteredClass)()`` raises ``ValueError``.

    The error path is the second branch of ``get_service`` — the
    message must name the offending class so the 500 response is
    debuggable.
    """

    class _Unregistered:
        """Throwaway class guaranteed not to be in ``_SERVICE_MAP``."""

    configure(container)
    factory = get_service(_Unregistered)

    with pytest.raises(ValueError, match="No service registered"):
        factory()


# ---------------------------------------------------------------------------
# 9. Constructibility — every entry resolves to an instance
# ---------------------------------------------------------------------------


def test_all_services_constructible_via_container(container: Container) -> None:
    """Lock: for every (key, prop) in ``_SERVICE_MAP``, ``container.<prop>`` is non-None.

    Catches both "property removed" and "property returns None"
    regressions — the map is useless if any entry points to a
    non-existent attribute.
    """
    assert _SERVICE_MAP, "_SERVICE_MAP is empty"
    for key, prop in _SERVICE_MAP.items():
        instance = _resolve_service(container, prop)
        assert instance is not None, (
            f"_SERVICE_MAP[{key!r}] = {prop!r} resolved to None — property missing or factory returned None"
        )


# ---------------------------------------------------------------------------
# 10. Uniqueness — no duplicate keys
# ---------------------------------------------------------------------------


def test_no_duplicate_keys_in_service_map(container: Container) -> None:
    """Lock: ``_SERVICE_MAP`` keys are unique and values are valid attribute names.

    Duplicate keys would silently shadow the first registration with
    the second — a copy-paste bug class.  ``dict`` already enforces
    uniqueness; this test documents the invariant for future
    maintainers who might be tempted to "merge" two maps.
    """
    keys = list(_SERVICE_MAP.keys())
    assert len(keys) == len(set(keys)), f"_SERVICE_MAP has duplicate keys: {[k for k in keys if keys.count(k) > 1]}"
    for key, prop in _SERVICE_MAP.items():
        assert isinstance(prop, str) and prop.isidentifier(), (
            f"_SERVICE_MAP[{key!r}] = {prop!r} is not a valid attribute name"
        )
