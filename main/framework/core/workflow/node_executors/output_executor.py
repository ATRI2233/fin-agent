"""Output node executor — collects upstream outputs, merges via merge_inputs, returns result. No backend call."""

from __future__ import annotations

import logging
from datetime import datetime, UTC
from typing import Any

from main.framework.core.agents.input_merger import merge_inputs
from main.framework.core.workflow.node_executors.base import (
    NodeContext,
    NodeExecutor,
    NodeResult,
)
from main.framework.models.workflow_execution import ExecutionNode

logger = logging.getLogger(__name__)


def _extract_text(value: Any) -> str:
    """Extract human-readable text from a node result value.

    Handles nested dicts like ``{"output": "text"}`` or ``{"result": {"output": "text"}}``.
    """
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return str(value)

    # Try common meaningful keys
    for key in ("output", "result", "text", "content", "answer", "response"):
        if key in value:
            nested = value[key]
            if isinstance(nested, str):
                return nested
            if isinstance(nested, dict):
                # One more level of nesting
                for inner_key in ("output", "result", "text", "content", "answer", "response"):
                    if inner_key in nested and isinstance(nested[inner_key], str):
                        return nested[inner_key]

    # Fallback: first string value
    for v in value.values():
        if isinstance(v, str) and v.strip():
            return v

    return str(value)


def _resolve_upstream_text(pred_result: Any) -> str:
    """Extract the actual output text from a predecessor's stored result.

    ``_results[node_id]`` stores ``{"result": ..., "output": ..., "session_id": ...}``.
    For agent nodes, ``result`` is ``{"output": "actual text"}``.
    This function drills down to find the actual text.
    """
    if not isinstance(pred_result, dict):
        return str(pred_result) if pred_result else ""

    # First try the "result" key (what execute_node returns as primary payload)
    raw = pred_result.get("result")
    if raw is not None:
        return _extract_text(raw)

    # Fallback to "output" key
    raw = pred_result.get("output")
    if raw is not None:
        return _extract_text(raw)

    return _extract_text(pred_result)


class OutputNodeExecutor(NodeExecutor):
    """Executor for ``type == "output"`` workflow nodes.

    Output nodes aggregate results from upstream predecessors, merge them via
    :func:`main.framework.core.input_merger.merge_inputs`, and return the
    merged payload. They never invoke a dispatcher or backend.
    """

    def __init__(self, db=None) -> None:
        # Pure node — no backend/dispatcher needed; skip injection.
        super().__init__(dispatcher=None)
        self._db = db

    async def execute(self, ctx: NodeContext) -> NodeResult:
        upstream = {pid: ctx.results.get(pid) for pid in ctx.predecessor_ids}

        # Convert upstream dict into the list-of-{agent_name, output} shape
        # that merge_inputs expects. Extract actual text from nested result
        # structures (e.g. {"result": {"output": "text"}}).
        upstream_list: list[dict] = []
        for pid, pred_result in upstream.items():
            text = _resolve_upstream_text(pred_result)
            if text and text != "{}":
                upstream_list.append({"agent_name": pid, "output": text})

        merged = merge_inputs(upstream_list)

        output_key = ctx.node.get("data", {}).get("outputKey")
        output = {output_key: merged} if output_key else merged

        self._safe_db_update(ctx, merged)

        return NodeResult(result=merged, output=output)

    def _safe_db_update(self, ctx: NodeContext, merged: str) -> None:
        """Update ExecutionNode with rollback-on-failure semantics."""
        if self._db is None:
            return
        try:
            exec_node = self._db.query(ExecutionNode).filter_by(
                execution_id=ctx.execution_id, node_id=ctx.node["id"]
            ).first()
            if exec_node is not None:
                exec_node.status = "completed"
                exec_node.output = {"result": merged}
                exec_node.completed_at = datetime.now(UTC)
            self._db.commit()
        except Exception as e:
            logger.warning("DB update failed for output node %s: %s", ctx.node["id"], e)
            try:
                self._db.rollback()
            except Exception:
                pass
