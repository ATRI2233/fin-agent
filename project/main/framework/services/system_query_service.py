"""SystemQueryService — business logic for the ``/api/v1/system`` HTTP API.

Aggregates state from the opencode backend, scheduler service, session
tracker, in-memory log collector, and workflow cache into single
endpoint responses.  Replaces the inline helpers that previously lived
in ``api/system.py`` (Wave 3 migration).

Public surface (3 methods, all sync, all read-only):

* :meth:`get_system_status` — opencode / executor / concurrency / scheduler / sessions
* :meth:`get_logs_stats`    — per-job log counts from in-memory ``LogCollector``,
                              plus the ``current_job_id`` contextvar value
                              (read from ``core/log_collector.py:18``) so the
                              dashboard can highlight the job actively emitting
                              logs on the calling thread
* :meth:`get_cache_state`   — workflow cache + concurrency limiter snapshot

All methods are exception-safe: any subsystem that fails returns
sensible defaults rather than propagating 5xx — preserving the legacy
contract where ``/api/v1/system/status`` always returns 200.

Constructor deps
----------------
* ``scheduler_service``  — :class:`SchedulerService` (DI-injected, used for
  ``is_running()`` and ``list_scheduled_workflows()``)
* ``session_factory``    — optional callable returning a SQLAlchemy ``Session``;
  used for the historical ``ExecutionNode`` row count in
  :meth:`get_system_status`.  When ``None`` the count falls through to ``0``.

All other subsystems are reached via module-level helpers or singleton
accessors (``get_concurrency_limiter``, ``get_log_collector``,
``get_active_executions``, ``get_workflow_cache_size``) — they are
process-singletons and do not need to be injected.
"""

from __future__ import annotations

import contextlib
import logging
import os
import threading
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from main.framework.config import settings
from main.framework.core.log_collector import current_job_id, get_log_collector
from main.framework.core.session_cleanup import get_active_executions
from main.framework.models.workflow_execution import ExecutionNode
from main.framework.services.scheduler_service import SchedulerService
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Maximum entries returned in the ``top_jobs`` map of ``get_logs_stats``.
# Mirrors the literal ``[:10]`` slice in the original ``api/system.py``.
_TOP_JOBS_LIMIT = 10

# Hard-coded upper bound for the workflow cache; the original endpoint
# hard-codes ``max_size=100`` in the response and computes usage as
# ``size / 100 * 100``.  Kept as a module constant so the formula and the
# reported cap never drift apart.
_WORKFLOW_CACHE_MAX = 100


