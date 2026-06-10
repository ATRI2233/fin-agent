"""Stateless graph operations on workflow DAG (nodes/edges as dicts)."""


def build_predecessors(edges: list[dict]) -> dict[str, list[str]]:
    """Build a {target: [source, ...]} predecessor map from a list of edges.

    Edges are dicts with ``source`` and ``target`` keys. Edges missing either
    key are silently skipped.
    """
    preds: dict[str, list[str]] = {}
    for edge in edges:
        source, target = edge.get("source"), edge.get("target")
        if source and target:
            preds.setdefault(target, []).append(source)
    return preds


def find_downstream(node_id: str, edges: list[dict]) -> list[str]:
    """Return all nodes reachable downstream from ``node_id`` via DFS.

    Uses a ``visited`` set so cycles are handled safely without infinite loops.
    Order is the DFS discovery order; the start node itself is not included.
    """
    downstream: list[str] = []
    visited: set[str] = set()

    def dfs(current: str) -> None:
        for edge in edges:
            if edge.get("source") == current:
                target = edge.get("target")
                if target and target not in visited:
                    visited.add(target)
                    downstream.append(target)
                    dfs(target)

    dfs(node_id)
    return downstream


def is_leaf(node_id: str, edges: list[dict]) -> bool:
    """Return True if ``node_id`` has no outgoing edges (terminal node)."""
    return not any(e.get("source") == node_id for e in edges)


def is_only_successor(node_id: str, pred_id: str, edges: list[dict]) -> bool:
    """Return True if ``node_id`` is the sole successor of ``pred_id``.

    Used to decide whether two nodes can share a session: when a predecessor
    fans out to multiple successors, each branch gets its own session.
    """
    successors = [e["target"] for e in edges if e.get("source") == pred_id]
    return len(successors) == 1
