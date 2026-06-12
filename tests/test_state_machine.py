"""Tests for state_machine.py — transition validation and status constants."""

from __future__ import annotations

import pytest

from main.framework.core.state_machine import (
    ExecutionStatus,
    InvalidStatusTransition,
    NodeStatus,
    WorkflowStatus,
    validate_transition,
)


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
