"""MaintenanceQueryService — business logic for maintenance task CRUD.

Thin facade over :class:`DataMaintenanceService` that adds:

* 404 semantics via :class:`NotFoundError` (controller maps → HTTP 404)
* 503 readiness check via :meth:`is_ready` (controller maps → HTTP 503)
* Response-shape assembly (``get_status`` aggregation, ``get_task_detail``
  composition of task + latest data + recent logs)

The service is sync for CRUD paths and exposes one async method
(:meth:`run_task`) that delegates to ``DataMaintenanceService.execute_task``.

The ``DataMaintenanceService`` instance is injected via the constructor so
the controller (and tests) can swap in a mock without touching the
maintenance core.
"""

from __future__ import annotations

import logging
from typing import Any

from main.data_maintenance.core.data_maintenance import DataMaintenanceService
from main.framework.services.exceptions import NotFoundError

logger = logging.getLogger(__name__)


class MaintenanceQueryService:
    """Business-logic facade for the data-maintenance controller.

    Public surface (9 methods):

    * Sync CRUD: ``list_tasks``, ``get_task_detail``, ``create_task``,
      ``update_task``, ``delete_task``, ``get_task_data``, ``get_task_logs``,
      ``get_status``
    * Async: ``run_task``

    Plus a readiness probe :meth:`is_ready` used by the controller's
    dependency factory to emit 503 when the underlying core service
    has not been configured (e.g. no dispatcher wired in).
    """

    def __init__(self, service: DataMaintenanceService) -> None:
        self._service = service

    # ------------------------------------------------------------------
    # Readiness probe — used by the controller's Depends factory to
    # surface a 503 (not a 500) when the maintenance core is not
    # initialised in the current process.
    # ------------------------------------------------------------------

    def is_ready(self) -> bool:
        """Return True when the underlying service has a dispatcher configured."""
        return getattr(self._service, "_dispatcher", None) is not None

    # ------------------------------------------------------------------
    # Task CRUD
    # ------------------------------------------------------------------

    def list_tasks(self) -> dict[str, Any]:
        """Return ``{"tasks": [...]}`` — list all maintenance tasks."""
        return {"tasks": self._service.list_tasks()}

    def get_task_detail(self, task_id: str) -> dict[str, Any]:
        """Return task + latest 10 data records + recent 5 logs.

        Raises :class:`NotFoundError` when the task does not exist.
        """
        task = self._service.get_task(task_id)
        if not task:
            raise NotFoundError("task", task_id)
        data = self._service.get_task_data(task_id, limit=10)
        logs = self._service.get_task_logs(task_id, limit=5)
        return {**task, "latest_data": data, "recent_logs": logs}

    def create_task(self, data: dict[str, Any]) -> dict[str, Any]:
        """Create a task and re-sync the scheduler."""
        task = self._service.create_task(data)
        self._service.sync_scheduled_tasks()
        return task

    def update_task(self, task_id: str, data: dict[str, Any]) -> dict[str, Any]:
        """Update mutable fields and re-sync the scheduler.

        Raises :class:`NotFoundError` when the task does not exist.
        """
        task = self._service.update_task(task_id, data)
        if not task:
            raise NotFoundError("task", task_id)
        self._service.sync_scheduled_tasks()
        return task

    def delete_task(self, task_id: str) -> None:
        """Delete a task and its associated data.

        Raises :class:`NotFoundError` when the task does not exist.
        """
        if not self._service.delete_task(task_id):
            raise NotFoundError("task", task_id)

    # ------------------------------------------------------------------
    # Manual execution
    # ------------------------------------------------------------------

    async def run_task(self, task_id: str) -> dict[str, Any]:
        """Manually trigger a task; return the execution result dict.

        Raises :class:`NotFoundError` when the task does not exist.
        """
        task = self._service.get_task(task_id)
        if not task:
            raise NotFoundError("task", task_id)
        return await self._service.execute_task(task_id)

    # ------------------------------------------------------------------
    # Data + log queries
    # ------------------------------------------------------------------

    def get_task_data(
        self,
        task_id: str,
        limit: int = 50,
        data_key: str | None = None,
    ) -> dict[str, Any]:
        """Return ``{"task_id", "data", "count"}`` for the task's stored data.

        Raises :class:`NotFoundError` when the task does not exist.
        """
        if not self._service.get_task(task_id):
            raise NotFoundError("task", task_id)
        data = self._service.get_task_data(task_id, limit=limit, data_key=data_key)
        return {"task_id": task_id, "data": data, "count": len(data)}

    def get_task_logs(self, task_id: str, limit: int = 20) -> dict[str, Any]:
        """Return ``{"task_id", "logs"}`` for the task's execution logs.

        Raises :class:`NotFoundError` when the task does not exist.
        """
        if not self._service.get_task(task_id):
            raise NotFoundError("task", task_id)
        logs = self._service.get_task_logs(task_id, limit=limit)
        return {"task_id": task_id, "logs": logs}

    # ------------------------------------------------------------------
    # Aggregate overview
    # ------------------------------------------------------------------

    def get_status(self) -> dict[str, Any]:
        """Return total / enabled / healthy / failed counts plus the full task list."""
        tasks = self._service.list_tasks()
        total = len(tasks)
        enabled = sum(1 for t in tasks if t["enabled"])
        healthy = sum(1 for t in tasks if t["enabled"] and t["last_status"] != "failed")
        failed = sum(1 for t in tasks if t["enabled"] and t["last_status"] == "failed")
        return {
            "total_tasks": total,
            "enabled_tasks": enabled,
            "healthy_tasks": healthy,
            "failed_tasks": failed,
            "tasks": tasks,
        }


__all__ = ["MaintenanceQueryService"]
