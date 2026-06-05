import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

# Set in-memory database before importing framework modules
os.environ["FIN_AGENT_DATABASE_URL"] = "sqlite:///:memory:"

from main.framework.core.job_manager import JobManager
from main.framework.core.agent_registry import registry
from main.framework.core.executor import JobExecutor
from main.framework.models.database import init_db


@pytest.fixture(autouse=True)
def setup_db():
    """Initialize in-memory database for each test."""
    init_db()


def test_job_manager_create_job():
    """Test job creation and retrieval."""
    jm = JobManager()
    job = jm.create_job("macro-scout", "Analyze market", {})
    assert job.id is not None
    assert job.agent == "macro-scout"
    assert job.status == "pending"
    retrieved = jm.get_job(job.id)
    assert retrieved is not None
    assert retrieved.agent == "macro-scout"


def test_job_manager_status_transitions():
    """Test job status transitions."""
    jm = JobManager()
    job = jm.create_job("macro-scout", "test", {})
    jm.update_job(str(job.id), status="running")
    updated = jm.get_job(str(job.id))
    assert updated is not None
    assert updated.status == "running"
    jm.complete_job(str(job.id), {"result": "success"})
    completed = jm.get_job(str(job.id))
    assert completed is not None
    assert completed.status == "completed"


def test_job_manager_cancel():
    """Test job cancellation."""
    jm = JobManager()
    job = jm.create_job("macro-scout", "test", {})
    jm.cancel_job(str(job.id))
    cancelled = jm.get_job(str(job.id))
    assert cancelled is not None
    assert cancelled.status == "cancelled"


def test_job_manager_fail():
    """Test job failure."""
    jm = JobManager()
    job = jm.create_job("macro-scout", "test", {})
    jm.fail_job(str(job.id), "Test error")
    failed = jm.get_job(str(job.id))
    assert failed is not None
    assert failed.status == "failed"
    assert failed.result == {"error": "Test error"}


def test_agent_registry_list_agents():
    """Test agent registry lists all 9 agents."""
    agents = registry.list_agents()
    assert len(agents) == 9


def test_agent_registry_get_agent():
    """Test getting specific agent."""
    agent = registry.get_agent("macro-scout")
    assert agent is not None
    assert agent.name == "macro-scout"


def test_job_manager_list_filter():
    """Test listing jobs with status filter."""
    jm = JobManager()
    jm.create_job("macro-scout", "test1", {})
    job2 = jm.create_job("macro-scout", "test2", {})
    jm.update_job(job2.id, status="running")
    pending = jm.list_jobs(status="pending")
    running = jm.list_jobs(status="running")
    assert all(j.status == "pending" for j in pending)
    assert all(j.status == "running" for j in running)


def test_fastapi_app_import():
    """Test FastAPI app can be imported."""
    from main.framework.main import app

    assert app is not None
