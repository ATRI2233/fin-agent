"""System status API endpoint - aggregates health info for WebUI dashboard."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from main.framework.models.database import get_db

router = APIRouter(prefix="/api/v1/system", tags=["system"])


def _get_executor_status() -> dict:
    """Get JobExecutor status. Returns defaults if executor not available."""
    try:
        from main.framework.core.executor import JobExecutor

        import threading

        alive = any(t.name.startswith("Thread-") and t.is_alive() for t in threading.enumerate() if t.daemon)
        return {"running": alive, "workerThread": "alive" if alive else "stopped"}
    except ImportError:
        return {"running": False, "workerThread": "unavailable"}


def _get_concurrency_status() -> dict:
    """Get ConcurrencyLimiter current/max counts."""
    try:
        from main.framework.core.performance import get_concurrency_limiter

        limiter = get_concurrency_limiter()
        return {
            "current": limiter.active_count,
            "max": limiter.max_concurrent,
            "available": limiter.available_slots,
        }
    except ImportError:
        return {"current": 0, "max": 0, "available": 0}


def _get_scheduler_status() -> dict:
    """Get WorkflowScheduler running state, job count, and next run time."""
    try:
        from main.framework.core.scheduler import get_scheduler

        scheduler = get_scheduler()
        running = scheduler.is_running()
        jobs = scheduler.list_scheduled_workflows()
        scheduled_count = len(jobs)

        next_run = None
        if jobs:
            times = []
            for job in jobs:
                nr = job.get("next_run_times", [])
                if nr:
                    times.append(nr[0])
            if times:
                next_run = min(times)

        return {
            "running": running,
            "scheduledJobs": scheduled_count,
            "nextRun": next_run,
        }
    except ImportError:
        return {"running": False, "scheduledJobs": 0, "nextRun": None}


def _get_session_status(db: Session) -> dict:
    """Get session status from the OpenCode backend.

    Returns:
        {
            "active": [SessionInfo, ...],
            "count": int,
            "total": int,
        }
    """
    from main.framework.models.workflow_execution import ExecutionNode

    active_sessions: list = []
    db_total = 0

    # Get active sessions from in-memory tracking
    try:
        from main.framework.core.session_cleanup import get_active_executions

        exec_map = get_active_executions()
        for exec_id, sids in exec_map.items():
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
    except ImportError:
        pass

    # DB total (historical)
    try:
        db_total = db.query(ExecutionNode).count()
    except Exception:
        pass

    return {
        "active": active_sessions,
        "count": len(active_sessions),
        "total": db_total,
    }


def _get_opencode_status() -> dict:
    """Check if opencode binary is available."""
    import os
    from main.framework.config import settings

    bin_path = settings.OPENCODE_BIN
    exists = os.path.isfile(bin_path)
    return {
        "online": exists,
        "binary": bin_path,
    }


@router.get("/status")
async def system_status(db: Session = Depends(get_db)):
    """Aggregate system status for WebUI dashboard."""
    return {
        "opencode": _get_opencode_status(),
        "jobExecutor": _get_executor_status(),
        "concurrency": _get_concurrency_status(),
        "scheduler": _get_scheduler_status(),
        "sessions": _get_session_status(db),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/logs/stats")
async def log_stats():
    """In-memory log collector statistics."""
    try:
        from main.framework.core.log_collector import get_log_collector

        collector = get_log_collector()
        s = collector.stats()
        with collector._lock:
            per_job = {jid: len(buf) for jid, buf in collector._logs.items()}
        top_jobs = dict(sorted(per_job.items(), key=lambda x: -x[1])[:10])
        return {
            "active_jobs_with_logs": s["total_jobs"],
            "total_log_entries": s["total_entries"],
            "max_jobs": s["max_jobs"],
            "max_entries_per_job": s["max_entries_per_job"],
            "top_jobs": top_jobs,
        }
    except Exception:
        return {"active_jobs_with_logs": 0, "total_log_entries": 0, "top_jobs": {}}


@router.get("/cache")
async def cache_stats():
    """Cache and concurrency statistics."""
    try:
        from main.framework.core.performance import (
            get_workflow_cache_size,
            get_concurrency_limiter,
        )

        limiter = get_concurrency_limiter()
        cache_size = get_workflow_cache_size()
        return {
            "workflow_cache": {
                "size": cache_size,
                "max_size": 100,
                "usage_pct": round(cache_size / 100 * 100, 1),
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
