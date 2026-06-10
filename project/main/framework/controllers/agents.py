"""Agent HTTP routes — thin handlers that delegate to AgentQueryService.

Each endpoint is a thin shell:
  1. Resolve the request (``name`` path param or DB session).
  2. Call one :class:`AgentQueryService` method.
  3. Translate ``NotFoundError`` → 404 for the ``/{name}`` endpoint.

Business logic lives in:
  - ``AgentQueryService`` — registry reads (list, get_by_name) and
    ``ExecutionNode`` aggregation (stats).

The router defines 3 routes:
  GET    ""          (list_agents,    200, list of summaries)
  GET    "/stats"    (agent_stats,    200, list of per-agent stats)
  GET    "/{name}"   (get_agent,      200, single agent summary)

The re-export shim at ``api/agents.py`` re-publishes this ``router``
under the original import path so ``main.py`` and any other consumer
keep working unchanged.

DI strategy
-----------
Per Wave 4.3 the controllers use ``Depends(get_service(...))`` exclusively.
The DB session for ``/stats`` is sourced from the injected
``ExecutionRepository`` via its ``_session()`` context manager — the same
pattern the workflows/conversations controllers use for per-call db access.
``ExecutionRepository`` is chosen because ``agent_stats`` aggregates over the
``ExecutionNode`` table, which is owned by the execution-side repo.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from main.framework.core.container import get_service
from main.framework.repositories.execution_repo import ExecutionRepository
from main.framework.services.agent_query_service import AgentQueryService
from main.framework.services.exceptions import NotFoundError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/agents", tags=["agents"])


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("")
async def list_agents(
    service: AgentQueryService = Depends(get_service(AgentQueryService)),
):
    """List all registered agents."""
    return service.list_agents()


@router.get("/stats")
async def agent_stats(
    exec_repo: ExecutionRepository = Depends(get_service(ExecutionRepository)),
    service: AgentQueryService = Depends(get_service(AgentQueryService)),
):
    """Agent usage stats from workflow execution nodes."""
    with exec_repo._session() as db:
        return service.agent_stats(db)


@router.get("/{name}")
async def get_agent(
    name: str,
    service: AgentQueryService = Depends(get_service(AgentQueryService)),
):
    """Get agent details by name."""
    try:
        return service.get_by_name(name)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Agent not found") from err
