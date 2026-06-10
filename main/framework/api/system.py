"""Re-export shim — system routes live in ``main.framework.controllers.system``."""

from main.framework.controllers.system import router

__all__ = ["router"]
