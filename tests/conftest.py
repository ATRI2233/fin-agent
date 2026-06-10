"""Pytest fixtures for fin-agent tests.

Provides isolated in-memory SQLite test database, FastAPI test client,
and per-test session reset. Does NOT touch the real data/finagent.db.
"""

import os
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

# Ensure project root is in path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@pytest.fixture(scope="session")
def test_engine():
    """In-memory SQLite engine with WAL mode enabled."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def set_pragma(dbapi_connection, _):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


@pytest.fixture(scope="session")
def test_session_factory(test_engine):
    """Session factory bound to test engine."""
    return sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(scope="function")
def db_session(test_engine, test_session_factory):
    """Per-test database session with schema reset."""
    from main.framework.models.database import Base

    Base.metadata.drop_all(bind=test_engine)
    Base.metadata.create_all(bind=test_engine)

    # Also create maintenance tables
    try:
        from main.data_maintenance.models.maintenance_db import MaintenanceBase

        MaintenanceBase.metadata.create_all(bind=test_engine)
    except (ImportError, AttributeError):
        pass

    session = test_session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(scope="function")
def client(db_session, test_session_factory):
    """FastAPI async test client with overridden DB dependency and configured Container."""
    try:
        from httpx import ASGITransport, AsyncClient

        from main.framework.main import app
        from main.framework.models.database import get_db

        def override_get_db():
            try:
                yield db_session
            finally:
                pass  # session cleanup in db_session fixture

        app.dependency_overrides[get_db] = override_get_db

        # Configure the DI container for tests that need it (e.g. triggers)
        try:
            from main.framework.config import Settings
            from main.framework.core.container import Container, configure
            from main.framework.repositories.agent_repo import AgentRepository
            from main.framework.repositories.conversation_repo import ConversationRepository
            from main.framework.repositories.execution_repo import ExecutionRepository
            from main.framework.repositories.workflow_repo import WorkflowRepository
            from main.framework.services.conversation_service import ConversationService
            from main.framework.services.dispatch_query_service import DispatchQueryService
            from main.framework.services.scheduler_service import SchedulerService
            from main.framework.services.session_service import SessionService
            from main.framework.services.workflow_query_service import WorkflowQueryService

            test_settings = Settings()
            test_container = Container(test_settings)

            # Override repositories to use test session factory
            test_container._instances["execution_repo"] = ExecutionRepository(session_factory=test_session_factory)
            test_container._instances["agent_repo"] = AgentRepository(session_factory=test_session_factory)
            test_container._instances["workflow_repo"] = WorkflowRepository(session_factory=test_session_factory)
            test_container._instances["conversation_repo"] = ConversationRepository(
                session_factory=test_session_factory
            )

            # W3.4 fix: Register ConversationService so Depends(get_service(...)) resolves
            # in controllers (which were moved out of api/conversations.py in W3.2).
            # Without this, integration tests fail with
            # "No service registered for ConversationService".
            test_container._instances["ConversationService"] = ConversationService(
                conv_repo=test_container._instances["conversation_repo"],
                workflow_repo=test_container._instances["workflow_repo"],
            )

            # W5.3 fix: Register SchedulerService so Depends(get_service(...)) resolves
            # in api/scheduler_routes.py (which was migrated from get_scheduler() to DI).
            # workflow_service is None because the route tests only exercise add/remove/list —
            # they never let APScheduler fire a job (the test fixture never calls start()).
            test_container._instances["SchedulerService"] = SchedulerService(
                session_factory=test_session_factory,
                workflow_service=None,
            )

            # Phase 2 fix: Register WorkflowQueryService and SessionService
            # so Depends(get_service(...)) resolves in the refactored controllers.
            # WorkflowQueryService (Wave 2 pilot) supersedes the legacy
            # WorkflowCrudService — its lookup key is the class name because
            # the service is registered through get_service(WorkflowQueryService),
            # which falls through to the _from_factory path that uses
            # interface.__name__ as the dict key.
            test_container._instances["WorkflowQueryService"] = WorkflowQueryService(
                workflow_repo=test_container._instances["workflow_repo"],
                exec_repo=test_container._instances["execution_repo"],
                conv_repo=test_container._instances["conversation_repo"],
            )
            # Phase 3 fix: Register DispatchQueryService so Depends(get_service(...))
            # resolves in the refactored dispatch controller. Mirrors the
            # WorkflowQueryService registration above — the production container
            # resolves it via the ``dispatch_query_service`` property, but the
            # test container needs the explicit instance under the class name
            # so the ``_from_factory`` fallback path picks it up.
            test_container._instances["DispatchQueryService"] = DispatchQueryService(
                dispatcher=test_container.dispatcher,
            )
            test_container._instances["SessionService"] = SessionService(
                exec_repo=test_container._instances["execution_repo"],
                conv_repo=test_container._instances["conversation_repo"],
                backend=None,  # no real backend in tests
            )

            # W7.x fix: Register MaintenanceQueryService so
            # Depends(get_service(...)) resolves in the data-maintenance
            # controller (which was moved out of api/data_maintenance.py).
            # We use a mock core service (no dispatcher) — controllers that
            # exercise business logic will override this with a real
            # DataMaintenanceService bound to the test session.
            from main.data_maintenance.core.data_maintenance import (
                DataMaintenanceService,
            )
            from main.data_maintenance.services.maintenance_query_service import (
                MaintenanceQueryService,
            )

            test_container._instances["MaintenanceQueryService"] = MaintenanceQueryService(
                DataMaintenanceService(dispatcher=None, scheduler=None)
            )

            configure(test_container)
            app.state.container = test_container
        except Exception:
            pass  # Some tests don't need the container

        transport = ASGITransport(app=app)
        return AsyncClient(transport=transport, base_url="http://test")
    except ImportError as e:
        pytest.skip(f"FastAPI app not importable: {e}")


@pytest.fixture(autouse=True)
def reset_container_scheduler():
    """Reset container scheduler between tests."""
    yield
    try:
        from main.framework.core.container import get_container

        container = get_container()
        if container and hasattr(container, "_instances"):
            container._instances.pop("scheduler", None)
    except Exception:
        pass


@pytest.fixture(scope="function")
def maintenance_db_session(test_engine, test_session_factory):
    """Per-test session for maintenance DB tables."""
    try:
        from main.data_maintenance.models.maintenance_db import MaintenanceBase

        MaintenanceBase.metadata.drop_all(bind=test_engine)
        MaintenanceBase.metadata.create_all(bind=test_engine)
    except (ImportError, AttributeError):
        pytest.skip("MaintenanceBase not importable")

    session = test_session_factory()
    try:
        yield session
    finally:
        session.close()
