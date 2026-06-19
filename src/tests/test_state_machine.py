"""Tests for state_machine.py — transition validation and status constants."""

from __future__ import annotations

import pytest

# TASK-500: shim importer switched on 2026-06-19
# NOTE: Legacy test using old state machine API. New system only has
# ExecutionStatus + InvalidStateTransitionError. The other entities
# (NodeStatus, WorkflowStatus) don't exist in the new system, so stubs
# are provided for legacy test logic continuity.
from src.main.modules.execution.domain.execution_node import (
    ExecutionStatus,
    ExecutionNode,
)
from src.main.infra.errors import InvalidStateTransitionError as InvalidStatusTransition
from src.main.modules.execution.domain.state_machine import validate_transition
# TODO: NodeStatus/WorkflowStatus don't exist in new system (only ExecutionStatus)
# Provide stubs to keep the old test logic syntactically valid (test logic not run).
from enum import Enum
class NodeStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    SKIPPED = "skipped"
    CLEANED_UP = "cleaned_up"
    FAILED = "failed"
class WorkflowStatus(str, Enum):
    DRAFT = "draft"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class TestWorkflowTransitions:
    def test_draft_to_running(self):
        validate_transition("workflow", WorkflowStatus.DRAFT, WorkflowStatus.RUNNING)

    def test_running_to_completed(self):
        validate_transition("workflow", WorkflowStatus.RUNNING, WorkflowStatus.COMPLETED)

    def test_running_to_failed(self):
        validate_transition("workflow", WorkflowStatus.RUNNING, WorkflowStatus.FAILED)

    def test_completed_to_draft(self):
        validate_transition("workflow", WorkflowStatus.COMPLETED, WorkflowStatus.DRAFT)

    def test_draft_to_completed_raises(self):
        with pytest.raises(InvalidStatusTransition):
            validate_transition("workflow", WorkflowStatus.DRAFT, WorkflowStatus.COMPLETED)

    def test_completed_to_running_raises(self):
        with pytest.raises(InvalidStatusTransition):
            validate_transition("workflow", WorkflowStatus.COMPLETED, WorkflowStatus.RUNNING)


class TestExecutionTransitions:
    def test_pending_to_running(self):
        validate_transition("execution", ExecutionStatus.PENDING, ExecutionStatus.RUNNING)

    def test_running_to_failed(self):
        validate_transition("execution", ExecutionStatus.RUNNING, ExecutionStatus.FAILED)

    def test_running_to_completed(self):
        validate_transition("execution", ExecutionStatus.RUNNING, ExecutionStatus.COMPLETED)

    def test_failed_to_failed_raises(self):
        with pytest.raises(InvalidStatusTransition):
            validate_transition("execution", ExecutionStatus.FAILED, ExecutionStatus.FAILED)

    def test_completed_is_terminal(self):
        with pytest.raises(InvalidStatusTransition):
            validate_transition("execution", ExecutionStatus.COMPLETED, ExecutionStatus.FAILED)


class TestNodeTransitions:
    def test_pending_to_running(self):
        validate_transition("node", NodeStatus.PENDING, NodeStatus.RUNNING)

    def test_pending_to_skipped(self):
        validate_transition("node", NodeStatus.PENDING, NodeStatus.SKIPPED)

    def test_running_to_completed(self):
        validate_transition("node", NodeStatus.RUNNING, NodeStatus.COMPLETED)

    def test_completed_to_cleaned_up(self):
        validate_transition("node", NodeStatus.COMPLETED, NodeStatus.CLEANED_UP)

    def test_skipped_is_terminal(self):
        with pytest.raises(InvalidStatusTransition):
            validate_transition("node", NodeStatus.SKIPPED, NodeStatus.RUNNING)


class TestInvalidDomain:
    def test_unknown_domain_raises(self):
        with pytest.raises(KeyError):
            validate_transition("unknown", "a", "b")
