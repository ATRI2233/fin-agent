"""Agent node executor — handles session reuse for serial chains, dispatch to agent via AgentDispatcher. Backend call. Has own db.commit() per node."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from main.framework.config.constants import MAX_AGENT_RETRIES
from main.framework.core.workflow.node_executors.base import (
    NodeContext,
    NodeExecutor,
    NodeResult,
)
from main.framework.models.workflow_execution import ExecutionNode
from main.framework.services.patterns.prompt_builder import build_prompt
from main.framework.services.workflow_graph import is_only_successor

if TYPE_CHECKING:
    from main.framework.core.agents.agent_dispatcher import AgentDispatcher
    from sqlalchemy.orm import Session


def _resolve_agent_name(node: dict[str, Any]) -> str:
    """Resolve agent name from node spec. Checks ``agent``, then ``data.agentType``, then ``data.label``."""
    agent = node.get("agent", "")
    if agent:
        return agent
    data = node.get("data", {})
    if isinstance(data, dict):
        return data.get("agentType", "") or data.get("label", "")
    return ""


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
        dispatcher: AgentDispatcher = None,
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

        try:
            # ---- Session reuse decision ----------------------------------
            # Only reuse when:
            # 1. exactly one predecessor, AND
            # 2. predecessor is the sole successor of ITS predecessor
            # (prevents parallel branches from sharing a session).
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

            # Resolve agent name: node["agent"] -> data.agentType -> data.label
            agent = _resolve_agent_name(ctx.node)
            if not agent:
                raise RuntimeError(f"Node {node_id} has no agent name defined")

            # Validate agent definition file exists
            agent_file = os.path.join(".opencode", "agents", f"{agent}.md")
            if not os.path.isfile(agent_file):
                raise RuntimeError(
                    f"Agent '{agent}' definition not found: {agent_file}. "
                    f"Create the agent .md file or fix the node's agentType/label."
                )

            # Build prompt from template + params + upstream results
            template = ctx.node.get("prompt", "")
            prompt = build_prompt(
                template=template,
                node=ctx.node,
                edges=edges,
                params=ctx.params,
                results=ctx.results,
                predecessor_ids=ctx.predecessor_ids,
                node_id=node_id,
            )

            # Dispatch with retry for transient HTTP errors (e.g. backend 500).
            # Retry up to MAX_AGENT_RETRIES-1 times with linear backoff for 5xx errors.
            resp = None
            last_error: Exception | None = None
            for attempt in range(MAX_AGENT_RETRIES):
                try:
                    resp = await dispatcher.dispatch(
                        agent=agent,
                        prompt=prompt,
                        session_id=session_id,
                    )
                    last_error = None
                    break
                except RuntimeError as dispatch_err:
                    err_str = str(dispatch_err)
                    # Only retry on 5xx server errors, not 4xx client errors
                    if "HTTP 5" in err_str and attempt < MAX_AGENT_RETRIES - 1:
                        logger.warning(
                            "Dispatch to agent '%s' failed (attempt %d/%d): %s. Retrying...",
                            agent, attempt + 1, MAX_AGENT_RETRIES, err_str[:120],
                        )
                        await asyncio.sleep(1.0 * (attempt + 1))
                        last_error = dispatch_err
                        continue
                    # Non-retryable or last attempt — store and re-raise
                    last_error = dispatch_err
                    raise
            if last_error:
                raise last_error
            result = resp["result"]
            new_session_id = resp["session_id"]
            self._chain_sessions[node_id] = new_session_id

            # ---- DB write (own commit, not centralised) ------------------
            self._safe_db_update(ctx.execution_id, node_id, "completed", output={"result": result}, session_id=new_session_id)

            return NodeResult(
                result={"output": result},
                output=result,
                session_id=new_session_id,
            )
        except Exception as e:
            # Persist error details to ExecutionNode before re-raising
            self._safe_db_update(ctx.execution_id, node_id, "failed", error=str(e))
            raise

    def _safe_db_update(
        self,
        execution_id: str,
        node_id: str,
        status: str,
        output: dict | None = None,
        session_id: str | None = None,
        error: str | None = None,
    ) -> None:
        """Update ExecutionNode with rollback-on-failure semantics."""
        if self._db is None:
            return
        try:
            exec_node = self._db.query(ExecutionNode).filter_by(
                execution_id=execution_id, node_id=node_id
            ).first()
            if exec_node is not None:
                exec_node.status = status
                if output is not None:
                    exec_node.output = output
                if session_id is not None:
                    exec_node.session_id = session_id
                if error is not None:
                    exec_node.error = error
                exec_node.completed_at = datetime.now(UTC)
            self._db.commit()
        except Exception as db_err:
            logger.warning("DB update failed for agent node %s: %s", node_id, db_err)
            try:
                self._db.rollback()
            except Exception:
                pass
