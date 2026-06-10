"""Dispatch HTTP routes — thin handlers that delegate to DispatchQueryService.

Each endpoint is a thin shell:

  1. Validate the request via Pydantic schemas (``DispatchRequest`` /
     ``ParallelDispatchRequest``).
  2. Call one method on :class:`DispatchQueryService`.
  3. For the parallel endpoint, translate generic exceptions to
     ``HTTPException(500)`` — preserving the legacy contract. The
     single-dispatch endpoint never raises 5xx; per-agent errors are
     carried on the result (``error`` field).

Business logic lives in:

  - ``DispatchQueryService`` — timing, error normalisation, result shaping
  - ``AgentDispatcher``      — backend session management (singleton)

The router defines 2 routes::

    POST /                        (dispatch,        200,  DispatchResult)
    POST /parallel                (dispatch_parallel, 200, ParallelDispatchResponse)

The re-export shim at ``api/dispatch.py`` re-publishes this ``router``
under the original import path so ``main.py`` and any other consumer
keep working unchanged.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from main.framework.core.container import get_service
from main.framework.services.dispatch_query_service import DispatchQueryService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/dispatch", tags=["dispatch"])


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class DispatchRequest(BaseModel):
    """Single-agent dispatch payload."""

    agent: str
    prompt: str = Field(..., max_length=10000)
    timeout: int = Field(default=120, ge=10, le=600)


class DispatchResult(BaseModel):
    """Single-agent dispatch result. ``error`` is mutually exclusive with ``result``."""

    agent: str
    result: object | None = None
    error: str | None = None
    duration_seconds: float
    session_id: str | None = None


class ParallelDispatchRequest(BaseModel):
    """Multi-agent dispatch payload (1-10 agents)."""

    agents: list[str] = Field(..., min_length=1, max_length=10)
    prompt: str = Field(..., max_length=10000)
    timeout: int = Field(default=120, ge=10, le=600)


class ParallelDispatchResponse(BaseModel):
    """Multi-agent dispatch result — one entry per requested agent."""

    results: list[DispatchResult]
    duration_seconds: float


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("", response_model=DispatchResult)
async def dispatch_agent(
    payload: DispatchRequest,
    service: DispatchQueryService = Depends(get_service(DispatchQueryService)),
):
    """Dispatch a prompt to a single agent and wait for the result.

    Synchronous — blocks until the agent responds or the timeout is
    reached. Use for quick tests and debugging. For production
    workloads, use the Jobs API instead.
    """
    return await service.dispatch(payload.agent, payload.prompt, payload.timeout)


@router.post("/parallel", response_model=ParallelDispatchResponse)
async def dispatch_parallel(
    payload: ParallelDispatchRequest,
    service: DispatchQueryService = Depends(get_service(DispatchQueryService)),
):
    """Dispatch a prompt to multiple agents in parallel.

    All agents receive the same prompt. Results are collected after
    all agents complete (or timeout individually). On a catastrophic
    failure the handler raises 500 with the exception detail —
    preserving the legacy contract.
    """
    try:
        return await service.dispatch_parallel(
            payload.agents,
            payload.prompt,
            payload.timeout,
        )
    except Exception as e:
        logger.error("Parallel dispatch failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e
