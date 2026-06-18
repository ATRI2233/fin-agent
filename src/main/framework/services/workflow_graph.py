"""Shim: re-export for backward compatibility. Canonical location: main.framework.services.patterns.workflow_graph"""

from main.framework.services.patterns.workflow_graph import ( # noqa: F401
    build_predecessors,
    find_downstream,
    is_leaf,
    is_only_successor,
)
