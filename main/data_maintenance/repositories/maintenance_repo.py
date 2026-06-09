"""Repository for the data_maintenance subsystem (independent DB).

Uses MaintenanceBase models — NOT the framework's Base.
Accepts a Session via constructor; caller owns transaction boundaries.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from main.data_maintenance.models.maintenance_db import (
    MaintenanceData,
    MaintenanceTask,
)

# Sentinel task_id used to store key-value settings in MaintenanceData.
_SETTINGS_TASK_ID = "__settings__"


class MaintenanceRepository:
    """Data-access layer for maintenance tasks, data, and settings.

    Settings are persisted as MaintenanceData rows with a reserved
    ``task_id`` so they live alongside other maintenance data without
    needing a separate table.
    """

    def __init__(self, db: Session) -> None:
        self._db = db

    # ------------------------------------------------------------------
    # Settings (key-value via MaintenanceData)
    # ------------------------------------------------------------------

    def get_setting(self, key: str) -> Optional[MaintenanceData]:
        """Return the setting row for *key*, or ``None`` if absent."""
        return self._db.query(MaintenanceData).filter_by(task_id=_SETTINGS_TASK_ID, data_key=key).first()

    def set_setting(self, key: str, value: str) -> None:
        """Insert or update a setting.  Does NOT commit."""
        row = self.get_setting(key)
        if row is not None:
            row.content = value
            row.fetched_at = datetime.now(timezone.utc)
        else:
            self._db.add(
                MaintenanceData(
                    task_id=_SETTINGS_TASK_ID,
                    data_key=key,
                    content=value,
                )
            )
        self._db.flush()

    # ------------------------------------------------------------------
    # Maintenance Tasks (jobs)
    # ------------------------------------------------------------------

    def list_jobs(self) -> list[MaintenanceTask]:
        """Return all maintenance tasks ordered by creation date."""
        return self._db.query(MaintenanceTask).order_by(MaintenanceTask.created_at.desc()).all()

    def update_job_status(
        self,
        job_id: str,
        status: str,
        error: Optional[str] = None,
    ) -> Optional[MaintenanceTask]:
        """Update the status of a maintenance task.  Does NOT commit.

        Returns the updated task or ``None`` if not found.
        """
        task = self._db.get(MaintenanceTask, job_id)
        if task is None:
            return None
        task.last_status = status
        task.last_error = error
        task.last_run_at = datetime.now(timezone.utc)
        task.updated_at = datetime.now(timezone.utc)
        self._db.flush()
        return task
