"""Pydantic schemas for the dispatch HTTP controller.

These models were extracted from ``main/framework/controllers/dispatch.py``
as part of Phase 5 directory reorganisation. They define the request and
response shapes for the single-agent and multi-agent dispatch endpoints.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


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
