"""Input node executor — returns workflow params as node result. No backend call."""

from __future__ import annotations

from main.framework.core.workflow.node_executors.base import (
    NodeContext,
    NodeExecutor,
    NodeResult,
)


class InputNodeExecutor(NodeExecutor):
    """Executor for ``type == "input"`` workflow nodes.

    Input nodes are pure pass-through: they expose the workflow trigger
    ``params`` as their result so downstream nodes can read them via
    ``NodeContext.results``. There is no dispatcher call and no DB state
    change.
    """

    def __init__(self) -> None:
        # Input nodes never talk to a backend, so we deliberately skip
        # injecting the dispatcher and pass None to the base class.
        super().__init__(dispatcher=None)

    async def execute(self, ctx: NodeContext) -> NodeResult:
        return NodeResult(
            result=ctx.params,
            output={"input": ctx.params},
        )
