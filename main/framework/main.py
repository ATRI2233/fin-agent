"""Application entry point — wires up all dependencies via Container."""

import logging
from datetime import UTC, datetime, timezone
from http import HTTPStatus

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from main.data_maintenance.api.data_maintenance import router as data_maintenance_router
from main.framework.api.agents import router as agents_router
from main.framework.api.conversations import router as conversations_router
from main.framework.api.dispatch import router as dispatch_router
from main.framework.api.executions import router as executions_router
from main.framework.api.problems import problem_response
from main.framework.api.scheduler_routes import router as scheduler_router
from main.framework.api.sessions import router as sessions_router
from main.framework.api.skills import router as skills_router
from main.framework.api.system import router as system_router
from main.framework.api.tools import router as tools_router
from main.framework.api.triggers import router as triggers_router
from main.framework.api.workflows import router as workflows_router
from main.framework.config import settings as settings
from main.framework.core.auth import APIKeyMiddleware
from main.framework.core.container import Container
from main.framework.core.request_context import get_request_id
from main.framework.services.exceptions import NotFoundError, ServiceError

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# DI container — single source of truth
# ------------------------------------------------------------------
container = Container(settings)

app = FastAPI(title="fin-agent-framework")

# Make container accessible to API routes via request.app.state.container
app.state.container = container

# CORS middleware for WebUI on port 3120
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3120",
        "http://127.0.0.1:3120",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Key authentication middleware
app.add_middleware(APIKeyMiddleware)

# Include routers
app.include_router(agents_router)
app.include_router(tools_router)
app.include_router(skills_router)
# Scheduler routes MUST be included before workflows so that the explicit
# path `/scheduled` is registered before the catch-all `/{workflow_id}`.
app.include_router(scheduler_router)
app.include_router(workflows_router)
app.include_router(triggers_router)
app.include_router(system_router)
app.include_router(conversations_router)
app.include_router(sessions_router)
app.include_router(executions_router)
app.include_router(dispatch_router)
app.include_router(data_maintenance_router)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """RFC 7807 envelope for FastAPI/Starlette HTTPException.

    Derives ``title`` from the standard HTTP reason phrase so common codes
    (404→"Not Found", 400→"Bad Request", ...) line up with what API
    consumers expect. ``detail`` is forwarded from ``exc.detail``.
    """
    try:
        title = HTTPStatus(exc.status_code).phrase
    except ValueError:
        title = "HTTP Error"
    logger.error(
        "HTTPException during request %s %s [request_id=%s]: %s",
        request.method,
        request.url,
        get_request_id(),
        exc.detail,
    )
    return problem_response(
        status=exc.status_code,
        title=title,
        detail=str(exc.detail) if exc.detail is not None else None,
        instance=request.url.path,
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """RFC 7807 envelope for unhandled exceptions (last-resort 500).

    Uses ``logger.exception`` to preserve the traceback. We deliberately do
    NOT echo ``str(exc)`` to the client — internal exception messages may
    leak implementation details (file paths, query fragments, etc.).
    """
    logger.exception(
        "Unhandled exception during request %s %s [request_id=%s]",
        request.method,
        request.url,
        get_request_id(),
        exc_info=exc,
    )
    return problem_response(
        status=500,
        title="Internal Server Error",
        detail="Internal server error",
        instance=request.url.path,
    )


@app.exception_handler(ServiceError)
async def service_error_handler(request: Request, exc: ServiceError) -> JSONResponse:
    """RFC 7807 envelope for service-layer errors (maps to 500).

    Service-layer errors are expected to carry safe, user-facing messages
    (``raise ServiceError("Workflow x failed validation: ...")``), so we
    forward ``str(exc)`` as the ``detail``. This is the parent class of
    :class:`NotFoundError` so this handler is the fallback for non-NotFound
    service failures.
    """
    logger.error(
        "ServiceError during request %s %s [request_id=%s]: %s",
        request.method,
        request.url,
        get_request_id(),
        exc,
    )
    return problem_response(
        status=500,
        title="Service Error",
        detail=str(exc) or "Service error",
        instance=request.url.path,
    )


@app.exception_handler(NotFoundError)
async def not_found_error_handler(request: Request, exc: NotFoundError) -> JSONResponse:
    """RFC 7807 envelope for ``NotFoundError`` (maps to 404)."""
    logger.error(
        "NotFoundError during request %s %s [request_id=%s]: %s",
        request.method,
        request.url,
        get_request_id(),
        exc,
    )
    return problem_response(
        status=404,
        title="Not Found",
        detail=str(exc) or "Resource not found",
        instance=request.url.path,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """RFC 7807 envelope for FastAPI request body/query validation (422).

    The structured error list lives in ``exc.errors()`` and is logged for
    operators; the client gets a short, human-readable ``detail`` that
    points them at the offending field via the error summary.
    """
    errors = exc.errors()
    logger.error(
        "RequestValidationError during request %s %s [request_id=%s]: %s",
        request.method,
        request.url,
        get_request_id(),
        errors,
    )
    # Build a compact, single-line summary for the problem detail so it
    # stays well under log line limits while still being actionable.
    if errors:
        first = errors[0]
        loc = ".".join(str(p) for p in first.get("loc", ()) if p != "body")
        msg = first.get("msg", "validation error")
        detail = f"{loc}: {msg}" if loc else msg
    else:
        detail = "Validation error"
    return problem_response(
        status=422,
        title="Validation Error",
        detail=detail,
        instance=request.url.path,
    )


@app.get("/api/v1/health")
async def health_check():
    return {
        "status": "ok",
        "timestamp": datetime.now(UTC).isoformat(),
    }


# ------------------------------------------------------------------
# Lifecycle
# ------------------------------------------------------------------

scheduler = container.create_scheduler()


@app.on_event("startup")
async def startup():
    scheduler.start()
    await scheduler.restore_jobs_from_db()

    # Initialize data maintenance
    from main.data_maintenance.core.data_maintenance import DataMaintenanceService
    from main.data_maintenance.models.maintenance_db import init_maintenance_db
    from main.data_maintenance.services.maintenance_query_service import (
        MaintenanceQueryService,
    )

    init_maintenance_db()
    maintenance_service = DataMaintenanceService(
        dispatcher=container.dispatcher,
        scheduler=scheduler._scheduler,
    )
    app.state.maintenance_service = maintenance_service

    # Register the query-service factory so the controller's
    # ``Depends(get_service(MaintenanceQueryService))`` resolves in DI.
    # The factory captures the freshly-initialised ``DataMaintenanceService``
    # so the controller can stay framework-agnostic.
    container.register_factory(
        MaintenanceQueryService,
        lambda: MaintenanceQueryService(maintenance_service),
    )

    maintenance_service.sync_scheduled_tasks()


@app.on_event("shutdown")
async def shutdown():
    scheduler.stop()
    from main.framework.core import session_cleanup

    session_cleanup.cleanup_on_shutdown(container.backend)
