"""API v1 system endpoints — health checks, diagnostics, and runtime info.

This router provides system-level observability endpoints. It does **not**
depend on ``service_dep`` (TASK-405 not yet available); instead it injects
``Settings`` directly via a simple ``Depends`` lambda.

Revision T-10 / TASK-013: ``GET /db_health`` exposes all 5 PG migration
trigger conditions from §4.3 of the target architecture document.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from src.main.infra.api_envelope import ApiResponse
from src.main.infra.db_health import DBHealthProbe
from src.main.infra.settings import Settings
from src.main.infra.tracing import current_trace_id

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/db_health")
async def get_db_health(settings: Settings = Depends(lambda: Settings())) -> dict:
    """Collect and return database health metrics.

    Returns a ``DBHealthReport`` with all 5 PG migration trigger metrics
    (parallel node concurrency, DB file size, WAL file count, worker
    count, write QPS), each tagged with a severity label.

    Responses
    ---------
    200
        A JSON envelope containing the health report in ``data``.
        See ``ApiResponse`` for the envelope shape.
    """
    probe: DBHealthProbe = DBHealthProbe(settings)
    report = await probe.collect()
    trace_id = current_trace_id()

    return ApiResponse.success(
        data=report.to_dict(),
        trace_id=trace_id,
    ).to_dict()
