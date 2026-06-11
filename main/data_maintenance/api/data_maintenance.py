"""Backward-compat re-export shim for the data-maintenance router.

HTTP handlers moved to ``main.data_maintenance.controllers.data_maintenance``.
This module re-publishes the router so existing import paths keep working.
"""

from main.data_maintenance.controllers.data_maintenance import router

__all__ = ["router"]
