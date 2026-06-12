"""Workflow scheduler — APScheduler integration. PHASE 2 migration shim for get_scheduler()."""

from __future__ import annotations

import asyncio
import re
import warnings
from collections.abc import Callable
from datetime import UTC, datetime, timezone
from typing import Any, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from main.framework.models.workflow import Workflow
from main.framework.models.workflow_execution import WorkflowExecution

logger = __import__("logging").getLogger(__name__)


class WorkflowScheduler:
    """Manages workflow scheduling with cron expressions."""

    def __init__(
        self,
        session_factory: Callable[..., Any] | None = None,
        engine_factory: Callable[..., Any] | None = None,
    ):
        if session_factory is None:
            from main.framework.models.database import SessionLocal

            session_factory = SessionLocal
        self._session_factory = session_factory
        self._engine_factory = engine_factory
        self._scheduler = AsyncIOScheduler()
        self._workflow_jobs: dict[str, dict] = {}  # workflow_id -> job_info

    def is_running(self) -> bool:
        """Check if the scheduler is currently running."""
        return self._scheduler.running

    def start(self) -> None:
        """Start APScheduler background runner."""
        if not self._scheduler.running:
            self._scheduler.start()
            logger.info("WorkflowScheduler started")

    def stop(self) -> None:
        """Stop the scheduler."""
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
            logger.info("WorkflowScheduler stopped")

    def add_workflow_job(self, workflow_id: str, cron_expression: str) -> bool:
        """Schedule a workflow with cron expression.

        Args:
            workflow_id: ID of workflow to schedule
            cron_expression: Cron expression (min hour day month weekday)

        Returns:
            True if scheduled successfully

        Raises:
            ValueError: If cron expression is invalid
        """
        # Validate cron expression
        if not validate_cron_expression(cron_expression):
            raise ValueError(f"Invalid cron expression: {cron_expression}")

        job_id = f"workflow_{workflow_id}"

        # Remove existing job if present
        if job_id in self._scheduler.get_jobs():
            self._scheduler.remove_job(job_id)

        # Parse cron expression
        parts = cron_expression.split()
        trigger = CronTrigger(
            minute=parts[0],
            hour=parts[1],
            day=parts[2],
            month=parts[3],
            day_of_week=parts[4],
        )

        # Add job to scheduler
        self._scheduler.add_job(
            run_scheduled_workflow,
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

        # Update workflow in DB
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
            workflow_id: ID of workflow to unschedule

        Returns:
            True if removed successfully, False if not found
        """
        job_id = f"workflow_{workflow_id}"

        try:
            self._scheduler.remove_job(job_id)
            self._workflow_jobs.pop(workflow_id, None)
            logger.info(f"Removed scheduled workflow {workflow_id}")

            # Update workflow in DB
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
        """Restore scheduled jobs from database on startup."""
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
        """List all scheduled workflow jobs.

        Returns:
            List of dicts with workflow_id, cron_expression, and next_run_times
        """
        result = []
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


def validate_cron_expression(cron_expression: str) -> bool:
    """Validate a cron expression (min hour day month weekday).

    Args:
        cron_expression: Space-separated 5-field cron expression

    Returns:
        True if valid, False otherwise
    """
    if not cron_expression:
        return False

    parts = cron_expression.split()
    if len(parts) != 5:
        return False

    # Field patterns: minute(0-59), hour(0-23), day(1-31), month(1-12), weekday(0-6 or sun-sat)
    patterns = [
        r"^(\*|([0-5]?\d)(-([0-5]?\d))?(,([0-5]?\d)(-([0-5]?\d))?)*(\/(\d+))?|[0-5]?\d(,\d+)*)$",  # minute
        r"^(\*|([01]?\d|2[0-3])(-([01]?\d|2[0-3]))?(,([01]?\d|2[0-3])(-([01]?\d|2[0-3]))?)*(\/(\d+))?|[01]?\d(,\d+)*)$",  # hour
        r"^(\*|([1-9]|[12]\d|3[01])(-([1-9]|[12]\d|3[01]))?(,([1-9]|[12]\d|3[01])(-([1-9]|[12]\d|3[01]))?)*(\/(\d+))?)$",  # day
        r"^(\*|([1-9]|1[0-2])(-([1-9]|1[0-2]))?(,([1-9]|1[0-2])(-([1-9]|1[0-2]))?)*(\/(\d+))?)$",  # month
        r"^(\*|[0-6](-([0-6]))?(,([0-6])(-([0-6]))?)*)$",  # weekday (0-6)
    ]

    return all(re.match(pattern, part) for part, pattern in zip(parts, patterns, strict=False))


def get_next_run_times(cron_expression: str, count: int = 5) -> list[str]:
    """Get next N run times for a cron expression.

    Args:
        cron_expression: Space-separated 5-field cron expression
        count: Number of future run times to return

    Returns:
        List of ISO format datetime strings
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

        run_times = []
        current_time = datetime.now(UTC)

        for _ in range(count):
            next_time = trigger.get_next_fire_time(None, current_time)
            if next_time:
                run_times.append(next_time.isoformat())
                current_time = next_time

        return run_times

    except Exception:
        return []


async def run_scheduled_workflow(workflow_id: str) -> dict:
    """Execute a scheduled workflow.

    Loads workflow from DB, creates execution, runs via WorkflowEngine,
    and stores results.

    Args:
        workflow_id: ID of workflow to run

    Returns:
        Dict with execution results
    """
    logger.info(f"Running scheduled workflow: {workflow_id}")

    from main.framework.core.infrastructure.container import get_container

    container = get_container()
    scheduler = container.create_scheduler()
    db = scheduler._session_factory()
    try:
        # Load workflow from database
        workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()

        if not workflow:
            logger.error(f"Workflow {workflow_id} not found")
            return {"status": "error", "error": f"Workflow {workflow_id} not found"}

        # Create execution record
        execution = WorkflowExecution(
            workflow_id=workflow_id,
            status="scheduled",
        )
        db.add(execution)
        db.commit()

        # Create ExecutionNode records
        from main.framework.models.workflow_execution import ExecutionNode

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

        # Run via WorkflowEngine (created through factory for DI)
        if scheduler._engine_factory is None:
            raise RuntimeError("Scheduler not configured: pass engine_factory to WorkflowScheduler()")
        engine = scheduler._engine_factory(workflow_id=workflow_id, params={}, db=db, execution_id=str(execution.id))

        try:
            result = await engine.execute()

            # Update execution with final status
            execution = db.query(WorkflowExecution).filter(WorkflowExecution.id == execution.id).first()
            if execution:
                execution.status = result.get("status", "completed")
                db.commit()

            logger.info(f"Scheduled workflow {workflow_id} execution completed: {execution.status}")
            return result

        except Exception as e:
            execution = db.query(WorkflowExecution).filter(WorkflowExecution.id == execution.id).first()
            if execution:
                execution.status = "failed"
                db.commit()
            logger.error(f"Scheduled workflow {workflow_id} execution failed: {e}")
            raise

    finally:
        db.close()


# _scheduler_instance global removed in PHASE 2 — use container.scheduler instead
