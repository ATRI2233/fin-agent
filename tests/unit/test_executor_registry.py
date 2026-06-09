"""Unit tests for ``NodeExecutorRegistry`` (W4.6 / Task 14)."""

from __future__ import annotations

import pytest

from main.framework.core.workflow.node_executors.agent_executor import (
    AgentNodeExecutor,
)
from main.framework.core.workflow.node_executors.base import NodeExecutor
from main.framework.core.workflow.node_executors.debate_executor import (
    DebateNodeExecutor,
)
from main.framework.core.workflow.node_executors.input_executor import (
    InputNodeExecutor,
)
from main.framework.core.workflow.node_executors.output_executor import (
    OutputNodeExecutor,
)
from main.framework.core.workflow.node_executors.registry import (
    NodeExecutorRegistry,
    default_registry,
)


def test_registry_get_input() -> None:
    """``default_registry.get("input")`` returns an ``InputNodeExecutor`` instance."""
    executor = default_registry.get("input")

    assert isinstance(executor, NodeExecutor)
    assert isinstance(executor, InputNodeExecutor)
    # Pure input nodes have no dispatcher wired in.
    assert executor.dispatcher is None


def test_registry_get_unknown_falls_back_to_default() -> None:
    """An unknown node type resolves to the ``"default"`` executor (``AgentNodeExecutor``)."""
    result = default_registry.get("nonexistent")
    cls = default_registry.get_executor_class("nonexistent")

    assert cls is AgentNodeExecutor
    # The returned object is an AgentNodeExecutor instance (created via
    # ``__new__`` because the class requires a dispatcher — that's the
    # documented fallback for type-lookup purposes).
    assert isinstance(result, AgentNodeExecutor)
    assert type(result) is AgentNodeExecutor


def test_registry_register_custom_type() -> None:
    """``register()`` adds a new type; ``get()`` returns an instance of it."""
    reg = NodeExecutorRegistry()

    reg.register("custom", InputNodeExecutor)

    assert reg.get_executor_class("custom") is InputNodeExecutor
    instance = reg.get("custom")
    assert isinstance(instance, InputNodeExecutor)


def test_registry_get_executor_class() -> None:
    """``get_executor_class("debate")`` returns the ``DebateNodeExecutor`` class (not an instance)."""
    cls = default_registry.get_executor_class("debate")

    assert cls is DebateNodeExecutor
    # Must return the class itself, not an instance.
    assert isinstance(cls, type)


def test_registry_singleton_per_type() -> None:
    """Repeated ``get()`` calls return the same cached instance for a given type."""
    first = default_registry.get("output")
    second = default_registry.get("output")

    assert first is second
    assert isinstance(first, OutputNodeExecutor)


def test_registry_register_overrides_existing_type() -> None:
    """``register()`` with an existing key replaces the class and invalidates the cache."""
    reg = NodeExecutorRegistry()

    original = reg.get("input")
    assert isinstance(original, InputNodeExecutor)

    reg.register("input", OutputNodeExecutor)
    replaced = reg.get("input")

    assert isinstance(replaced, OutputNodeExecutor)
    # The cached instance must be discarded by register().
    assert replaced is not original


def test_registry_class_lookup_falls_back_to_default() -> None:
    """``get_executor_class`` of an unknown type also falls back to the default class."""
    cls = default_registry.get_executor_class("not-a-real-type")

    assert cls is AgentNodeExecutor


def test_registry_has_all_builtin_types() -> None:
    """The default registry exposes the four built-in node kinds."""
    assert default_registry.get_executor_class("input") is InputNodeExecutor
    assert default_registry.get_executor_class("output") is OutputNodeExecutor
    assert default_registry.get_executor_class("debate") is DebateNodeExecutor
    assert default_registry.get_executor_class("default") is AgentNodeExecutor
