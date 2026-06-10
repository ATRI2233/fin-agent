"""Scheduler API routes — re-exported from controllers/.

The actual route definitions live in ``main.framework.controllers.scheduler``.
This shim preserves the original ``from main.framework.api.scheduler_routes
import router`` import path so ``main.py`` (which registers this router BEFORE
``workflows.py`` so the explicit ``/scheduled`` path resolves before the
``/{workflow_id}`` catch-all) keeps working unchanged.
"""

from main.framework.controllers.scheduler import router

__all__ = ["router"]
