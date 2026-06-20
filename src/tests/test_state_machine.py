"""Tests for state_machine.py — transition validation and status constants."""

from __future__ import annotations

import pytest

# TASK-500: shim importer switched on 2026-06-19
from src.main.modules.execution.domain.execution_node import (
    ExecutionStatus,
    ExecutionNode,
)
from src.main.infra.errors import InvalidStateTransitionError as InvalidStatusTransition
from src.main.modules.execution.domain.state_machine import validate_transition

class TestWorkflowTransitions:
    def test_draft_to_running(self):
        validate_transition("exec-id", ExecutionStatus.PENDING, ExecutionStatus.RUNNING)

    def test_running_to_completed(self):
        validate_transition("exec-id", ExecutionStatus.RUNNING, ExecutionStatus.COMPLETED)

    def test_running_to_failed(self):
        validate_transition("exec-id", ExecutionStatus.RUNNING, ExecutionStatus.FAILED)

    def test_draft_to_completed_raises(self):
        with pytest.raises(InvalidStatusTransition):
            validate_transition("exec-id", ExecutionStatus.PENDING, ExecutionStatus.COMPLETED)

    def test_completed_to_running_raises(self):
        with pytest.raises(InvalidStatusTransition):
            validate_transition("exec-id", ExecutionStatus.COMPLETED, ExecutionStatus.RUNNING)


class TestExecutionTransitions:
    def test_pending_to_running(self):
        validate_transition("exec-id", ExecutionStatus.PENDING, ExecutionStatus.RUNNING)

    def test_running_to_failed(self):
        validate_transition("exec-id", ExecutionStatus.RUNNING, ExecutionStatus.FAILED)

    def test_running_to_completed(self):
        validate_transition("exec-id", ExecutionStatus.RUNNING, ExecutionStatus.COMPLETED)

    def test_failed_to_failed_raises(self):
        with pytest.raises(InvalidStatusTransition):
            validate_transition("exec-id", ExecutionStatus.FAILED, ExecutionStatus.FAILED)

    def test_completed_is_terminal(self):
        with pytest.raises(InvalidStatusTransition):
            validate_transition("exec-id", ExecutionStatus.COMPLETED, ExecutionStatus.FAILED)


class TestNodeTransitions:
    def test_pending_to_running(self):
        validate_transition("exec-id", ExecutionStatus.PENDING, ExecutionStatus.RUNNING)

    def test_pending_to_skipped(self):
        validate_transition("exec-id", ExecutionStatus.PENDING, ExecutionStatus.SKIPPED)

    def test_running_to_completed(self):
        validate_transition("exec-id", ExecutionStatus.RUNNING, ExecutionStatus.COMPLETED)

    def test_completed_to_cleaned_up(self):
        validate_transition("exec-id", ExecutionStatus.COMPLETED, ExecutionStatus.CLEANED_UP)

    def test_skipped_is_terminal(self):
        with pytest.raises(InvalidStatusTransition):
            validate_transition("exec-id", ExecutionStatus.SKIPPED, ExecutionStatus.RUNNING)

