"""Pytest fixtures for fin-agent tests.

Provides isolated in-memory SQLite test database, FastAPI test client,
and per-test session reset. Does NOT touch the real data/finagent.db.
"""

import os
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session

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
def client(db_session):
    """FastAPI async test client with overridden DB dependency."""
    try:
        from httpx import AsyncClient, ASGITransport
        from main.framework.main import app
        from main.framework.models.database import get_db

        def override_get_db():
            try:
                yield db_session
            finally:
                pass  # session cleanup in db_session fixture

        app.dependency_overrides[get_db] = override_get_db
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
