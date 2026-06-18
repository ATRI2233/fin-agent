"""Stateless prompt construction for workflow nodes. Pure function over node spec + upstream results."""

from __future__ import annotations

from typing import Any

from main.framework.core.agents.input_merger import merge_inputs


def _extract_text(value: Any) -> str:
    """Extract human-readable text from a value.

    For dicts, tries common keys (question, query, text, content, prompt,
    message) first; falls back to the first string value; last resort is
    str(value).
    """
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return str(value)

    # Try common meaningful keys (including "output" and "result" for workflow agent nodes)
    for key in ("output", "result", "question", "query", "text", "content", "prompt", "message", "input"):
        if key in value:
            nested = value[key]
            if isinstance(nested, str):
                return nested
            if isinstance(nested, dict):
                # One more level of nesting (e.g. {"result": {"output": "..."}})
                for inner_key in ("output", "result", "text", "content", "answer", "response"):
                    if inner_key in nested and isinstance(nested[inner_key], str):
                        return nested[inner_key]

    # Fallback: first string value in the dict
    for v in value.values():
        if isinstance(v, str) and v.strip():
            return v

    return str(value)


def build_prompt(
    template: str,
    node: dict[str, Any],
    edges: list[dict],
    params: dict[str, Any],
    results: dict[str, Any],
    predecessor_ids: list[str] | None = None,
    node_id: str | None = None,
) -> str:
    """Construct a node prompt by substituting params, attaching edge context, and merging upstream outputs.

    Args:
        template: Raw prompt template containing ``{placeholders}``.
        node: Node spec dict; any string-valued fields are substituted into the template.
        edges: Workflow edges; edges whose ``target`` equals ``node_id`` contribute connection context.
        params: Workflow-level parameters; ``{key}`` is replaced with ``str(value)``.
        results: Map of node_id -> execution result (dict with ``result`` key, or any value).
        predecessor_ids: Optional list of upstream node ids whose outputs feed into this node.
        node_id: Current node id; enables edge-based connection prompt injection.

    Returns:
        Fully rendered prompt string with upstream section appended (or substituted into ``{upstream}``).

    Example:
        >>> build_prompt("hello {name}", {}, [], {"name": "world"}, {})
        'hello world'
    """
    prompt = template

    for key, value in params.items():
        prompt = prompt.replace(f"{{{key}}}", str(value))

    for key, value in node.items():
        if isinstance(value, str):
            prompt = prompt.replace(f"{{{key}}}", value)

    if node_id:
        for edge in edges:
            if edge.get("target") == node_id:
                edge_prompt = edge.get("prompt", "")
                edge_type = edge.get("promptType", "context")
                if edge_prompt:
                    prompt = f"{prompt}\n\n--- Connection ({edge_type}) ---\n{edge_prompt}"

    if predecessor_ids:
        upstream_outputs: list[dict[str, str]] = []
        for pred_id in predecessor_ids:
            if pred_id in results:
                pred_result = results[pred_id]
                if isinstance(pred_result, dict):
                    raw = pred_result.get("result", pred_result)
                else:
                    raw = pred_result
                output = _extract_text(raw)
                if output:
                    upstream_outputs.append({"agent_name": pred_id, "output": output})

        if upstream_outputs:
            merged = merge_inputs(upstream_outputs)
            if "{upstream}" in prompt:
                prompt = prompt.replace("{upstream}", merged)
            else:
                prompt = f"{prompt}\n\n--- Upstream Outputs ---\n{merged}"

    return prompt
