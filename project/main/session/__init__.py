"""Session management — direct opencode CLI backend.

Agent dispatch via opencode subprocess with --agent flag for direct routing.
"""

from main.session.opencode_backend import OpenCodeBackend
from main.session.output_parser import ParsedOutput, parse_stream, strip_thinking
from main.session.process_pool import ProcessPool

__all__ = ["OpenCodeBackend", "ProcessPool", "ParsedOutput", "parse_stream"]
