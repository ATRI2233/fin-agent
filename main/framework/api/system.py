"""System status API endpoint - aggregates health info for WebUI dashboard."""

from datetime import datetime, timezone

from fastapi import APIRouter

router = APIRouter(prefix="/api/v1/system", tags=["system"])


def _get_executor_status() -> dict:
    """Get JobExecutor status. Returns defaults if executor not available."""
    try:
        from main.framework.core.executor import JobExecutor

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


async def _get_session_status() -> dict:
    """Get sessions from HAPI Hub, plus total count from in-memory + DB.

    Returns:
        {
            "active": [SessionInfo, ...],   # all sessions for HapiPage table
            "count": int,                    # number of sessions
            "total": int,                    # total sessions ever (DB)
        }
    """
    from datetime import datetime, timezone

    active_sessions: list = []
    in_memory_count = 0
    db_total = 0

    # Sessions from HAPI Hub (real source of truth)
    try:
        from main.framework.core.hapi_bridge import HAPIBridge
        from main.framework.config import settings

        bridge = HAPIBridge(settings.HAPI_HUB_URL, settings.HAPI_API_TOKEN)
        sessions = await bridge.list_sessions()
        for s in sessions:
            active_at_ms = s.get("activeAt")
            updated_at_ms = s.get("updatedAt")
            started_at = None
            updated_at = None
            if active_at_ms:
                started_at = datetime.fromtimestamp(
                    active_at_ms / 1000, tz=timezone.utc
                ).isoformat()
            if updated_at_ms:
                updated_at = datetime.fromtimestamp(
                    updated_at_ms / 1000, tz=timezone.utc
                ).isoformat()
            active_sessions.append(
                {
                    "sessionId": s.get("id", ""),
                    "status": "active" if s.get("active") else "inactive",
                    "agent": (s.get("metadata") or {}).get("flavor", "opencode"),
                    "startedAt": started_at,
                    "updatedAt": updated_at,
                }
            )
    except Exception as e:
        import traceback

        print(f"[system.py] _get_session_status HAPI fetch failed: {e}")
        traceback.print_exc()

    # In-memory active count (fallback / cross-check)
    try:
        from main.framework.core.session_cleanup import get_active_executions

        exec_map = get_active_executions()
        in_memory_count = sum(len(sids) for sids in exec_map.values())
    except ImportError:
        pass

    # DB total (historical)
    try:
        from main.framework.models.database import SessionLocal
        from main.framework.models.workflow_execution import ExecutionNode

        db = SessionLocal()
        try:
            db_total = db.query(ExecutionNode).count()
        finally:
            db.close()
    except Exception:
        pass

    return {
        "active": active_sessions,
        "count": len(active_sessions) or in_memory_count,
        "total": db_total,
    }


def _get_hub_status() -> dict:
    """Check if HAPI Hub is reachable."""
    import httpx
    from main.framework.config import settings

    try:
        resp = httpx.get(f"{settings.HAPI_HUB_URL}", timeout=3.0)
        return {"online": resp.status_code == 200}
    except Exception:
        return {"online": False}


@router.get("/status")
async def system_status():
    """Aggregate system status for WebUI dashboard."""
    return {
        "hub": _get_hub_status(),
        "jobExecutor": _get_executor_status(),
        "concurrency": _get_concurrency_status(),
        "scheduler": _get_scheduler_status(),
        "sessions": await _get_session_status(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/logs/stats")
async def log_stats():
    """In-memory log collector statistics."""
    try:
        from main.framework.core.log_collector import get_log_collector

        collector = get_log_collector()
        s = collector.stats()
        # Per-job breakdown (top 10)
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
                "usage_pct": round(
                    limiter.active_count / max(limiter.max_concurrent, 1) * 100, 1
                ),
            },
        }
    except Exception:
        return {"workflow_cache": {"size": 0}, "concurrency": {"active": 0, "max": 0}}
