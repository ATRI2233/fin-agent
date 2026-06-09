"""Workflow DAG parser for validation and analysis."""

from collections import defaultdict, deque
from typing import Any

NodeId = str
Node = dict[str, Any]
Edge = dict[str, str]


def validate_dag(nodes: list[Node], edges: list[Edge]) -> bool:
    """Detect cycles using DFS. Returns False if cycle found, True if valid DAG."""
    if len(nodes) > 50:
        raise ValueError("Workflow cannot have more than 50 nodes")

    # Validate input/output node constraints
    node_map: dict[NodeId, Node] = {n["id"]: n for n in nodes}
    targets_of: set[NodeId] = {e["target"] for e in edges}
    sources_of: set[NodeId] = {e["source"] for e in edges}

    for node in nodes:
        ntype = node.get("type", "agent")
        nid = node["id"]
        if ntype == "input" and nid in targets_of:
            raise ValueError(f"Input node '{nid}' cannot have incoming edges")
        if ntype == "output" and nid in sources_of:
            raise ValueError(f"Output node '{nid}' cannot have outgoing edges")

    if not edges:
        return True

    # Build adjacency list
    adj: dict[NodeId, list[NodeId]] = defaultdict(list)
    for edge in edges:
        adj[edge["source"]].append(edge["target"])

    # DFS-based cycle detection
    state: dict[NodeId, str] = defaultdict(lambda: "white")  # "white", "gray", "black"

    def dfs(node_id: NodeId) -> bool:
        """Returns True if cycle detected."""
        state[node_id] = "gray"
        for neighbor in adj.get(node_id, []):
            if state[neighbor] == "gray":
                return False  # Back edge = cycle
            if state[neighbor] == "white" and not dfs(neighbor):
                return False
        state[node_id] = "black"
        return True

    # Run DFS from all nodes
    node_ids = {edge["source"] for edge in edges} | {edge["target"] for edge in edges}
    for node_id in node_ids:
        if state[node_id] == "white":
            if not dfs(node_id):
                return False
    return True


def topological_sort(nodes: list[Node], edges: list[Edge]) -> list[NodeId]:
    """Kahn's algorithm for execution order. Returns ordered list of node IDs."""
    if not edges:
        return [n["id"] for n in nodes] if nodes else []

    # Build adjacency and in-degree
    adj: dict[NodeId, list[NodeId]] = defaultdict(list)
    in_degree: dict[NodeId, int] = defaultdict(int)
    node_ids = set()

    for edge in edges:
        source, target = edge["source"], edge["target"]
        adj[source].append(target)
        in_degree[target] += 1
        node_ids.add(source)
        node_ids.add(target)

    # Initialize queue with nodes that have no incoming edges
    queue = deque([nid for nid in node_ids if in_degree[nid] == 0])
    result: list[NodeId] = []

    while queue:
        node_id = queue.popleft()
        result.append(node_id)
        for neighbor in adj[node_id]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    # If result doesn't contain all nodes, there's a cycle
    if len(result) != len(node_ids):
        return []
    return result


def identify_parallel_branches(
    nodes: list[Node], edges: list[Edge]
) -> dict[NodeId, list[NodeId]]:
    """Find nodes with multiple outgoing edges (parallel branch points)."""
    # Build out-degree map
    out_degree: dict[NodeId, int] = defaultdict(int)
    targets_map: dict[NodeId, list[NodeId]] = defaultdict(list)

    for edge in edges:
        out_degree[edge["source"]] += 1
        targets_map[edge["source"]].append(edge["target"])

    result = {
        node_id: targets
        for node_id, targets in targets_map.items()
        if out_degree[node_id] > 1
    }

    # Validate parallel branch count
    for node_id, targets in result.items():
        if len(targets) > 10:
            raise ValueError("Cannot have more than 10 parallel agents")

    return result


def identify_serial_chains(nodes: list[Node], edges: list[Edge]) -> list[list[NodeId]]:
    """Find linear chains (serial paths) in the graph."""
    if not edges:
        return []

    # Build adjacency and reverse adjacency
    adj: dict[NodeId, list[NodeId]] = defaultdict(list)
    in_degree: dict[NodeId, int] = defaultdict(int)

    for edge in edges:
        adj[edge["source"]].append(edge["target"])
        in_degree[edge["target"]] += 1

    node_ids = {edge["source"] for edge in edges} | {edge["target"] for edge in edges}

    # Find all chain starts (nodes with in_degree == 0 or single predecessor chain)
    chains: list[list[NodeId]] = []
    visited: set[NodeId] = set()

    for node_id in node_ids:
        if node_id in visited:
            continue
        if in_degree[node_id] == 0:
            # Start of a potential chain
            chain: list[NodeId] = []
            current = node_id
            while current is not None and current not in visited:
                chain.append(current)
                visited.add(current)
                # Follow the single path
                if len(adj[current]) == 1 and in_degree[adj[current][0]] == 1:
                    current = adj[current][0]
                else:
                    current = None
            if len(chain) > 1:
                chains.append(chain)

    return chains


def identify_debate_blocks(nodes: list[Node]) -> list[Node]:
    """Find nodes with type='debate'."""
    return [node for node in nodes if node.get("type") == "debate"]
