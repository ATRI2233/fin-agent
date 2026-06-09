"""Application entry point — wires up all dependencies via Container."""

from datetime import datetime, timezone
import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from main.framework.config import settings as settings
from main.framework.core.auth import APIKeyMiddleware
from main.framework.core.container import Container
from main.framework.api.agents import router as agents_router
from main.framework.api.tools import router as tools_router
from main.framework.api.skills import router as skills_router
from main.framework.api.workflows import router as workflows_router
from main.framework.api.triggers import router as triggers_router
from main.framework.api.scheduler_routes import router as scheduler_router
from main.framework.api.system import router as system_router
from main.framework.api.conversations import router as conversations_router
from main.framework.api.sessions import router as sessions_router
from main.framework.api.executions import router as executions_router
from main.framework.api.dispatch import router as dispatch_router
from main.data_maintenance.api.data_maintenance import router as data_maintenance_router

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
app.include_router(workflows_router)
app.include_router(triggers_router)
app.include_router(scheduler_router)
app.include_router(system_router)
app.include_router(conversations_router)
app.include_router(sessions_router)
app.include_router(executions_router)
app.include_router(dispatch_router)
app.include_router(data_maintenance_router)


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.exception(
        "Unhandled exception during request %s %s",
        request.method, request.url, exc_info=exc,
    )
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/api/v1/health")
async def health_check():
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ------------------------------------------------------------------
# Lifecycle
# ------------------------------------------------------------------

scheduler = container.create_scheduler()


@app.on_event("startup")
async def startup():
    # Wire up engine factory for scheduler
    from main.framework.core import scheduler as scheduler_mod
    scheduler_mod.configure(container.create_workflow_engine)

    scheduler.start()
    await scheduler.restore_jobs_from_db()

    # Wire up backend to modules that need it
    from main.framework.core import session_cleanup
    session_cleanup.configure(container.backend)

    from main.framework.api.conversations import configure_session_manager
    configure_session_manager(container.backend)

    # Initialize data maintenance
    from main.data_maintenance.models.maintenance_db import init_maintenance_db
    from main.data_maintenance.core.data_maintenance import DataMaintenanceService, configure as configure_maintenance
    init_maintenance_db()
    configure_maintenance(container.dispatcher, scheduler._scheduler)
    DataMaintenanceService.sync_scheduled_tasks()


@app.on_event("shutdown")
async def shutdown():
    scheduler.stop()
    from main.framework.core import session_cleanup
    session_cleanup.cleanup_on_shutdown()
