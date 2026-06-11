"""Base classes for the workflow node executor strategy pattern.

This module defines the abstract interface every concrete node executor must
satisfy. The four node types handled by ``WorkflowEngine.execute_node``
(``input``, ``output``, ``debate``, and regular agent nodes) are each
implemented as a separate ``NodeExecutor`` subclass, so the engine can
delegate to them polymorphically instead of branching on ``node["type"]``.

The pattern keeps the engine thin and lets new node kinds (e.g. human-in-the-
loop, HTTP, tool-only) be added by dropping in a new executor class and
registering it, without touching ``WorkflowEngine``.

Transaction handling is intentionally NOT centralized here: each executor
calls :meth:`NodeExecutor._commit` on its own session at the points where it
has finished a logical unit of work, matching the existing behaviour in
``WorkflowEngine.execute_node``.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from main.framework.core.agent_dispatcher import AgentDispatcher
from sqlalchemy.orm import Session

if TYPE_CHECKING:
    # Imported only for type checking to avoid a circular import:
    # WorkflowEngine will eventually depend on these executors.
    pass


@dataclass
class NodeContext:
    """Per-node execution context passed into ``NodeExecutor.execute``.

    Fields:
        node: The raw node definition from the workflow graph (id, type,
            prompt, agent, outputKey, ...).
        execution_id: The owning ``WorkflowExecution.id``; used by executors
            when persisting ``ExecutionNode`` rows.
        predecessor_ids: IDs of upstream nodes whose results are available
            in ``results``.
        params: The trigger parameters for this run (root-level input).
        results: Map of node_id -> previously produced ``NodeResult.result``
            payload for completed predecessors.
    """

    node: dict
    execution_id: str
    predecessor_ids: list[str]
    params: dict
    results: dict[str, Any]


@dataclass
class NodeResult:
    """Standardized result returned by ``NodeExecutor.execute``.

    Fields:
        result: The primary payload for this node. Downstream nodes receive
            this via ``NodeContext.results[predecessor_id]``.
        output: Optional structured output to persist on ``ExecutionNode``.
            Defaults to ``None``; when ``None`` the executor/engine is
            expected to derive a sensible value (often ``result`` itself).
        session_id: HAPI session id created/reused by this node, if any.
            Used for serial chain session reuse.
        error: Populated when the executor wants to report a soft failure
            while still returning a result object.
    """

    result: dict[str, Any]
    output: dict[str, Any] | None = None
    session_id: str | None = None
    error: str | None = None


class NodeExecutor(ABC):
    """Abstract base class for all workflow node executors.

    Concrete subclasses implement :meth:`execute` for a single node type
    (``input``, ``output``, ``debate``, or regular agent). The optional
    ``dispatcher`` is injected so executors that need to talk to agents
    (debate, regular) can reuse the same instance the engine holds.

    Subclasses are responsible for committing their own DB writes via
    :meth:`_commit`; this base class does not wrap or centralize
    transactions.
    """

    def __init__(self, dispatcher: AgentDispatcher | None = None) -> None:
        self.dispatcher = dispatcher

    @abstractmethod
    async def execute(self, ctx: NodeContext) -> NodeResult:
        """Execute ``ctx.node`` and return a :class:`NodeResult`.

        Implementations must not assume any transaction boundary; they
        should call :meth:`_commit` explicitly when they have completed a
        logical unit of work.
        """
        raise NotImplementedError

    def _commit(self, db: Session) -> None:
        """Commit the current SQLAlchemy session.

        Helper for concrete executors; each executor decides when (and how
        often) to commit. This intentionally does NOT open, close, or
        roll back transactions — it only forwards to ``db.commit()``.
        """
        db.commit()
