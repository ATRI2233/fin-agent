"""Shared test fixtures — in-memory SQLite DB, test session, FastAPI test client."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# TASK-500: shim importer switched on 2026-06-19
# NOTE: Conftest heavily uses legacy framework. New system uses
# create_app() from src/main/api/app.py and DI Registry. Legacy
# test fixtures are kept as placeholders so import succeeds; runtime
# test logic is not updated (TASK-501 territory).
from src.main.infra.db import Base

# ---------------------------------------------------------------------------
# Database fixtures
# ---------------------------------------------------------------------------

# In-memory SQLite — each test gets a fresh database.
TEST_ENGINE = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
TestSession = sessionmaker(autocommit=False, autoflush=False, bind=TEST_ENGINE)


@pytest.fixture(autouse=True)
def _reset_db():
    """Create all tables before each test, drop after."""
    Base.metadata.create_all(bind=TEST_ENGINE)
    yield
    Base.metadata.drop_all(bind=TEST_ENGINE)


@pytest.fixture()
def db() -> Session:
    """Yield a SQLAlchemy session that rolls back after each test."""
    session = TestSession()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


# ---------------------------------------------------------------------------
# FastAPI test client
# ---------------------------------------------------------------------------

@pytest.fixture()
def client(db: Session):
    """Return a TestClient with the DB dependency overridden.

    Patches ``get_service`` factories so repositories use the test session.
    """
    # TODO: get_container removed; new system uses src/main/infra/di.py Registry
    # Provide stub for legacy conftest usage
    class _StubContainer:
        @property
        def conversation_repo(self): return None
    container = _StubContainer()
    original_conv_repo = container.__class__.conversation_repo

    def _test_conv_repo(self):
        # TODO: SqlAlchemyConversationRepository in new system takes uow_factory, not db
        from src.main.modules.conversation.repo.conversation_repo import SqlAlchemyConversationRepository
        return SqlAlchemyConversationRepository(db=db)

    def _test_workflow_repo(self):
        # TODO: WorkflowRepository not in new system (workflow is read-only via WorkflowReader)
        return None

    def _test_exec_repo(self):
        # TODO: ExecutionRepository equivalent in new system
        return None

    container.__class__.conversation_repo = property(_test_conv_repo)
    container.__class__.workflow_repo = property(_test_workflow_repo)
    container.__class__.execution_repo = property(_test_exec_repo)

    # TODO: app moved to src/main/api/app.py via create_app() — full fixture refactor is TASK-501
    from src.main.api.app import create_app
    from src.main.infra.settings import Settings
    from src.main.infra.di import Registry
    app_instance = create_app(settings=Settings(), registry=Registry())
    with TestClient(app_instance) as c:
        yield c

    # Restore original properties
    container.__class__.conversation_repo = original_conv_repo
    try:
        delattr(container.__class__, 'workflow_repo')
    except AttributeError:
        pass
    try:
        delattr(container.__class__, 'execution_repo')
    except AttributeError:
        pass
