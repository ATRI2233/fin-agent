"""Data maintenance service — background task execution and data storage."""

from __future__ import annotations

import json
import logging
import time
from datetime import UTC, datetime, timezone
from functools import partial
from typing import Any

from main.data_maintenance.models.maintenance_db import (
    MaintenanceData,
    MaintenanceLog,
    MaintenanceTask,
    get_session,
)

logger = logging.getLogger(__name__)


class DataMaintenanceService:
    """Manages maintenance tasks: scheduling, execution, data storage.

    Dependencies (dispatcher, scheduler) are injected via constructor
    instead of module-level globals.
    """

    def __init__(self, dispatcher=None, scheduler=None):
        self._dispatcher = dispatcher
        self._scheduler = scheduler

    # ------------------------------------------------------------------
    # Task CRUD
    # ------------------------------------------------------------------

    def list_tasks(self) -> list[dict]:
        db = get_session()
        try:
            tasks = db.query(MaintenanceTask).order_by(MaintenanceTask.name).all()
            return [_task_to_dict(t) for t in tasks]
        finally:
            db.close()

    def get_task(self, task_id: str) -> dict | None:
        db = get_session()
        try:
            task = db.query(MaintenanceTask).get(task_id)
            return _task_to_dict(task) if task else None
        finally:
            db.close()

    def create_task(self, data: dict) -> dict:
        db = get_session()
        try:
            task = MaintenanceTask(
                name=data["name"],
                description=data.get("description", ""),
                agent=data["agent"],
                prompt=data["prompt"],
                schedule=data.get("schedule"),
                enabled=data.get("enabled", 1),
                trigger_type=data.get("trigger_type", "cron"),
                interval_seconds=data.get("interval_seconds"),
            )
            db.add(task)
            db.commit()
            db.refresh(task)
            return _task_to_dict(task)
        finally:
            db.close()

    def update_task(self, task_id: str, data: dict) -> dict | None:
        db = get_session()
        try:
            task = db.query(MaintenanceTask).get(task_id)
            if not task:
                return None
            for key in [
                "name",
                "description",
                "agent",
                "prompt",
                "schedule",
                "enabled",
                "trigger_type",
                "interval_seconds",
            ]:
                if key in data:
                    setattr(task, key, data[key])
            db.commit()
            db.refresh(task)
            return _task_to_dict(task)
        finally:
            db.close()

    def delete_task(self, task_id: str) -> bool:
        db = get_session()
        try:
            task = db.query(MaintenanceTask).get(task_id)
            if not task:
                return False
            db.delete(task)
            db.commit()
            return True
        finally:
            db.close()

    # ------------------------------------------------------------------
    # Task execution
    # ------------------------------------------------------------------

    async def execute_task(self, task_id: str) -> dict:
        """Execute a maintenance task: call agent, store result."""
        if self._dispatcher is None:
            raise RuntimeError("DataMaintenanceService not configured")

        db = get_session()
        try:
            task = db.query(MaintenanceTask).get(task_id)
            if not task:
                return {"success": False, "error": "Task not found"}

            # Mark as running
            task.last_status = "running"
            task.last_run_at = datetime.now(UTC)
            db.commit()

            log = MaintenanceLog(
                task_id=task_id,
                status="running",
                started_at=datetime.now(UTC),
            )
            db.add(log)
            db.commit()

            start_time = time.time()

            try:
                # Call agent
                resp = await self._dispatcher.dispatch(task.agent, task.prompt, timeout=120)
                result = resp["result"]
                duration = round(time.time() - start_time, 2)

                # Store data
                records = _store_result(db, task_id, result)

                # Update task status
                task.last_status = "success"
                task.last_error = None

                # Update log
                log.status = "success"
                log.duration_seconds = duration
                log.records_updated = records
                log.completed_at = datetime.now(UTC)
                db.commit()

                return {
                    "success": True,
                    "records_updated": records,
                    "duration_seconds": duration,
                }

            except Exception as e:
                duration = round(time.time() - start_time, 2)
                task.last_status = "failed"
                task.last_error = str(e)
                log.status = "failed"
                log.duration_seconds = duration
                log.error = str(e)
                log.completed_at = datetime.now(UTC)
                db.commit()
                return {"success": False, "error": str(e)}

        finally:
            db.close()

    # ------------------------------------------------------------------
    # Data query
    # ------------------------------------------------------------------

    def get_task_data(self, task_id: str, limit: int = 50, data_key: str | None = None) -> list[dict]:
        db = get_session()
        try:
            q = db.query(MaintenanceData).filter(MaintenanceData.task_id == task_id)
            if data_key:
                q = q.filter(MaintenanceData.data_key == data_key)
            rows = q.order_by(MaintenanceData.fetched_at.desc()).limit(limit).all()
            return [
                {
                    "id": r.id,
                    "data_key": r.data_key,
                    "content": _safe_json(r.content),
                    "fetched_at": r.fetched_at.isoformat() if r.fetched_at else None,
                }
                for r in rows
            ]
        finally:
            db.close()

    def get_task_logs(self, task_id: str, limit: int = 20) -> list[dict]:
        db = get_session()
        try:
            logs = (
                db.query(MaintenanceLog)
                .filter(MaintenanceLog.task_id == task_id)
                .order_by(MaintenanceLog.completed_at.desc())
                .limit(limit)
                .all()
            )
            return [
                {
                    "id": l.id,
                    "status": l.status,
                    "duration_seconds": l.duration_seconds,
                    "records_updated": l.records_updated,
                    "error": l.error,
                    "started_at": l.started_at.isoformat() if l.started_at else None,
                    "completed_at": l.completed_at.isoformat() if l.completed_at else None,
                }
                for l in logs
            ]
        finally:
            db.close()

    # ------------------------------------------------------------------
    # Scheduling
    # ------------------------------------------------------------------

    def sync_scheduled_tasks(self) -> None:
        """Sync enabled cron tasks to the scheduler."""
        if self._scheduler is None:
            return
        db = get_session()
        try:
            tasks = (
                db.query(MaintenanceTask)
                .filter(MaintenanceTask.enabled == 1)
                .filter(MaintenanceTask.trigger_type == "cron")
                .filter(MaintenanceTask.schedule.isnot(None))
                .all()
            )
            for task in tasks:
                job_id = f"maintenance_{task.id}"
                try:
                    self._scheduler.add_job(
                        partial(_run_task_job, self),
                        "cron",
                        args=[task.id],
                        id=job_id,
                        replace_existing=True,
                        **_parse_cron(task.schedule),
                    )
                    logger.info(f"Scheduled maintenance task: {task.name} ({task.schedule})")
                except Exception as e:
                    logger.error(f"Failed to schedule task {task.name}: {e}")
        finally:
            db.close()


