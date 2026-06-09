"""Service layer — business logic separated from API and core engines.

This package contains:
  - Service protocols and exceptions (Wave 2)
  - ConversationService, WorkflowService, etc. (Wave 3+)
  - MessageProcessor for async background tasks
  - UnitOfWork for cross-repository transactions
"""

from .exceptions import NotFoundError, ServiceError
from .protocols import ServiceProtocol
from .unit_of_work import UnitOfWork

__all__ = [
    "ServiceProtocol",
    "ServiceError",
    "NotFoundError",
    "UnitOfWork",
]
