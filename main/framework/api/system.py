"""System status API endpoint — aggregates health info for WebUI dashboard."""

from datetime import datetime, timezone

from fastapi import APIRouter

router = APIRouter(prefix="/api/v1/system", tags=["system"])


def _get_executor_status() -> dict:
    """Get JobExecutor status. Returns defaults if executor not available."""
    try:
        from main.framework.core.executor import JobExecutor

        # JobExecutor doesn't expose a global singleton — check thread state
        # by probing the module for any live instance
        import threading

        alive = any(
            t.name.startswith("Thread-") and t.is_alive()
            for t in threading.enumerate()
            if t.daemon
        )
        return {"running": alive, "workerThread": "alive" if alive else "stopped"}
    except ImportError:
        return {"running": False, "workerThread": "unavailable"}


def _get_concurrency_status() -> dict:
    """Get ConcurrencyLimiter current/max counts."""
    try:
        from main.framework.core.performance import get_concurrency_limiter

        limiter = get_concurrency_limiter()
        # _semaphore._value = remaining slots; _active_count tracks acquisitions
        current = limiter._active_count
        max_val = limiter._semaphore._value + current
        return {"current": current, "max": max_val}
    except ImportError:
        return {"current": 0, "max": 0}


def _get_scheduler_status() -> dict:
    """Get WorkflowScheduler running state, job count, and next run time."""
    try:
        from main.framework.core.scheduler import get_scheduler

        scheduler = get_scheduler()
        running = scheduler._scheduler.running
        jobs = scheduler.list_scheduled_workflows()
        scheduled_count = len(jobs)

        next_run = None
        if jobs:
            # Collect all next_run_times[0] and pick the earliest
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


def _get_session_status() -> dict:
    """Get active and total session counts from in-memory registry and DB."""
    active_count = 0
    total_count = 0

    # In-memory active sessions
    try:
        from main.framework.core.session_cleanup import get_active_executions

        exec_map = get_active_executions()
        active_count = sum(len(sids) for sids in exec_map.values())
    except ImportError:
        pass

    # DB total sessions (ExecutionNode rows)
    try:
        from main.framework.models.database import SessionLocal
        from main.framework.models.workflow_execution import ExecutionNode

        db = SessionLocal()
        try:
            total_count = db.query(ExecutionNode).count()
        finally:
            db.close()
    except Exception:
        pass

    return {"active": active_count, "total": total_count}


@router.get("/status")
async def system_status():
    """Aggregate system status for WebUI dashboard.

    Returns non-sensitive operational metrics from executor, concurrency
    limiter, scheduler, and session registry. Each subsystem is wrapped
    in a try/except so partial failures degrade gracefully.
    """
    return {
        "jobExecutor": _get_executor_status(),
        "concurrency": _get_concurrency_status(),
        "scheduler": _get_scheduler_status(),
        "sessions": _get_session_status(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/logs/stats")
async def log_stats():
    """In-memory log collector statistics."""
    try:
        from main.framework.core.log_collector import get_log_collector

        collector = get_log_collector()
        with collector._lock:
            job_count = len(collector._logs)
            total_entries = sum(len(buf) for buf in collector._logs.values())
            per_job = {jid: len(buf) for jid, buf in collector._logs.items()}
        top_jobs = dict(sorted(per_job.items(), key=lambda x: -x[1])[:10])
        return {
            "active_jobs_with_logs": job_count,
            "total_log_entries": total_entries,
            "max_jobs": collector._max_jobs,
            "max_entries_per_job": collector._max_entries_per_job,
            "top_jobs": top_jobs,
        }
    except Exception:
        return {"active_jobs_with_logs": 0, "total_log_entries": 0, "top_jobs": {}}


@router.get("/cache")
async def cache_stats():
    """Cache and concurrency statistics."""
    try:
        from main.framework.core.performance import _workflow_cache, get_concurrency_limiter

        limiter = get_concurrency_limiter()
        max_conc = limiter._semaphore._value + limiter._active_count
        return {
            "workflow_cache": {
                "size": len(_workflow_cache),
                "max_size": 100,
                "usage_pct": round(len(_workflow_cache) / 100 * 100, 1),
            },
            "concurrency": {
                "active": limiter._active_count,
                "max": max_conc,
                "available": limiter._semaphore._value,
                "usage_pct": round(limiter._active_count / max(max_conc, 1) * 100, 1),
            },
        }
    except Exception:
        return {"workflow_cache": {"size": 0}, "concurrency": {"active": 0, "max": 0}}
