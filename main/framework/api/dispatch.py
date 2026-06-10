"""Backward-compat re-export shim for the dispatch router.

The HTTP handlers used to live here. They have moved to
``main.framework.controllers.dispatch`` (Wave 2 pilot) — this module
re-publishes the router so existing import paths
(``from main.framework.api.dispatch import router``) and the
``app.include_router(dispatch_router)`` call in ``main.py`` keep
working unchanged.
"""

from main.framework.controllers.dispatch import router

__all__ = ["router"]
