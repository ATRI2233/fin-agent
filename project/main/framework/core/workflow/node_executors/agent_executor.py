"""Agent node executor — handles session reuse for serial chains, dispatch to agent via AgentDispatcher. Backend call. Has own db.commit() per node."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from main.framework.core.workflow.node_executors.base import (
    NodeContext,
    NodeExecutor,
    NodeResult,
)
from main.framework.models.workflow_execution import ExecutionNode
from main.framework.services.workflow_graph import is_only_successor

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from main.framework.core.agent_dispatcher import AgentDispatcher


class AgentNodeExecutor(NodeExecutor):
    """Executor for regular ``type == "agent"`` workflow nodes.

    This is the largest and most complex executor because it owns three
    concerns that the engine used to mix together:

    1. **Serial-chain session reuse** — when a node has exactly one
       predecessor AND that predecessor has only this node as its
       successor (i.e. not a fan-out), reuse the predecessor's session.
       Otherwise dispatch opens a brand-new session.
    2. **Agent dispatch** — delegates to ``AgentDispatcher.dispatch``
       with the resolved ``session_id`` (or ``None`` to force a new
       session) and the agent prompt.
    3. **Per-node DB writes** — finds/updates the ``ExecutionNode``
       row for this node and commits the SQLAlchemy session itself.
       Centralising the commit elsewhere would couple executor
       lifetimes to engine transaction boundaries, so we keep the
       original "commit per node" behaviour.

    Construction:
        ``dispatcher`` is required because every agent node makes a
        backend call. ``db`` and ``chain_sessions`` are optional and
        normally injected by ``WorkflowEngine`` — if they are omitted,
        DB writes are skipped and the executor maintains its own
        in-memory session map (suitable for unit tests).
    """

    def __init__(
        self,
        dispatcher: AgentDispatcher,
        db: Session | None = None,
        chain_sessions: dict[str, str] | None = None,
    ) -> None:
        super().__init__(dispatcher=dispatcher)
        self._db = db
        # Mirrors WorkflowEngine._chain_sessions: node_id -> session_id.
        # If a shared map is injected, the engine can read/update it too.
        self._chain_sessions: dict[str, str] = chain_sessions if chain_sessions is not None else {}

    async def execute(self, ctx: NodeContext) -> NodeResult:
        node_id = ctx.node["id"]
        # Edges are normally supplied by the engine via ctx; fall back to
        # an empty list so unit tests that omit them still work (empty
        # edges => is_only_successor returns False => always new session).
        edges = getattr(ctx, "edges", [])

        # ---- Session reuse decision ----------------------------------
        # Only reuse when:
        #   1. exactly one predecessor, AND
        #   2. predecessor is the sole successor of ITS predecessor
        #      (prevents parallel branches from sharing a session).
        session_id: str | None = None
        if len(ctx.predecessor_ids) == 1:
            pred_id = ctx.predecessor_ids[0]
            if pred_id in self._chain_sessions and is_only_successor(node_id, pred_id, edges):
                session_id = self._chain_sessions[pred_id]

        # ---- Dispatch ------------------------------------------------
        # Local narrowing: base class types dispatcher as Optional, but for
        # agent nodes the constructor guarantees it is non-None.
        dispatcher = self.dispatcher
        if dispatcher is None:
            raise RuntimeError("AgentNodeExecutor requires a dispatcher; none was injected.")

        prompt = ctx.node.get("prompt", "")
        resp = await dispatcher.dispatch(
            agent=ctx.node.get("agent", ""),
            prompt=prompt,
            session_id=session_id,
        )
        result = resp["result"]
        new_session_id = resp["session_id"]
        self._chain_sessions[node_id] = new_session_id

        # ---- DB write (own commit, not centralised) ------------------
        if self._db is not None:
            exec_node = self._db.query(ExecutionNode).filter_by(execution_id=ctx.execution_id, node_id=node_id).first()
            if exec_node is not None:
                exec_node.status = "completed"
                exec_node.output = {"result": result}
                exec_node.session_id = new_session_id
                exec_node.completed_at = datetime.utcnow()
            self._db.commit()

        return NodeResult(
            result={"output": result},
            output=result,
            session_id=new_session_id,
        )
