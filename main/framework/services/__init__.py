"""Service layer — business logic separated from API and core engines.

This package contains:
  - Service protocols and exceptions (Wave 2)
  - ConversationService, WorkflowService, etc. (Wave 3+)
  - MessageProcessor for async background tasks
  - UnitOfWork for cross-repository transactions
"""

from .conversation_service import ConversationService
from .exceptions import NotFoundError, ServiceError
from .execution_service import ExecutionService
from .protocols import ServiceProtocol
from .scheduler_service import SchedulerService
from .unit_of_work import UnitOfWork
from .workflow_service import WorkflowService

__all__ = [
    "ConversationService",
    "ExecutionService",
    "NotFoundError",
    "SchedulerService",
    "ServiceError",
    "ServiceProtocol",
    "UnitOfWork",
    "WorkflowService",
]
