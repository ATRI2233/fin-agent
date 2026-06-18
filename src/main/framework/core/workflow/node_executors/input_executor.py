"""Input node executor — returns workflow params as node result. No backend call."""

from __future__ import annotations

import logging
from datetime import datetime, UTC

from main.framework.core.workflow.node_executors.base import (
    NodeContext,
    NodeExecutor,
    NodeResult,
)
from main.framework.models.workflow_execution import ExecutionNode

logger = logging.getLogger(__name__)


class InputNodeExecutor(NodeExecutor):
    """Executor for ``type == "input"`` workflow nodes.

    Input nodes are pure pass-through: they expose the workflow trigger
    ``params`` as their result so downstream nodes can read them via
    ``NodeContext.results``. There is no dispatcher call.
    """

    def __init__(self, db=None) -> None:
        # Input nodes never talk to a backend, so we deliberately skip
        # injecting the dispatcher and pass None to the base class.
        super().__init__(dispatcher=None)
        self._db = db

    async def execute(self, ctx: NodeContext) -> NodeResult:
        self._safe_db_update(ctx, {"input": ctx.params})
        return NodeResult(
            result=ctx.params,
            output={"input": ctx.params},
        )

    def _safe_db_update(self, ctx: NodeContext, output: dict) -> None:
        """Update ExecutionNode with rollback-on-failure semantics."""
        if self._db is None:
            return
        try:
            exec_node = self._db.query(ExecutionNode).filter_by(
                execution_id=ctx.execution_id, node_id=ctx.node["id"]
            ).first()
            if exec_node is not None:
                exec_node.status = "completed"
                exec_node.output = output
                exec_node.completed_at = datetime.now(UTC)
            self._db.commit()
        except Exception as e:
            logger.warning("DB update failed for input node %s: %s", ctx.node["id"], e)
            try:
                self._db.rollback()
            except Exception:
                pass
