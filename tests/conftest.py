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

            test_settings = Settings()
            test_container = Container(test_settings)

            # Override repositories to use test session factory
            test_container._instances["execution_repo"] = ExecutionRepository(session_factory=test_session_factory)
            test_container._instances["agent_repo"] = AgentRepository(session_factory=test_session_factory)
            test_container._instances["workflow_repo"] = WorkflowRepository(session_factory=test_session_factory)
            test_container._instances["conversation_repo"] = ConversationRepository(session_factory=test_session_factory)

            configure(test_container)
            app.state.container = test_container
        except Exception:
            pass  # Some tests don't need the container

        transport = ASGITransport(app=app)
        return AsyncClient(transport=transport, base_url="http://test")
    except ImportError as e:
        pytest.skip(f"FastAPI app not importable: {e}")


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
