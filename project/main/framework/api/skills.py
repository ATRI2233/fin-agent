"""Backward-compat re-export shim for the skills router.

The HTTP handlers used to live here. They have moved to
``main.framework.controllers.skills`` (Wave 2 pilot) — this module re-publishes
the router so existing import paths (``from main.framework.api.skills import
router``) and the ``app.include_router(skills_router)`` call in ``main.py``
keep working unchanged.
"""

from main.framework.controllers.skills import router

__all__ = ["router"]
