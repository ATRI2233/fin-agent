"""Centralised status constants and transition validation.

Every status mutation in the system should route through
``validate_transition`` to ensure illegal state changes are rejected early
with a clear error message.  The transition tables below are derived from
the actual code paths discovered in the codebase (see git history for the
full audit).

Usage::

    from main.framework.core.state_machine import validate_transition, ExecutionStatus

    validate_transition("execution", old_status, new_status)
    execution.status = new_status
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# Status value constants
# ---------------------------------------------------------------------------


class ExecutionStatus:
    """Canonical values for ``WorkflowExecution.status``."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

    TERMINAL = frozenset({COMPLETED, FAILED, CANCELLED})


class NodeStatus:
    """Canonical values for ``ExecutionNode.status``."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"
    CLEANED_UP = "cleaned_up"

    TERMINAL = frozenset({COMPLETED, FAILED, SKIPPED, CLEANED_UP})


class WorkflowStatus:
    """Canonical values for ``Workflow.status``."""

    DRAFT = "draft"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    PAUSED = "paused"


class SessionStatus:
    """Derived session statuses (not persisted, mapped from node status)."""

    ACTIVE = "active"
    INACTIVE = "inactive"
    CLEANED_UP = "cleaned_up"
    UNKNOWN = "unknown"


# ---------------------------------------------------------------------------
# Transition tables
# ---------------------------------------------------------------------------

TRANSITIONS: dict[str, dict[str, frozenset[str]]] = {
    "workflow": {
        WorkflowStatus.DRAFT:     frozenset({WorkflowStatus.RUNNING, WorkflowStatus.PAUSED}),
        WorkflowStatus.RUNNING:   frozenset({WorkflowStatus.COMPLETED, WorkflowStatus.FAILED, WorkflowStatus.PAUSED}),
        WorkflowStatus.COMPLETED: frozenset({WorkflowStatus.DRAFT}),
        WorkflowStatus.FAILED:    frozenset({WorkflowStatus.DRAFT}),
        WorkflowStatus.PAUSED:    frozenset({WorkflowStatus.RUNNING, WorkflowStatus.DRAFT}),
    },
    "execution": {
        ExecutionStatus.PENDING:   frozenset({ExecutionStatus.RUNNING, ExecutionStatus.FAILED, ExecutionStatus.CANCELLED}),
        ExecutionStatus.RUNNING:   frozenset({ExecutionStatus.COMPLETED, ExecutionStatus.FAILED, ExecutionStatus.CANCELLED}),
        ExecutionStatus.COMPLETED: frozenset(),
        ExecutionStatus.FAILED:    frozenset(),
        ExecutionStatus.CANCELLED: frozenset(),
    },
    "node": {
        NodeStatus.PENDING:    frozenset({NodeStatus.RUNNING, NodeStatus.COMPLETED, NodeStatus.FAILED, NodeStatus.SKIPPED}),
        NodeStatus.RUNNING:    frozenset({NodeStatus.COMPLETED, NodeStatus.FAILED, NodeStatus.SKIPPED}),
        NodeStatus.COMPLETED:  frozenset({NodeStatus.CLEANED_UP}),
        NodeStatus.FAILED:     frozenset({NodeStatus.CLEANED_UP}),
        NodeStatus.SKIPPED:    frozenset(),
        NodeStatus.CLEANED_UP: frozenset(),
    },
}


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


class InvalidStatusTransition(Exception):
    """Raised when a status transition is not in the allowed table."""

    def __init__(self, domain: str, from_status: str, to_status: str) -> None:
        self.domain = domain
        self.from_status = from_status
        self.to_status = to_status
        super().__init__(
            f"Invalid {domain} transition: '{from_status}' → '{to_status}'"
        )


def validate_transition(domain: str, from_status: str, to_status: str) -> None:
    """Raise ``InvalidStatusTransition`` if the transition is not allowed.

    Parameters
    ----------
    domain:
        One of ``"workflow"``, ``"execution"``, ``"node"``.
    from_status:
        Current status value.
    to_status:
        Desired new status value.

    Raises
    ------
    InvalidStatusTransition
        If the (from_status, to_status) pair is not in the transition table.
    KeyError
        If ``domain`` or ``from_status`` is not in the table at all — this
        is a programming error, not a user input issue.
    """
    allowed = TRANSITIONS[domain][from_status]
    if to_status not in allowed:
        raise InvalidStatusTransition(domain, from_status, to_status)
