"""Session management — agent dispatch backends.

Two implementations of the AgentBackend protocol:
- OpenCodeBackend: subprocess-per-call (legacy, fallback)
- ServeBackend: HTTP API to opencode serve (preferred for parallel workflows)
"""

from main.session.opencode_backend import OpenCodeBackend
from main.session.output_parser import ParsedOutput, parse_stream, strip_thinking
from main.session.process_pool import ProcessPool
from main.session.serve_backend import ServeBackend

__all__ = [
    "OpenCodeBackend",
    "ServeBackend",
    "ProcessPool",
    "ParsedOutput",
    "parse_stream",
    "strip_thinking",
]
