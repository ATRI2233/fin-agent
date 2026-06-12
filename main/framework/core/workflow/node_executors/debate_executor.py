"""Debate node executor — runs multi-agent debate via DebateExecutor. Backend call."""

from __future__ import annotations

import json
from typing import Any

from main.framework.core.agents.debate_executor import DebateExecutor
from main.framework.core.workflow.node_executors.base import (
    NodeContext,
    NodeExecutor,
    NodeResult,
)


class DebateNodeExecutor(NodeExecutor):
    """Executor for ``type == "debate"`` workflow nodes.

    Debate nodes fan a single prompt out to multiple agents in parallel, then
    have a judge agent pick the winning analysis. The actual dispatch is
    delegated to :class:`main.framework.core.debate_executor.DebateExecutor`;
    this class is only responsible for the workflow-level concerns: enriching
    the node's prompt with upstream results, calling the underlying
    ``DebateExecutor``, and packaging its output in a :class:`NodeResult`.
    """

    def __init__(self, dispatcher: Any = None) -> None:
        # ``dispatcher`` is forwarded to the underlying ``DebateExecutor``;
        # the engine injects it so the debate reuses the same dispatcher
        # instance the rest of the workflow uses.
        super().__init__(dispatcher=dispatcher)

    async def execute(self, ctx: NodeContext) -> NodeResult:
        # Enrich the node's prompt template with trigger params, node-level
        # fields, and any upstream predecessor results, mirroring the
        # ``_build_prompt`` logic the engine used to apply inline.
        enriched_prompt = self._build_enriched_prompt(ctx)

        node_with_prompt = {**ctx.node, "prompt": enriched_prompt}

        # Delegate to the real debate runner. ``execute_debate`` is async
        # in the underlying class; ``DebateExecutor`` was designed for an
        # async context, so we simply ``await`` it from this async executor.
        # ``self.dispatcher`` is typed as ``AgentDispatcher | None`` on the
        # base class to allow pure executors (input/output) to skip
        # injection; the engine always injects a real dispatcher for
        # debate/agent executors, matching the inline handler in
        # ``workflow_engine.py``.
        debate_exec = DebateExecutor(self.dispatcher)  # type: ignore[arg-type]
        debate_output = await debate_exec.execute_debate(node_with_prompt)

        return NodeResult(
            result={"debate_output": debate_output},
            output=debate_output,
        )

    # ------------------------------------------------------------------
    # Prompt enrichment
    # ------------------------------------------------------------------

    @staticmethod
    def _build_enriched_prompt(ctx: NodeContext) -> str:
        """Build the prompt that will be fanned out to debate agents.

        Mirrors the relevant subset of ``WorkflowEngine._build_prompt``:
        substitute ``{param}`` and ``{node_field}`` placeholders from the
        node definition and the trigger ``params``, then append the
        predecessor outputs as a structured "Upstream Outputs" block when
        the ``{upstream}`` placeholder isn't already present in the
        template.
        """
        template: str = ctx.node.get("prompt", "")
        prompt = template

        # Trigger params (root-level workflow input)
        for key, value in (ctx.params or {}).items():
            prompt = prompt.replace(f"{{{key}}}", str(value))

        # Node-level fields (only string scalars are safe to interpolate)
        for key, value in (ctx.node or {}).items():
            if isinstance(value, str):
                prompt = prompt.replace(f"{{{key}}}", value)

        # Predecessor results
        if ctx.predecessor_ids:
            upstream_outputs: list[dict[str, Any]] = []
            for pred_id in ctx.predecessor_ids:
                pred_result = ctx.results.get(pred_id)
                if isinstance(pred_result, dict):
                    output = pred_result.get("result", pred_result)
                    if not isinstance(output, str):
                        try:
                            output = json.dumps(output, ensure_ascii=False)
                        except TypeError:
                            output = str(output)
                else:
                    output = str(pred_result) if pred_result is not None else ""
                if output:
                    upstream_outputs.append({"agent_name": pred_id, "output": output})

            if upstream_outputs:
                merged = "\n\n".join(f"[{item['agent_name']}]\n{item['output']}" for item in upstream_outputs)
                if "{upstream}" in prompt:
                    prompt = prompt.replace("{upstream}", merged)
                else:
                    prompt = f"{prompt}\n\n--- Upstream Outputs ---\n{merged}"

        return prompt
