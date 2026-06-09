"""Agent direct dispatch API — synchronous agent invocation."""

from __future__ import annotations

import logging
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/dispatch", tags=["dispatch"])


# ---- Request/Response models ----


class DispatchRequest(BaseModel):
    agent: str
    prompt: str = Field(..., max_length=10000)
    timeout: int = Field(default=120, ge=10, le=600)


class DispatchResult(BaseModel):
    agent: str
    result: object | None = None
    error: str | None = None
    duration_seconds: float
    session_id: str | None = None


class ParallelDispatchRequest(BaseModel):
    agents: list[str] = Field(..., min_length=1, max_length=10)
    prompt: str = Field(..., max_length=10000)
    timeout: int = Field(default=120, ge=10, le=600)


class ParallelDispatchResponse(BaseModel):
    results: list[DispatchResult]
    duration_seconds: float


# ---- Endpoints ----


@router.post("", response_model=DispatchResult)
async def dispatch_agent(payload: DispatchRequest, request: Request):
    """Dispatch a prompt to a single agent and wait for the result.

    This is a synchronous endpoint — it blocks until the agent responds
    or the timeout is reached. Use for quick tests and debugging.
    For production workloads, use the Jobs API instead.
    """
    container = request.app.state.container
    dispatcher = container.dispatcher

    start = time.time()
    try:
        resp = await dispatcher.dispatch(
            payload.agent,
            payload.prompt,
            timeout=payload.timeout,
            reuse_session=False,
        )
        return DispatchResult(
            agent=payload.agent,
            result=resp["result"],
            duration_seconds=round(time.time() - start, 2),
            session_id=resp.get("session_id"),
        )
    except TimeoutError:
        return DispatchResult(
            agent=payload.agent,
            error=f"Agent timed out after {payload.timeout}s",
            duration_seconds=round(time.time() - start, 2),
        )
    except Exception as e:
        logger.error(f"Dispatch to {payload.agent} failed: {e}")
        return DispatchResult(
            agent=payload.agent,
            error=str(e),
            duration_seconds=round(time.time() - start, 2),
        )


@router.post("/parallel", response_model=ParallelDispatchResponse)
async def dispatch_parallel(payload: ParallelDispatchRequest, request: Request):
    """Dispatch a prompt to multiple agents in parallel.

    All agents receive the same prompt. Results are collected after
    all agents complete or timeout individually.
    """
    container = request.app.state.container
    dispatcher = container.dispatcher

    start = time.time()
    try:
        raw_results = await dispatcher.dispatch_parallel(
            payload.agents,
            payload.prompt,
            timeout=payload.timeout,
        )
        results = [
            DispatchResult(
                agent=r["agent"],
                result=r["result"],
                error=r["error"],
                duration_seconds=round(time.time() - start, 2),
            )
            for r in raw_results
        ]
        return ParallelDispatchResponse(
            results=results,
            duration_seconds=round(time.time() - start, 2),
        )
    except Exception as e:
        logger.error(f"Parallel dispatch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e
