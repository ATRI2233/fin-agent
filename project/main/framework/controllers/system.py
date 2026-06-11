"""System HTTP routes — thin handlers that delegate to SystemQueryService.

Each endpoint is a thin shell that calls one ``SystemQueryService`` method
and returns its dict.  No business logic lives here — every read-only
aggregator method on the service already returns the exact response shape
the WebUI dashboard expects.

The router defines 3 routes (paths / methods preserved exactly):

    GET /status       (system_status,   200)
    GET /logs/stats   (log_stats,       200)
    GET /cache        (cache_stats,     200)

The re-export shim at ``api/system.py`` re-publishes this ``router`` under
the original import path so ``main.py`` and any other consumer keep working
unchanged.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from main.framework.core.container import get_service
from main.framework.services.system_query_service import SystemQueryService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/system", tags=["system"])


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/status")
async def system_status(
    service: SystemQueryService = Depends(get_service(SystemQueryService)),
):
    """Aggregate cross-subsystem state for the WebUI dashboard.

    Returns opencode binary availability, JobExecutor thread liveness,
    ConcurrencyLimiter counts, scheduler state, active sessions, and an
    ISO-8601 UTC timestamp.  See ``SystemQueryService.get_system_status``
    for the full response shape.
    """
    return service.get_system_status()


@router.get("/logs/stats")
async def log_stats(
    service: SystemQueryService = Depends(get_service(SystemQueryService)),
):
    """In-memory ``LogCollector`` statistics.

    Returns per-job buffer counts, top-N busy jobs, the collector
    capacity limits, and the live ``current_job_id`` contextvar value
    (lets the dashboard highlight the job actively emitting logs on the
    calling thread).  See ``SystemQueryService.get_logs_stats`` for the
    full response shape.
    """
    return service.get_logs_stats()


@router.get("/cache")
async def cache_stats(
    service: SystemQueryService = Depends(get_service(SystemQueryService)),
):
    """Workflow cache + ConcurrencyLimiter snapshot.

    Returns ``workflow_cache`` (size / max_size / usage_pct) and
    ``concurrency`` (active / max / available / usage_pct).  See
    ``SystemQueryService.get_cache_state`` for the full response shape.
    """
    return service.get_cache_state()
