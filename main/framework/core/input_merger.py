"""Input merger for agent outputs."""

from typing import List


def truncate_output(output: str, max_size: int = 10240) -> str:
    """Truncate output to max_size bytes, adding [truncated] suffix if cut."""
    if len(output.encode("utf-8")) <= max_size:
        return output
    truncated = output[:max_size]
    return truncated + "[truncated]"


def merge_inputs(inputs: List[dict]) -> str:
    """Merge a list of agent inputs into a formatted string.

    Each input should be a dict with 'agent_name' and 'output' keys.
    Empty outputs are skipped.
    Outputs over 10KB are truncated.
    """
    parts: List[str] = []
    for inp in inputs:
        agent_name = inp.get("agent_name", "")
        output = inp.get("output", "")
        if not output:
            continue
        output = truncate_output(output)
        parts.append(f"{agent_name}: {output}")
    return "\n".join(parts)
