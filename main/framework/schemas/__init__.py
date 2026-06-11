"""Pydantic V2 schemas for the FastAPI framework — request/response models.

This package groups the request and response Pydantic models used by the
HTTP controllers. All models were extracted from ``main/framework/controllers/``
during Wave 3 of the Phase 5 directory reorganization (Tasks 9-14), to
separate the transport (HTTP/JSON) shape from the orchestration logic.

Each schema module is the canonical home for one controller's models:

* ``conversation``  — ConversationCreate, ConversationUpdate, MessageCreate,
                      MessageResponse, ConversationResponse
* ``workflow``      — WorkflowCreate, WorkflowUpdate, WorkflowTrigger
* ``trigger``       — NodeStatus, ExecutionStatusResponse, ExecutionResultResponse
* ``session``       — SessionInfo, SessionListResponse, CleanupRequest,
                      CleanupResponse
* ``scheduler``     — ScheduleRequest
* ``dispatch``      — DispatchRequest, DispatchResult, ParallelDispatchRequest,
                      ParallelDispatchResponse

Re-exports are kept flat so callers can write
``from main.framework.schemas import WorkflowCreate`` (or rely on the
explicit ``__all__`` for ``import *``). The ``# noqa: F401`` markers
silence the unused-import warning on every re-export, since the symbols
are intentionally consumed at the package boundary.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Conversation controller schemas
# ---------------------------------------------------------------------------
from main.framework.schemas.conversation import (  # noqa: F401
    ConversationCreate,
    ConversationResponse,
    ConversationUpdate,
    MessageCreate,
    MessageResponse,
)

# ---------------------------------------------------------------------------
# Dispatch controller schemas
# ---------------------------------------------------------------------------
from main.framework.schemas.dispatch import (  # noqa: F401
    DispatchRequest,
    DispatchResult,
    ParallelDispatchRequest,
    ParallelDispatchResponse,
)

# ---------------------------------------------------------------------------
# Scheduler controller schemas
# ---------------------------------------------------------------------------
from main.framework.schemas.scheduler import ScheduleRequest  # noqa: F401

# ---------------------------------------------------------------------------
# Session controller schemas
# ---------------------------------------------------------------------------
from main.framework.schemas.session import (  # noqa: F401
    CleanupRequest,
    CleanupResponse,
    SessionInfo,
    SessionListResponse,
)

# ---------------------------------------------------------------------------
# Trigger (execution status / result) controller schemas
# ---------------------------------------------------------------------------
from main.framework.schemas.trigger import (  # noqa: F401
    ExecutionResultResponse,
    ExecutionStatusResponse,
    NodeStatus,
)

# ---------------------------------------------------------------------------
# Workflow controller schemas
# ---------------------------------------------------------------------------
from main.framework.schemas.workflow import (  # noqa: F401
    WorkflowCreate,
    WorkflowTrigger,
    WorkflowUpdate,
)

__all__ = [
    # conversation
    "ConversationCreate",
    "ConversationResponse",
    "ConversationUpdate",
    "MessageCreate",
    "MessageResponse",
    # workflow
    "WorkflowCreate",
    "WorkflowTrigger",
    "WorkflowUpdate",
    # trigger
    "ExecutionResultResponse",
    "ExecutionStatusResponse",
    "NodeStatus",
    # session
    "CleanupRequest",
    "CleanupResponse",
    "SessionInfo",
    "SessionListResponse",
    # scheduler
    "ScheduleRequest",
    # dispatch
    "DispatchRequest",
    "DispatchResult",
    "ParallelDispatchRequest",
    "ParallelDispatchResponse",
]
