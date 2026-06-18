"""Session management — opencode serve HTTP backend.

Agent dispatch via opencode serve HTTP API for parallel execution.
"""

from main.session.output_parser import ParsedOutput, parse_stream, strip_thinking
from main.session.serve_backend import ServeBackend

__all__ = [
    "ServeBackend",
    "ParsedOutput",
    "parse_stream",
    "strip_thinking",
]
