"""Service protocol — marker interface for DI-registered services.

Service lifetime convention:
  @singleton: one instance per process (e.g., ConversationService)
  @per_execution: fresh instance per workflow/run (e.g., WorkflowEngine)
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class ServiceProtocol(Protocol):
    """Marker interface for DI-registered services.

    Concrete implementations declare lifetime via @singleton or @per_execution
    decorators on the DI container registration (not on the class itself).
    """

    def __init__(self, **deps: Any) -> None:
        """Construct the service with injected dependencies."""
        ...

    def health_check(self) -> bool:
        """Return True if the service is operational, False otherwise."""
        ...
