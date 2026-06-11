"""Backward-compat re-export shim for the tools router.

The HTTP handlers used to live here. They have moved to
``main.framework.controllers.tools`` (Wave 2 pilot) — this module re-publishes
the router so existing import paths (``from main.framework.api.tools import
router``) and the ``app.include_router(tools_router)`` call in ``main.py``
keep working unchanged.
"""

from main.framework.controllers.tools import router

__all__ = ["router"]
