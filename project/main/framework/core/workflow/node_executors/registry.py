"""Node executor registry — maps node type strings to executor classes/instances. Singleton per type."""

from __future__ import annotations

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


class NodeExecutorRegistry:
    """Resolves node-type strings to ``NodeExecutor`` classes/instances.

    Defaults cover the four node kinds the workflow engine recognises:
    ``input``, ``output``, ``debate`` and a catch-all ``default`` mapped to
    the regular agent executor. ``get()`` returns a lazily-instantiated,
    cached singleton per type; ``get_executor_class()`` is for callers that
    need the class itself (e.g. to inject dependencies before use).
    """

    def __init__(self) -> None:
        # Class-level mappings (not yet instantiated) for the four built-in
        # node kinds. The "default" entry is the fallback for any unknown
        # node type and points at AgentNodeExecutor.
        self._classes: dict[str, type[NodeExecutor]] = {
            "input": InputNodeExecutor,
            "output": OutputNodeExecutor,
            "debate": DebateNodeExecutor,
            "default": AgentNodeExecutor,
        }
        # Lazy-instantiated singletons: one instance per node type.
        self._instances: dict[str, NodeExecutor] = {}

    def register(self, node_type: str, executor_cls: type[NodeExecutor]) -> None:
        """Add or override the executor class mapped to ``node_type``.

        Any cached singleton for this type is discarded so the next
        ``get()`` re-instantiates the new class.
        """
        self._classes[node_type] = executor_cls
        self._instances.pop(node_type, None)

    def get(self, node_type: str) -> NodeExecutor:
        """Return the cached singleton instance for ``node_type``.

        Falls back to the ``"default"`` mapping when ``node_type`` is not
        registered. Instances are created with no-args; classes that
        require constructor arguments (e.g. ``AgentNodeExecutor`` needs a
        dispatcher) get a bare instance via ``__new__`` so type-lookup
        still works — callers that need a fully-initialized executor
        should use :meth:`get_executor_class` and inject dependencies
        themselves.
        """
        cached = self._instances.get(node_type)
        if cached is not None:
            return cached

        cls = self.get_executor_class(node_type)
        try:
            instance = cls()
        except TypeError:
            # Class cannot be constructed with no args; return a bare
            # instance so isinstance/registration lookups still succeed.
            instance = cls.__new__(cls)
        self._instances[node_type] = instance
        return instance

    def get_executor_class(self, node_type: str) -> type[NodeExecutor]:
        """Return the executor class for ``node_type``, or the ``"default"`` class.

        Raises ``KeyError`` if neither ``node_type`` nor ``"default"`` is
        registered (should not happen for a properly-constructed registry).
        """
        if node_type in self._classes:
            return self._classes[node_type]
        if "default" in self._classes:
            return self._classes["default"]
        raise KeyError(f"No executor registered for node type: {node_type!r}")


default_registry = NodeExecutorRegistry()