# ---- Internal helpers ----


def _run_task_job(service: DataMaintenanceService, task_id: str):
    """Sync wrapper for APScheduler to call the async task."""
    import asyncio

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor() as pool:
                pool.submit(asyncio.run, service.execute_task(task_id))
        else:
            loop.run_until_complete(service.execute_task(task_id))
    except RuntimeError:
        asyncio.run(service.execute_task(task_id))


def _parse_cron(expr: str) -> dict:
    """Parse 5-field cron into APScheduler kwargs."""
    parts = expr.strip().split()
    if len(parts) != 5:
        raise ValueError(f"Invalid cron expression: {expr}")
    return {
        "minute": parts[0],
        "hour": parts[1],
        "day": parts[2],
        "month": parts[3],
        "day_of_week": parts[4],
    }


def _store_result(db, task_id: str, result: Any) -> int:
    """Parse agent result and store as maintenance data records."""
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except Exception:
            result = {"raw": result}

    if isinstance(result, dict):
        # Store as a single record
        record = MaintenanceData(
            task_id=task_id,
            data_key="result",
            content=json.dumps(result, ensure_ascii=False),
        )
        db.add(record)
        db.commit()
        return 1

    if isinstance(result, list):
        # Store each item as a separate record
        count = 0
        for item in result:
            key = item.get("symbol", item.get("name", item.get("code", str(count))))
            record = MaintenanceData(
                task_id=task_id,
                data_key=str(key),
                content=json.dumps(item, ensure_ascii=False),
            )
            db.add(record)
            count += 1
        db.commit()
        return count

    # Fallback
    record = MaintenanceData(
        task_id=task_id,
        data_key="result",
        content=json.dumps({"value": str(result)}),
    )
    db.add(record)
    db.commit()
    return 1


def _task_to_dict(task: MaintenanceTask) -> dict:
    return {
        "id": task.id,
        "name": task.name,
        "description": task.description,
        "agent": task.agent,
        "prompt": task.prompt,
        "schedule": task.schedule,
        "enabled": bool(task.enabled),
        "trigger_type": task.trigger_type,
        "interval_seconds": task.interval_seconds,
        "last_run_at": task.last_run_at.isoformat() if task.last_run_at else None,
        "last_status": task.last_status,
        "last_error": task.last_error,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }


def _safe_json(text: str | None) -> Any:
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        return text
