"""Unit tests for SchedulerService — mock-heavy, no real APScheduler or DB.

Covers the 8 public methods of ``SchedulerService`` and the two module-level
helpers (``validate_cron_expression``, ``get_next_run_times``).

The original ``core/scheduler.py`` is not exercised here — the new service
replaces it (W5 task 21). All APScheduler interactions go through a
``MagicMock`` injected as ``scheduler=...``; SQLAlchemy sessions are
``MagicMock`` objects whose ``query(...).filter(...).first()`` chain returns
configurable rows.

Design notes
------------
* Tests 4-6 (``is_running``, ``start``, ``stop``) use a ``MagicMock``
  scheduler with an explicit ``running`` attribute so we don't spin up a
  real background thread.
* Tests 7-8 (``add_workflow_job``, ``remove_workflow_job``) assert the
  scheduler delegation by checking ``add_job`` / ``remove_job`` were called
  with the expected kwargs, plus a DB-row assertion for the persistence
  side-effect.
"""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock

import pytest
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from main.framework.services.scheduler_service import (
    SchedulerService,
    get_next_run_times,
    validate_cron_expression,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_scheduler() -> MagicMock:
    """A mocked AsyncIOScheduler with explicit ``running`` attribute.

    ``MagicMock.running`` is normally a Mock object (truthy but not a bool).
    We override it to ``False`` so ``is_running()`` returns a proper bool.
    """
    sch = MagicMock(spec=AsyncIOScheduler)
    sch.running = False
    sch.get_jobs.return_value = []
    return sch


@pytest.fixture
def mock_session_factory() -> MagicMock:
    """A ``session_factory`` that returns the same MagicMock on every call.

    Tests can configure the query chain on ``factory.session`` to return
    specific rows (e.g. a ``SimpleNamespace`` workflow). The service is
    happy to receive the same session for every ``session_factory()`` call —
    in production those would be distinct sessions.
    """
    session = MagicMock()
    session.query.return_value.filter.return_value.first.return_value = None
    session.query.return_value.filter.return_value.all.return_value = []
    factory = MagicMock(return_value=session)
    factory.session = session  # expose for tests to configure
    return factory


@pytest.fixture
def mock_workflow_service() -> MagicMock:
    """Mocked WorkflowService (W4.10) — async ``run`` is an AsyncMock by default."""
    return MagicMock()


@pytest.fixture
def service(
    mock_session_factory: MagicMock,
    mock_workflow_service: MagicMock,
    mock_scheduler: MagicMock,
) -> SchedulerService:
    """SchedulerService wired with all-mock dependencies."""
    return SchedulerService(
        session_factory=mock_session_factory,
        workflow_service=mock_workflow_service,
        scheduler=mock_scheduler,
    )


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------


class TestValidateCronExpression:
    """``validate_cron_expression`` — 5-field cron string validation."""

    def test_validate_cron_valid(self):
        """'0 9 * * *' is a valid 5-field cron expression."""
        assert validate_cron_expression("0 9 * * *") is True

    def test_validate_cron_invalid(self):
        """Garbage string is rejected."""
        assert validate_cron_expression("not a cron") is False

    def test_validate_cron_empty(self):
        """Empty / None input is rejected."""
        assert validate_cron_expression("") is False
        assert validate_cron_expression("   ") is False  # splits to 1 part

    def test_validate_cron_too_few_fields(self):
        """Four-field expression is rejected (we require exactly 5)."""
        assert validate_cron_expression("0 9 * *") is False

    def test_validate_cron_too_many_fields(self):
        """Six-field expression is rejected."""
        assert validate_cron_expression("0 9 * * * 2026") is False

    def test_validate_cron_range_syntax(self):
        """Range syntax (e.g. ``1-5``) is accepted."""
        assert validate_cron_expression("0 9-17 * * *") is True

    def test_validate_cron_list_syntax(self):
        """Comma-list syntax (e.g. ``0,15,30,45``) is accepted."""
        assert validate_cron_expression("0,15,30,45 * * * *") is True


class TestGetNextRunTimes:
    """``get_next_run_times`` — predict the next N fire times."""

    def test_get_next_run_times(self):
        """'0 9 * * *' returns exactly 5 future datetimes."""
        result = get_next_run_times("0 9 * * *", 5)
        assert isinstance(result, list)
        assert len(result) == 5
        for dt in result:
            assert isinstance(dt, datetime)

    def test_get_next_run_times_default_n(self):
        """Default ``n=5`` is used when not specified."""
        result = get_next_run_times("0 9 * * *")
        assert len(result) == 5

    def test_get_next_run_times_first_is_future(self):
        """The first returned fire time is in the future relative to now()."""
        from datetime import UTC, datetime

        now = datetime.now(UTC)
        result = get_next_run_times("0 9 * * *", 1)
        assert len(result) == 1
        # Convert both to comparable UTC instants.
        first = result[0]
        if first.tzinfo is None:
            first = first.replace(tzinfo=UTC)
        else:
            first = first.astimezone(UTC)
        assert first > now

    def test_get_next_run_times_invalid_cron_returns_empty(self):
        """Invalid cron expression returns an empty list (not an exception)."""
        assert get_next_run_times("not a cron") == []

    def test_get_next_run_times_wrong_field_count(self):
        """Expressions without exactly 5 fields return an empty list."""
        assert get_next_run_times("0 9 * *") == []


# ---------------------------------------------------------------------------
# Lifecycle: is_running / start / stop
# ---------------------------------------------------------------------------


class TestLifecycle:
    """is_running / start / stop delegation to the underlying scheduler."""

    def test_is_running_initially_false(self, service: SchedulerService, mock_scheduler: MagicMock):
        """A freshly-constructed service is not running."""
        mock_scheduler.running = False
        assert service.is_running() is False

    def test_start_sets_running(self, service: SchedulerService, mock_scheduler: MagicMock):
        """Calling ``start()`` delegates to ``self._scheduler.start()`` and the
        scheduler transitions to a running state."""
        mock_scheduler.running = False
        service.start()
        mock_scheduler.start.assert_called_once()
        # Simulate APScheduler's state transition after start().
        mock_scheduler.running = True
        assert service.is_running() is True

    def test_start_is_idempotent(self, service: SchedulerService, mock_scheduler: MagicMock):
        """Starting an already-running scheduler is a no-op."""
        mock_scheduler.running = True
        service.start()
        mock_scheduler.start.assert_not_called()

    def test_stop_clears_running(self, service: SchedulerService, mock_scheduler: MagicMock):
        """Calling ``stop()`` delegates to ``self._scheduler.shutdown()`` and
        the scheduler transitions to a stopped state."""
        mock_scheduler.running = True
        service.stop()
        mock_scheduler.shutdown.assert_called_once_with(wait=False)
        # Simulate APScheduler's state transition after shutdown().
        mock_scheduler.running = False
        assert service.is_running() is False

    def test_stop_is_idempotent(self, service: SchedulerService, mock_scheduler: MagicMock):
        """Stopping a non-running scheduler is a no-op."""
        mock_scheduler.running = False
        service.stop()
        mock_scheduler.shutdown.assert_not_called()


# ---------------------------------------------------------------------------
# add_workflow_job / remove_workflow_job
# ---------------------------------------------------------------------------


class TestAddWorkflowJob:
    """``add_workflow_job`` — schedule a workflow with a cron expression."""

    def test_add_workflow_job(self, service: SchedulerService, mock_scheduler: MagicMock):
        """A valid cron expression triggers ``add_job`` on the scheduler with
        the expected kwargs and registers the workflow in the in-memory dict."""
        result = service.add_workflow_job("wf-1", "0 9 * * *")

        assert result is True
        mock_scheduler.add_job.assert_called_once()
        _, kwargs = mock_scheduler.add_job.call_args
        assert kwargs["id"] == "workflow_wf-1"
        assert kwargs["replace_existing"] is True
        assert kwargs["args"] == ["wf-1"]
        assert isinstance(kwargs["trigger"], CronTrigger)

        # In-memory registry updated
        assert "wf-1" in service._workflow_jobs
        assert service._workflow_jobs["wf-1"]["cron_expression"] == "0 9 * * *"

    def test_add_workflow_job_invalid_cron_raises(self, service: SchedulerService, mock_scheduler: MagicMock):
        """Invalid cron expression raises ``ValueError`` and does NOT add a job."""
        with pytest.raises(ValueError) as exc_info:
            service.add_workflow_job("wf-1", "not a cron")

        assert "not a cron" in str(exc_info.value)
        mock_scheduler.add_job.assert_not_called()

    def test_add_workflow_job_persists_to_db(
        self,
        service: SchedulerService,
        mock_scheduler: MagicMock,
        mock_session_factory: MagicMock,
    ):
        """``add_workflow_job`` updates the Workflow row's ``trigger_type``
        and ``cron_expression`` columns."""
        # Configure the session to return a workflow row. Use SimpleNamespace
        # so attribute *assignment* actually stores the value (Mock would
        # create child Mocks on attribute access, masking the assertion).
        db = mock_session_factory()
        workflow_row = SimpleNamespace(
            id="wf-1",
            trigger_type="manual",
            cron_expression=None,
        )
        db.query.return_value.filter.return_value.first.return_value = workflow_row

        service.add_workflow_job("wf-1", "0 9 * * *")

        assert workflow_row.trigger_type == "schedule"
        assert workflow_row.cron_expression == "0 9 * * *"
        db.commit.assert_called()


class TestRemoveWorkflowJob:
    """``remove_workflow_job`` — unschedule a workflow."""

    def test_remove_workflow_job(
        self,
        service: SchedulerService,
        mock_scheduler: MagicMock,
    ):
        """Removing a registered job calls ``remove_job`` on the scheduler
        and pops the workflow from the in-memory registry."""
        service._workflow_jobs["wf-1"] = {
            "cron_expression": "0 9 * * *",
            "job_id": "workflow_wf-1",
            "next_run_times": [],
        }

        result = service.remove_workflow_job("wf-1")

        assert result is True
        mock_scheduler.remove_job.assert_called_once_with("workflow_wf-1")
        assert "wf-1" not in service._workflow_jobs

    def test_remove_workflow_job_resets_db(
        self,
        service: SchedulerService,
        mock_scheduler: MagicMock,
        mock_session_factory: MagicMock,
    ):
        """``remove_workflow_job`` flips the Workflow row back to manual."""
        service._workflow_jobs["wf-1"] = {
            "cron_expression": "0 9 * * *",
            "job_id": "workflow_wf-1",
            "next_run_times": [],
        }
        db = mock_session_factory()
        workflow_row = SimpleNamespace(
            id="wf-1",
            trigger_type="schedule",
            cron_expression="0 9 * * *",
        )
        db.query.return_value.filter.return_value.first.return_value = workflow_row

        service.remove_workflow_job("wf-1")

        assert workflow_row.trigger_type == "manual"
        assert workflow_row.cron_expression is None
        db.commit.assert_called()

    def test_remove_workflow_job_not_found_returns_false(
        self,
        service: SchedulerService,
        mock_scheduler: MagicMock,
    ):
        """If the scheduler raises (job not present), the method returns
        ``False`` rather than propagating the exception."""
        mock_scheduler.remove_job.side_effect = Exception("not found")

        result = service.remove_workflow_job("ghost-wf")

        assert result is False


# ---------------------------------------------------------------------------
# list_scheduled_workflows
# ---------------------------------------------------------------------------


class TestListScheduledWorkflows:
    """``list_scheduled_workflows`` — enumerate the in-memory registry."""

    def test_list_scheduled_workflows_returns_list_empty(
        self,
        service: SchedulerService,
    ):
        """An empty registry returns an empty list."""
        assert service.list_scheduled_workflows() == []

    def test_list_scheduled_workflows_returns_list(self, service: SchedulerService):
        """``list_scheduled_workflows`` always returns a ``list`` instance."""
        # Empty registry: assert the return type and that it is a list.
        result = service.list_scheduled_workflows()
        assert isinstance(result, list)

    def test_list_scheduled_workflows_includes_entries(self, service: SchedulerService):
        """Registered workflows appear in the listing with the expected keys."""
        from datetime import UTC, datetime

        sample_dt = datetime(2026, 6, 9, 9, 0, 0, tzinfo=UTC)
        service._workflow_jobs["wf-1"] = {
            "cron_expression": "0 9 * * *",
            "job_id": "workflow_wf-1",
            "next_run_times": [sample_dt],
        }
        service._workflow_jobs["wf-2"] = {
            "cron_expression": "*/15 * * * *",
            "job_id": "workflow_wf-2",
            "next_run_times": [],
        }

        result = service.list_scheduled_workflows()

        assert len(result) == 2
        by_id = {r["workflow_id"]: r for r in result}
        assert by_id["wf-1"]["cron_expression"] == "0 9 * * *"
        assert by_id["wf-1"]["job_id"] == "workflow_wf-1"
        assert by_id["wf-1"]["next_run_times"] == [sample_dt]
        assert by_id["wf-2"]["cron_expression"] == "*/15 * * * *"


# ---------------------------------------------------------------------------
# restore_jobs_from_db (smoke)
# ---------------------------------------------------------------------------


class TestRestoreJobsFromDb:
    """``restore_jobs_from_db`` — re-register persisted cron jobs at startup."""

    @pytest.mark.asyncio
    async def test_restore_jobs_from_db_empty(
        self,
        service: SchedulerService,
        mock_session_factory: MagicMock,
    ):
        """No persisted schedules → no jobs added."""
        db = mock_session_factory()
        db.query.return_value.filter.return_value.all.return_value = []

        await service.restore_jobs_from_db()

        # No jobs were added.
        assert service._workflow_jobs == {}
