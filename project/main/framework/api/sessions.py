"""Backward-compat re-export shim for the sessions router.

Handlers moved to ``main.framework.controllers.sessions``; this module keeps
``from main.framework.api.sessions import router`` working.
"""

from main.framework.controllers.sessions import router

__all__ = ["router"]
