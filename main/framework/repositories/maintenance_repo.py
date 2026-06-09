"""Repository for Maintenance tasks, data, and logs.

Uses the independent maintenance database (maintenance.db), separate
from the business database.
"""

from __future__ import annotations

from typing import Any

from main.data_maintenance.models.maintenance_db import (
    MaintenanceTask,
    MaintenanceData,
    MaintenanceLog,
    get_session,
)


class MaintenanceRepository:
    """Encapsulates all DB operations for maintenance entities.

    Uses the maintenance-specific session factory (maintenance.db).
    """

    def __init__(self, session_factory=get_session):
        self._sf = session_factory

    # ------------------------------------------------------------------
    # MaintenanceTask
    # ------------------------------------------------------------------

    def get_task(self, task_id: str) -> MaintenanceTask | None:
        """Get maintenance task by id."""
        with self._sf() as db:
            return db.query(MaintenanceTask).get(task_id)

    def list_tasks(self, limit: int = 100, offset: int = 0) -> list[MaintenanceTask]:
        """List all maintenance tasks."""
        with self._sf() as db:
            return (
                db.query(MaintenanceTask).order_by(MaintenanceTask.created_at.desc()).offset(offset).limit(limit).all()
            )

    def create_task(self, name: str, **kwargs: Any) -> MaintenanceTask:
        """Create a new maintenance task. Commits immediately."""
        with self._sf() as db:
            task = MaintenanceTask(name=name, **kwargs)
            db.add(task)
            db.commit()
            db.refresh(task)
            return task

    def update_task(self, task_id: str, **kwargs: Any) -> MaintenanceTask | None:
        """Update a maintenance task. Commits immediately."""
        with self._sf() as db:
            task = db.query(MaintenanceTask).get(task_id)
            if task is None:
                return None
            for k, v in kwargs.items():
                setattr(task, k, v)
            db.commit()
            db.refresh(task)
            return task

    def delete_task(self, task_id: str) -> bool:
        """Delete a maintenance task. Returns True if deleted."""
        with self._sf() as db:
            task = db.query(MaintenanceTask).get(task_id)
            if task is None:
                return False
            db.delete(task)
            db.commit()
            return True

    # ------------------------------------------------------------------
    # MaintenanceData
    # ------------------------------------------------------------------

    def add_data(self, task_id: str, **kwargs: Any) -> MaintenanceData:
        """Add maintenance data entry. Commits immediately."""
        with self._sf() as db:
            data = MaintenanceData(task_id=task_id, **kwargs)
            db.add(data)
            db.commit()
            db.refresh(data)
            return data

    def get_data(self, task_id: str, limit: int = 100, offset: int = 0) -> list[MaintenanceData]:
        """Get data entries for a task."""
        with self._sf() as db:
            return (
                db.query(MaintenanceData)
                .filter(MaintenanceData.task_id == task_id)
                .order_by(MaintenanceData.fetched_at.desc())
                .offset(offset)
                .limit(limit)
                .all()
            )

    # ------------------------------------------------------------------
    # MaintenanceLog
    # ------------------------------------------------------------------

    def add_log(self, task_id: str, **kwargs: Any) -> MaintenanceLog:
        """Add a maintenance log entry. Commits immediately."""
        with self._sf() as db:
            log = MaintenanceLog(task_id=task_id, **kwargs)
            db.add(log)
            db.commit()
            db.refresh(log)
            return log

    def get_logs(self, task_id: str, limit: int = 50, offset: int = 0) -> list[MaintenanceLog]:
        """Get log entries for a task."""
        with self._sf() as db:
            return (
                db.query(MaintenanceLog)
                .filter(MaintenanceLog.task_id == task_id)
                .order_by(MaintenanceLog.completed_at.desc())
                .offset(offset)
                .limit(limit)
                .all()
            )
