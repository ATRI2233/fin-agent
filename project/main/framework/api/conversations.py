"""Conversation API routes — re-exported from controllers/.

This file exists for backward compat with `from main.framework.api.conversations import router`.
The actual route definitions live in `main.framework.controllers.conversations`.
"""

from main.framework.controllers.conversations import router

__all__ = ["router"]
