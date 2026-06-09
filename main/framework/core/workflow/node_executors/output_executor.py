"""Output node executor — collects upstream outputs, merges via merge_inputs, returns result. No backend call."""

from __future__ import annotations

from main.framework.core.input_merger import merge_inputs
from main.framework.core.workflow.node_executors.base import (
    NodeContext,
    NodeExecutor,
    NodeResult,
)


class OutputNodeExecutor(NodeExecutor):
    """Executor for ``type == "output"`` workflow nodes.

    Output nodes aggregate results from upstream predecessors, merge them via
    :func:`main.framework.core.input_merger.merge_inputs`, and return the
    merged payload. They never invoke a dispatcher or backend.
    """

    def __init__(self) -> None:
        # Pure node — no backend/dispatcher needed; skip injection.
        super().__init__(dispatcher=None)

    async def execute(self, ctx: NodeContext) -> NodeResult:
        upstream = {pid: ctx.results.get(pid) for pid in ctx.predecessor_ids}

        # Convert upstream dict into the list-of-{agent_name, output} shape
        # that merge_inputs expects, mirroring the original workflow_engine
        # output-node handler.
        upstream_list: list[dict] = []
        for pid, pred_result in upstream.items():
            output = pred_result.get("result", str(pred_result)) if isinstance(pred_result, dict) else str(pred_result)
            if output:
                upstream_list.append({"agent_name": pid, "output": output})

        merged = merge_inputs(upstream_list)

        output_key = ctx.node.get("data", {}).get("outputKey")
        output = {output_key: merged} if output_key else merged

        return NodeResult(result=merged, output=output)
