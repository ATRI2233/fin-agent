from datetime import datetime
from typing import List

import logging
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from main.framework.config import Settings
from main.framework.core.auth import APIKeyMiddleware
from main.framework.api.jobs import router as jobs_router
from main.framework.api.agents import router as agents_router
from main.framework.api.tools import router as tools_router
from main.framework.api.skills import router as skills_router
from main.framework.api.workflows import router as workflows_router
from main.framework.api.triggers import router as triggers_router
from main.framework.api.scheduler_routes import router as scheduler_router
from main.framework.api.system import router as system_router
from main.framework.api.conversations import router as conversations_router
from main.framework.core.scheduler import get_scheduler
from main.framework.core.log_collector import setup_job_log_handler
from main.framework.core.executor import JobExecutor

app = FastAPI(title="fin-agent-framework")

logger = logging.getLogger(__name__)

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
app.include_router(jobs_router)
app.include_router(agents_router)
app.include_router(tools_router)
app.include_router(skills_router)
app.include_router(workflows_router)
app.include_router(triggers_router)
app.include_router(scheduler_router)
app.include_router(system_router)
app.include_router(conversations_router)


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception during request %s %s", request.method, request.url, exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/api/v1/health")
async def health_check():
    return {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
    }


job_executor = JobExecutor()


@app.on_event("startup")
async def startup():
    setup_job_log_handler()
    get_scheduler().start()
    await get_scheduler().restore_jobs_from_db()
    job_executor.start()


@app.on_event("shutdown")
async def shutdown():
    job_executor.stop()
    get_scheduler().stop()
