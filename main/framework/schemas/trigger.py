"""Pydantic response schemas for the execution-status / result endpoints.

These models were extracted from ``controllers/triggers.py`` as part of the
Phase 5 directory reorganization (Wave 3, Task 10). They describe the
shape of responses returned by:

  GET /api/v1/executions/{id}/status
  GET /api/v1/executions/{id}/result
"""

from __future__ import annotations

from pydantic import BaseModel


class NodeStatus(BaseModel):
    node_id: str
    agent: str
    status: str
    output: dict | None = None
    error: str | None = None


class ExecutionStatusResponse(BaseModel):
    execution_id: str
    workflow_id: str
    status: str
    nodes: list[NodeStatus]


class ExecutionResultResponse(BaseModel):
    execution_id: str
    workflow_id: str
    status: str
    results: dict[str, dict]
