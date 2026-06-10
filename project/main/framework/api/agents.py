"""Backward-compat re-export shim for the agents router.

The HTTP handlers used to live here. They have moved to
``main.framework.controllers.agents`` (Wave 2 pilot) — this module
re-publishes the router so existing import paths
(``from main.framework.api.agents import router``) and the
``app.include_router(agents_router)`` call in ``main.py`` keep working
unchanged.
"""

from main.framework.controllers.agents import router

__all__ = ["router"]
