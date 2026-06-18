"""SchedulerService — APScheduler wrapper for cron-based workflow execution. Singleton; manages all scheduled jobs.

This module replaces the legacy ``main.framework.core.scheduler.WorkflowScheduler``
plus the ``_scheduler_instance`` global / ``get_scheduler()`` factory. The cron
validation, DB persistence, and ``run_scheduled_workflow`` orchestration are
preserved verbatim from the original implementation; only the call site for
engine execution is rerouted through the injected ``workflow_service`` 
instead of the old ``engine_factory`` global.

Public surface
--------------
* ``SchedulerService`` — class with 8 public methods (``is_running``, ``start``,
  ``stop``, ``add_workflow_job``, ``remove_workflow_job``, ``restore_jobs_from_db``,
  ``list_scheduled_workflows``, ``run_scheduled_workflow``).
* ``validate_cron_expression`` — module-level helper, regex-based 5-field
  validator (``min hour day month weekday``).
* ``get_next_run_times`` — module-level helper, returns the next N fire times
  for a cron expression as ``datetime`` objects.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from main.framework.models.workflow import Workflow
from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution

logger = logging.getLogger(__name__)


class SchedulerService:
    """APScheduler wrapper for cron-based workflow execution.

    Singleton lifetime (one instance per process, registered via the DI
    container). Manages all scheduled workflow jobs and persists their
    cron state to the ``Workflow`` table.

    Dependencies
    ------------
    * ``session_factory``: callable returning a SQLAlchemy ``Session`` (used
      for every DB read/write inside the service).
    * ``workflow_service``: instance exposing an async ``run(workflow_id=...,
      db=..., execution_id=...) -> dict`` coroutine. The original scheduler
      created a ``WorkflowEngine`` directly via an ``engine_factory``; that
      responsibility now lives in the new ``WorkflowService`` .
    * ``scheduler``: optional pre-built ``AsyncIOScheduler``. When ``None``
      a fresh one is constructed. Tests typically inject a ``MagicMock``.
    """

    def __init__(
        self,
        session_factory: Callable[..., Any],
        workflow_service: Any,
        scheduler: AsyncIOScheduler | None = None,
    ) -> None:
        if scheduler is None:
            scheduler = AsyncIOScheduler()
        self._scheduler = scheduler
        self._session_factory = session_factory
        self._workflow_service = workflow_service
        # workflow_id -> { cron_expression, job_id, next_run_times }
        self._workflow_jobs: dict[str, dict] = {}

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def is_running(self) -> bool:
        """Return True if the underlying APScheduler is running."""
        return self._scheduler.running

    def start(self) -> None:
        """Start the APScheduler background runner (idempotent)."""
        if not self._scheduler.running:
            self._scheduler.start()
            logger.info("SchedulerService started")

    def stop(self) -> None:
        """Stop the APScheduler (no-op if not running)."""
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
            logger.info("SchedulerService stopped")

    # ------------------------------------------------------------------
    # Job management
    # ------------------------------------------------------------------

    def add_workflow_job(self, workflow_id: str, cron_expression: str) -> bool:
        """Schedule a workflow with a 5-field cron expression.

        Args:
            workflow_id: ID of workflow to schedule.
            cron_expression: Cron expression (min hour day month weekday).

        Returns:
            True if scheduled successfully.

        Raises:
            ValueError: If the cron expression is invalid.
        """
        if not validate_cron_expression(cron_expression):
            raise ValueError(f"Invalid cron expression: {cron_expression}")

        job_id = f"workflow_{workflow_id}"

        # Remove existing job if present. NOTE: preserved from the original
        # implementation — ``get_jobs()`` returns Job objects, not strings,
        # so this membership test is effectively always False; the
        # ``replace_existing=True`` kwarg below does the real deduplication.
        if job_id in self._scheduler.get_jobs():
            self._scheduler.remove_job(job_id)

        parts = cron_expression.split()
        trigger = CronTrigger(
            minute=parts[0],
            hour=parts[1],
            day=parts[2],
            month=parts[3],
            day_of_week=parts[4],
        )

        self._scheduler.add_job(
            self.run_scheduled_workflow,
            trigger=trigger,
            args=[workflow_id],
            id=job_id,
            replace_existing=True,
        )

        self._workflow_jobs[workflow_id] = {
            "cron_expression": cron_expression,
            "job_id": job_id,
            "next_run_times": get_next_run_times(cron_expression, 5),
        }

        logger.info(f"Scheduled workflow {workflow_id} with cron: {cron_expression}")

        # Persist cron state on the Workflow row.
        db = self._session_factory()
        try:
            workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
            if workflow:
                workflow.trigger_type = "schedule"
                workflow.cron_expression = cron_expression
                db.commit()
        finally:
            db.close()

        return True

    def remove_workflow_job(self, workflow_id: str) -> bool:
        """Remove a scheduled workflow job.

        Args:
            workflow_id: ID of workflow to unschedule.

        Returns:
            True if removed successfully, False if the job was not present
            (or APScheduler raised while removing it).
        """
        job_id = f"workflow_{workflow_id}"

        try:
            self._scheduler.remove_job(job_id)
            self._workflow_jobs.pop(workflow_id, None)
            logger.info(f"Removed scheduled workflow {workflow_id}")

            # Reset Workflow row back to manual trigger.
            db = self._session_factory()
            try:
                workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
                if workflow:
                    workflow.trigger_type = "manual"
                    workflow.cron_expression = None
                    db.commit()
            finally:
                db.close()

            return True
        except Exception:
            logger.warning(f"Workflow {workflow_id} not found in scheduler")
            return False

    async def restore_jobs_from_db(self) -> None:
        """Re-register every persisted ``trigger_type == 'schedule'`` workflow.

        Called once at startup (after the scheduler is started) so that
        restarts of the process don't drop active cron schedules.
        """
        db = self._session_factory()
        try:
            workflows = (
                db.query(Workflow)
                .filter(
                    Workflow.trigger_type == "schedule",
                    Workflow.cron_expression.isnot(None),
                )
                .all()
            )
            for wf in workflows:
                try:
                    self.add_workflow_job(wf.id, wf.cron_expression)
                    logger.info(f"Restored scheduled job for workflow {wf.id}")
                except Exception as e:
                    logger.warning(f"Failed to restore job for workflow {wf.id}: {e}")
        finally:
            db.close()

    def list_scheduled_workflows(self) -> list[dict]:
        """Return the in-memory registry of scheduled workflows.

        Each entry contains ``workflow_id``, ``cron_expression``, ``job_id``
        and ``next_run_times`` (list of ``datetime``).
        """
        result: list[dict] = []
        for workflow_id, info in self._workflow_jobs.items():
            result.append(
                {
                    "workflow_id": workflow_id,
                    "cron_expression": info["cron_expression"],
                    "job_id": info["job_id"],
                    "next_run_times": info.get("next_run_times", []),
                }
            )
        return result

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    async def run_scheduled_workflow(self, workflow_id: str) -> None:
        """APScheduler callback — dispatch a scheduled workflow run.

        1. Load the ``Workflow`` row.
        2. Create a ``WorkflowExecution`` (status="scheduled") and one
           ``ExecutionNode`` per DAG node.
        3. Hand off to ``workflow_service.run(...)`` for the actual DAG
           execution. The original implementation called
           ``engine_factory(...)`` directly; that responsibility now lives
           in ``WorkflowService`` .
        4. Update the execution row's status from the returned result.

        Returns ``None`` — the APScheduler job does not consume the result.
        Errors are logged and the execution is marked ``failed``; the
        exception is re-raised so APScheduler records the misfire.
        """
        logger.info(f"Running scheduled workflow: {workflow_id}")

        db = self._session_factory()
        try:
            workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
            if not workflow:
                logger.error(f"Workflow {workflow_id} not found")
                return

            # Create execution record
            execution = WorkflowExecution(
                workflow_id=workflow_id,
                status="scheduled",
            )
            db.add(execution)
            db.commit()

            # Create ExecutionNode records (one per DAG node)
            for node in workflow.nodes or []:
                agent = node.get("agent", "")
                if not agent:
                    data = node.get("data", {})
                    if isinstance(data, dict):
                        agent = data.get("agentType", "") or data.get("label", "")
                exec_node = ExecutionNode(
                    execution_id=execution.id,
                    node_id=node["id"],
                    agent=agent,
                    status="pending",
                    input={},
                )
                db.add(exec_node)
            db.commit()

            logger.info(f"Created execution {execution.id} for scheduled workflow {workflow_id}")

            # Dispatch to the WorkflowService for actual DAG execution.
            try:
                result = await self._workflow_service.run(
                    workflow_id=workflow_id,
                    db=db,
                    execution_id=str(execution.id),
                )

                execution = db.query(WorkflowExecution).filter(WorkflowExecution.id == execution.id).first()
                if execution:
                    execution.status = (result or {}).get("status", "completed")
                    db.commit()

                logger.info(f"Scheduled workflow {workflow_id} execution completed: {execution.status}")
            except Exception as e:
                execution = db.query(WorkflowExecution).filter(WorkflowExecution.id == execution.id).first()
                if execution:
                    execution.status = "failed"
                    db.commit()
                logger.error(f"Scheduled workflow {workflow_id} execution failed: {e}")
                raise
        finally:
            db.close()


# ---------------------------------------------------------------------------
# Module-level helpers (cron validation + next-fire-time prediction)
# ---------------------------------------------------------------------------


def validate_cron_expression(cron_expression: str) -> bool:
    """Validate a 5-field cron expression (``min hour day month weekday``).

    Uses regex matching per field, preserving the exact validation rules
    of the legacy ``core/scheduler.py`` implementation. ``croniter`` is
    intentionally not used to keep this module dependency-free beyond
    APScheduler.

    Args:
        cron_expression: Space-separated 5-field cron expression.

    Returns:
        True if every field matches its expected pattern, False otherwise.
    """
    if not cron_expression:
        return False

    parts = cron_expression.split()
    if len(parts) != 5:
        return False

    # Field patterns: minute(0-59), hour(0-23), day(1-31), month(1-12), weekday(0-6)
    patterns = [
        r"^(\*|([0-5]?\d)(-([0-5]?\d))?(,([0-5]?\d)(-([0-5]?\d))?)*(\/(\d+))?|[0-5]?\d(,\d+)*)$", # minute
        r"^(\*|([01]?\d|2[0-3])(-([01]?\d|2[0-3]))?(,([01]?\d|2[0-3])(-([01]?\d|2[0-3]))?)*(\/(\d+))?|[01]?\d(,\d+)*)$", # hour
        r"^(\*|([1-9]|[12]\d|3[01])(-([1-9]|[12]\d|3[01]))?(,([1-9]|[12]\d|3[01])(-([1-9]|[12]\d|3[01]))?)*(\/(\d+))?)$", # day
        r"^(\*|([1-9]|1[0-2])(-([1-9]|1[0-2]))?(,([1-9]|1[0-2])(-([1-9]|1[0-2]))?)*(\/(\d+))?)$", # month
        r"^(\*|[0-6](-([0-6]))?(,([0-6])(-([0-6]))?)*)$", # weekday (0-6)
    ]

    return all(re.match(pattern, part) for part, pattern in zip(parts, patterns, strict=False))


def get_next_run_times(cron_expression: str, n: int = 5) -> list[datetime]:
    """Return the next ``n`` fire times for a cron expression.

    Args:
        cron_expression: Space-separated 5-field cron expression.
        n: Number of future fire times to return (default 5).

    Returns:
        List of timezone-aware ``datetime`` objects (UTC). Returns ``[]``
        for invalid cron expressions or if ``CronTrigger`` raises.
    """
    parts = cron_expression.split()
    if len(parts) != 5:
        return []

    try:
        trigger = CronTrigger(
            minute=parts[0],
            hour=parts[1],
            day=parts[2],
            month=parts[3],
            day_of_week=parts[4],
        )

        run_times: list[datetime] = []
        current_time = datetime.now(UTC)

        for _ in range(n):
            next_time = trigger.get_next_fire_time(None, current_time)
            if next_time:
                run_times.append(next_time)
                current_time = next_time

        return run_times
    except Exception:
        return []
