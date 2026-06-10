"""Backward-compat re-export shim for the triggers router.

The HTTP handlers used to live here. They have moved to
``main.framework.controllers.triggers`` (Wave 2 pilot) — this module re-publishes
the router so existing import paths (``from main.framework.api.triggers import
router``) and the ``app.include_router(triggers_router)`` call in ``main.py``
keep working unchanged.
"""

from main.framework.controllers.triggers import router

__all__ = ["router"]
