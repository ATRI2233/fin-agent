"""Backward-compat re-export shim for the workflows router.

The HTTP handlers used to live here. They have moved to
``main.framework.controllers.workflows`` (Wave 2 pilot) — this module re-publishes
the router so existing import paths (``from main.framework.api.workflows import
router``) and the ``app.include_router(workflows_router)`` call in ``main.py``
keep working unchanged.
"""

from main.framework.controllers.workflows import router

__all__ = ["router"]
