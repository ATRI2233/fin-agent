"""Parser for opencode CLI JSON output.

opencode run --format json emits newline-delimited JSON events:
  {"type":"step_start","sessionID":"ses_...","part":{...}}
  {"type":"text","sessionID":"ses_...","part":{"text":"...","type":"text",...}}
  {"type":"step_finish","sessionID":"ses_...","part":{"reason":"stop",...}}

We extract the session ID and final response text.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class ParsedOutput:
    """Result of parsing a complete opencode JSON output stream."""

    session_id: str = ""
    text: str = ""
    reason: str = ""
    tokens: dict = field(default_factory=dict)
    events: list[dict] = field(default_factory=list)
    error: str = ""


def strip_thinking(text: str) -> str:
    """Remove <think>...</think> blocks from response text."""
    return re.sub(r"<think>[\s\S]*?</think>", "", text).strip()


def parse_line(line: str) -> dict | None:
    """Parse a single JSON line. Returns None if not valid JSON."""
    line = line.strip()
    if not line:
        return None
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        logger.debug("Non-JSON line: %s", line[:200])
        return None


def parse_stream(lines: list[str]) -> ParsedOutput:
    """Parse a complete opencode JSON output stream.

    Args:
        lines: List of raw output lines from opencode stdout.

    Returns:
        ParsedOutput with extracted session_id, text, reason, tokens.
    """
    result = ParsedOutput()
    text_parts: list[str] = []

    for raw_line in lines:
        event = parse_line(raw_line)
        if event is None:
            continue

        result.events.append(event)

        # Extract session ID from any event
        sid = event.get("sessionID", "")
        if sid and not result.session_id:
            result.session_id = sid

        event_type = event.get("type", "")
        part = event.get("part", {})

        if event_type == "text":
            text = part.get("text", "")
            if text:
                text_parts.append(text)

        elif event_type == "step_finish":
            result.reason = part.get("reason", "")
            result.tokens = part.get("tokens", {})

        elif event_type == "error":
            result.error = part.get("message", "") or str(part)

    # Combine all text parts and strip thinking blocks
    raw_text = "".join(text_parts)
    result.text = strip_thinking(raw_text)

    return result
