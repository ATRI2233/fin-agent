"""core/ package — cross-cutting infrastructure + domain modules.

Subdirs:
- infrastructure/: auth, container, logger, request_context, retry_handler, performance, protocols, log_collector
- workflow/: engine, parser, session_manager, session_cleanup, scheduler
- agents/: dispatcher, registry, debate_executor, input_merger
"""

# --- infrastructure (8 files) ---
# --- agents (4 files) ---
from main.framework.core.agents.agent_dispatcher import AgentDispatcher  # noqa: F401
from main.framework.core.agents.agent_registry import (  # noqa: F401
    AGENTS,
    AgentInfo,
    AgentRegistry,
    registry,
)
from main.framework.core.agents.debate_executor import DebateExecutor  # noqa: F401
from main.framework.core.agents.input_merger import merge_inputs, truncate_output  # noqa: F401
from main.framework.core.infrastructure.auth import APIKeyMiddleware  # noqa: F401
from main.framework.core.infrastructure.container import (  # noqa: F401
    Container,
    configure,
    get_container,
    get_service,
)
from main.framework.core.infrastructure.log_collector import (  # noqa: F401
    JobLogHandler,
    LogCollector,
    LogEntry,
    current_job_id,
    get_log_collector,
    setup_job_log_handler,
)
from main.framework.core.infrastructure.logger import (  # noqa: F401
    JsonLogFormatter,
    _RequestIdAdapter,
    get_logger,
    setup_logger,
)
from main.framework.core.infrastructure.performance import (  # noqa: F401
    ConcurrencyLimiter,
    NodeTimeout,
    cache_workflow,
    clear_workflow_cache,
    get_cached_workflow,
    get_concurrency_limiter,
    get_node_timeout,
    get_workflow_cache_size,
    get_workflow_definition_from_db,
    get_workflow_with_cache,
)
from main.framework.core.infrastructure.protocols import (  # noqa: F401
    AgentBackend,
    ExecutionStore,
    JobStore,
)
from main.framework.core.infrastructure.request_context import (  # noqa: F401
    RequestContextMiddleware,
    current_request_id,
    get_request_id,
)
from main.framework.core.infrastructure.retry_handler import (  # noqa: F401
    WorkflowRetryHandler,
    retry_on_failure,
)
from main.framework.core.workflow.scheduler import (  # noqa: F401
    WorkflowScheduler,
    get_next_run_times,
    run_scheduled_workflow,
    validate_cron_expression,
)
from main.framework.core.workflow.session_cleanup import (  # noqa: F401
    cleanup_on_shutdown,
    cleanup_workflow_sessions,
    get_active_executions,
    register_cleanup_hook,
    register_execution_session,
)
from main.framework.core.workflow.session_manager import (  # noqa: F401
    ConvSessionManager,
    SessionManager,
)

# --- workflow (5 files) ---
from main.framework.core.workflow.workflow_engine import (  # noqa: F401
    StatusCallback,
    WorkflowEngine,
)
from main.framework.core.workflow.workflow_parser import (  # noqa: F401
    Edge,
    Node,
    NodeId,
    identify_debate_blocks,
    identify_parallel_branches,
    identify_serial_chains,
    topological_sort,
    validate_dag,
)

__all__ = [
    # infrastructure
    "APIKeyMiddleware",
    "Container",
    "configure",
    "get_container",
    "get_service",
    "JsonLogFormatter",
    "_RequestIdAdapter",
    "get_logger",
    "setup_logger",
    "RequestContextMiddleware",
    "current_request_id",
    "get_request_id",
    "WorkflowRetryHandler",
    "retry_on_failure",
    "ConcurrencyLimiter",
    "NodeTimeout",
    "cache_workflow",
    "clear_workflow_cache",
    "get_cached_workflow",
    "get_concurrency_limiter",
    "get_node_timeout",
    "get_workflow_cache_size",
    "get_workflow_definition_from_db",
    "get_workflow_with_cache",
    "AgentBackend",
    "ExecutionStore",
    "JobStore",
    "JobLogHandler",
    "LogCollector",
    "LogEntry",
    "current_job_id",
    "get_log_collector",
    "setup_job_log_handler",
    # workflow
    "StatusCallback",
    "WorkflowEngine",
    "Edge",
    "Node",
    "NodeId",
    "identify_debate_blocks",
    "identify_parallel_branches",
    "identify_serial_chains",
    "topological_sort",
    "validate_dag",
    "ConvSessionManager",
    "SessionManager",
    "cleanup_on_shutdown",
    "cleanup_workflow_sessions",
    "get_active_executions",
    "register_cleanup_hook",
    "register_execution_session",
    "WorkflowScheduler",
    "get_next_run_times",
    "run_scheduled_workflow",
    "validate_cron_expression",
    # agents
    "AgentDispatcher",
    "AGENTS",
    "AgentInfo",
    "AgentRegistry",
    "registry",
    "DebateExecutor",
    "merge_inputs",
    "truncate_output",
]
