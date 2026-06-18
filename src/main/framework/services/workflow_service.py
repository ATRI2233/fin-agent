"""Shim: re-export for backward compatibility. Canonical location: main.framework.services.core.workflow_service"""

from main.framework.services.core.workflow_service import ( # noqa: F401
    ExecutionServiceProtocol,
    NodeExecutorRegistryProtocol,
    StatusCallback,
    WorkflowRepositoryProtocol,
    WorkflowService,
)
