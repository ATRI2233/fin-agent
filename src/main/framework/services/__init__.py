"""Service layer — business logic separated from API and core engines.

This package is organised into three subpackages ( directory reorg):

* ``core/`` — Stateful services that own the runtime: workflow execution,
                  conversation / message / session lifecycle, scheduling, and
                  async background message processing.
* ``queries/`` — Read-side services that back the HTTP ``/api/v1/...`` query
                  endpoints (agents, dispatch, executions, skills, system,
                  tools, workflows) plus their Pydantic response models.
* ``patterns/`` — Cross-cutting infrastructure reused by the services above:
                  exception hierarchy, DI marker protocol, ``UnitOfWork``
                  transaction wrapper, and the stateless prompt / DAG
                  helpers.

All public names are re-exported from the subpackages so legacy
``from main.framework.services import X`` imports continue to work
unchanged after the directory reorganisation.
"""

# ---------------------------------------------------------------------------
# core/ — stateful runtime services
# ---------------------------------------------------------------------------
from .core.conversation_service import ConversationService # noqa: F401
from .core.execution_service import ExecutionService # noqa: F401
from .core.message_processor import ( # noqa: F401
    execute_workflow_async,
    process_agent_message,
)
from .core.scheduler_service import ( # noqa: F401
    SchedulerService,
    get_next_run_times,
    validate_cron_expression,
)
from .core.session_service import SessionService # noqa: F401
from .core.workflow_service import ( # noqa: F401
    ExecutionServiceProtocol,
    NodeExecutorRegistryProtocol,
    StatusCallback,
    WorkflowRepositoryProtocol,
    WorkflowService,
)

# ---------------------------------------------------------------------------
# patterns/ — cross-cutting infrastructure
# ---------------------------------------------------------------------------
from .patterns.exceptions import NotFoundError, ServiceError # noqa: F401
from .patterns.prompt_builder import build_prompt # noqa: F401
from .patterns.protocols import ServiceProtocol # noqa: F401
from .patterns.unit_of_work import UnitOfWork # noqa: F401
from .patterns.workflow_graph import ( # noqa: F401
    build_predecessors,
    find_downstream,
    is_leaf,
    is_only_successor,
)

# ---------------------------------------------------------------------------
# queries/ — read-side services for HTTP query endpoints
# ---------------------------------------------------------------------------
from .queries.agent_query_service import AgentQueryService # noqa: F401
from .queries.dispatch_query_service import DispatchQueryService # noqa: F401
from .queries.execution_query_service import ( # noqa: F401
    ExecutionListResponse,
    ExecutionQueryService,
    ExecutionSummary,
    RetryResponse,
    TimelineNode,
    TimelineResponse,
)
from .queries.skill_query_service import SkillQueryService # noqa: F401
from .queries.system_query_service import SystemQueryService # noqa: F401
from .queries.tool_query_service import ToolQueryService # noqa: F401
from .queries.workflow_query_service import MAX_NODES, WorkflowQueryService # noqa: F401

__all__ = [
    # core/
    "ConversationService",
    "ExecutionService",
    "ExecutionServiceProtocol",
    "NodeExecutorRegistryProtocol",
    "SchedulerService",
    "SessionService",
    "StatusCallback",
    "WorkflowRepositoryProtocol",
    "WorkflowService",
    "execute_workflow_async",
    "get_next_run_times",
    "process_agent_message",
    "validate_cron_expression",
    # queries/
    "AgentQueryService",
    "DispatchQueryService",
    "ExecutionListResponse",
    "ExecutionQueryService",
    "ExecutionSummary",
    "MAX_NODES",
    "RetryResponse",
    "SkillQueryService",
    "SystemQueryService",
    "TimelineNode",
    "TimelineResponse",
    "ToolQueryService",
    "WorkflowQueryService",
    # patterns/
    "NotFoundError",
    "ServiceError",
    "ServiceProtocol",
    "UnitOfWork",
    "build_prompt",
    "build_predecessors",
    "find_downstream",
    "is_leaf",
    "is_only_successor",
]