class SystemQueryService:
    """Business-logic facade for the ``/api/v1/system`` HTTP API.

    Constructor takes :class:`SchedulerService` (required) and an optional
    ``session_factory`` for the DB-backed ``sessions.total`` count.  All
    other subsystems are reached via module-level helpers or singleton
    accessors and do not need to be injected.
    """

    def __init__(
        self,
        scheduler_service: SchedulerService,
        session_factory: Callable[..., Session] | None = None,
    ) -> None:
        self._scheduler = scheduler_service
        self._session_factory = session_factory

    # ------------------------------------------------------------------
    # Public aggregation methods
    # ------------------------------------------------------------------

    def get_system_status(self) -> dict[str, Any]:
        """Aggregate subsystem state for the WebUI dashboard (legacy shape).

        The historical ``ExecutionNode`` row count is sourced from
        ``self._session_factory()`` (skipped when ``None``); all other
        subsystems are module-singletons.
        """
        return {
            "opencode": self._opencode_status(),
            "jobExecutor": self._executor_status(),
            "concurrency": self._concurrency_status(),
            "scheduler": self._scheduler_status(),
            "sessions": self._session_status(),
            "timestamp": datetime.now(UTC).isoformat(),
        }

    def get_logs_stats(self) -> dict[str, Any]:
        """Return top-N log-collector stats + the active ``current_job_id``.

        Logs are tagged with the ``current_job_id`` contextvar
        (``core/log_collector.py:18``) at emit time by ``JobLogHandler``.
        This method counts what the handler already captured AND exposes
        the live contextvar value so the dashboard can highlight whichever
        job is actively emitting logs on the calling thread.
        """
        try:
            collector = get_log_collector()
            s = collector.stats()
            with collector._lock:
                per_job = {jid: len(buf) for jid, buf in collector._logs.items()}
            top_jobs = dict(sorted(per_job.items(), key=lambda x: -x[1])[:_TOP_JOBS_LIMIT])
            return {
                "active_jobs_with_logs": s["total_jobs"],
                "total_log_entries": s["total_entries"],
                "max_jobs": s["max_jobs"],
                "max_entries_per_job": s["max_entries_per_job"],
                "top_jobs": top_jobs,
                "current_job_id": current_job_id.get(),
            }
        except Exception:
            return {
                "active_jobs_with_logs": 0,
                "total_log_entries": 0,
                "max_jobs": 0,
                "max_entries_per_job": 0,
                "top_jobs": {},
                "current_job_id": current_job_id.get(),
            }

    def get_cache_state(self) -> dict[str, Any]:
        """Return workflow-cache and concurrency-limiter snapshot (legacy shape)."""
        try:
            from main.framework.core.performance import (
                get_concurrency_limiter,
                get_workflow_cache_size,
            )

            limiter = get_concurrency_limiter()
            cache_size = get_workflow_cache_size()
            return {
                "workflow_cache": {
                    "size": cache_size,
                    "max_size": _WORKFLOW_CACHE_MAX,
                    "usage_pct": round(cache_size / _WORKFLOW_CACHE_MAX * 100, 1),
                },
                "concurrency": {
                    "active": limiter.active_count,
                    "max": limiter.max_concurrent,
                    "available": limiter.available_slots,
                    "usage_pct": round(limiter.active_count / max(limiter.max_concurrent, 1) * 100, 1),
                },
            }
        except Exception:
            return {"workflow_cache": {"size": 0}, "concurrency": {"active": 0, "max": 0}}

    # ------------------------------------------------------------------
    # Subsystem helpers — exception-safe, return defaults on failure.
    # ------------------------------------------------------------------

    def _opencode_status(self) -> dict[str, Any]:
        try:
            bin_path = settings.OPENCODE_BIN
            exists = bool(bin_path) and os.path.isfile(bin_path)
            return {"online": exists, "binary": bin_path}
        except Exception:
            return {"online": False, "binary": None}

    def _executor_status(self) -> dict[str, Any]:
        # Preserved verbatim from the legacy handler.  The ``JobExecutor``
        # import is a defensive presence check; ``core/executor.py`` does
        # not exist in the current codebase, so the ``ImportError`` branch
        # is the always-taken path.
        try:
            from main.framework.core.executor import JobExecutor  # type: ignore[import-not-found]  # noqa: F401

            alive = any(t.name.startswith("Thread-") and t.is_alive() for t in threading.enumerate() if t.daemon)
            return {"running": alive, "workerThread": "alive" if alive else "stopped"}
        except ImportError:
            return {"running": False, "workerThread": "unavailable"}
        except Exception:
            return {"running": False, "workerThread": "unavailable"}

    def _concurrency_status(self) -> dict[str, Any]:
        try:
            from main.framework.core.performance import get_concurrency_limiter

            limiter = get_concurrency_limiter()
            return {
                "current": limiter.active_count,
                "max": limiter.max_concurrent,
                "available": limiter.available_slots,
            }
        except Exception:
            return {"current": 0, "max": 0, "available": 0}

    def _scheduler_status(self) -> dict[str, Any]:
        try:
            running = self._scheduler.is_running()
            jobs = self._scheduler.list_scheduled_workflows()
            next_run = None
            if jobs:
                times = [nr[0] for job in jobs if (nr := job.get("next_run_times", []))]
                if times:
                    next_run = min(times)
            return {
                "running": running,
                "scheduledJobs": len(jobs),
                "nextRun": next_run,
            }
        except Exception:
            return {"running": False, "scheduledJobs": 0, "nextRun": None}

    def _session_status(self) -> dict[str, Any]:
        active_sessions: list[dict[str, Any]] = []
        try:
            for _exec_id, sids in get_active_executions().items():
                for sid in sids:
                    active_sessions.append(
                        {
                            "sessionId": sid,
                            "status": "active",
                            "agent": "",
                            "startedAt": None,
                            "updatedAt": None,
                        }
                    )
        except Exception:
            # The map reader itself is best-effort — match the original
            # behaviour which only swallowed ``ImportError`` but here we
            # generalise because the map lookup is purely in-process and
            # should never raise, but if it does we want the dashboard to
            # still render rather than 500.
            active_sessions = []

        db_total = 0
        if self._session_factory is not None:
            db: Session | None = None
            try:
                db = self._session_factory()
                db_total = db.query(ExecutionNode).count()
            except Exception:
                db_total = 0
            finally:
                if db is not None:
                    with contextlib.suppress(Exception):
                        db.close()

        return {
            "active": active_sessions,
            "count": len(active_sessions),
            "total": db_total,
        }


__all__ = ["SystemQueryService"]
