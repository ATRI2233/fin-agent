"""Shared test fixtures — in-memory SQLite DB, test session, FastAPI test client."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from main.framework.models.database import Base

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
    from main.framework.core.container import get_container

    # Monkey-patch the container to use the test session for repo creation.
    container = get_container()
    original_conv_repo = container.__class__.conversation_repo

    def _test_conv_repo(self):
        from main.framework.repositories.conversation_repo import ConversationRepository
        return ConversationRepository(db=db)

    def _test_workflow_repo(self):
        from main.framework.repositories.workflow_repo import WorkflowRepository
        return WorkflowRepository(db=db)

    def _test_exec_repo(self):
        from main.framework.repositories.execution_repo import ExecutionRepository
        return ExecutionRepository(db=db)

    container.__class__.conversation_repo = property(_test_conv_repo)
    container.__class__.workflow_repo = property(_test_workflow_repo)
    container.__class__.execution_repo = property(_test_exec_repo)

    from main.framework.main import app
    with TestClient(app) as c:
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
