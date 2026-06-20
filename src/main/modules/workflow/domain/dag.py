"""Workflow domain - DAG pure functions.

提供 6 个 DAG 工具函数,全部为纯函数 — 只接收 ``edges: list[Edge]``
(必要时接收 ``nodes`` 用于参考),**不**接收 ``Workflow`` 聚合根。
调用方负责传入 ``workflow.edges`` / ``workflow.nodes``。

设计约束 (Do Not #纯函数契约):
- 禁止 import ``Workflow`` 类型 — 会形成 domain 层循环依赖,且破坏纯函数语义
- 所有函数无副作用,无状态,可独立测试
"""

from __future__ import annotations

import logging
from collections import deque

from src.main.infra.domain import NodeId

from src.main.modules.workflow.domain.edge import Edge
from src.main.modules.workflow.domain.node import Node

logger = logging.getLogger(__name__)


def topological_sort(
    nodes: list[Node], edges: list[Edge]
) -> list[NodeId]:
    """Kahn 拓扑排序。

    计算节点列表的拓扑序;若检测到环 (cycle),返回空列表。

    Args:
        nodes: 工作流节点列表 (用于确定全集,即使无入边的孤立节点也应出现在结果中)。
        edges: 工作流有向边列表。

    Returns:
        拓扑序节点 ID 列表;若存在环则返回 ``[]``。
    """
    # 入度表
    in_degree: dict[NodeId, int] = {node.id: 0 for node in nodes}
    # 邻接表
    adj: dict[NodeId, list[NodeId]] = {node.id: [] for node in nodes}

    for edge in edges:
        if edge.source not in in_degree:
            logger.warning(
                "Edge source %s not in nodes list, adding implicitly", edge.source
            )
            in_degree[edge.source] = 0
            adj[edge.source] = []
        if edge.target not in in_degree:
            logger.warning(
                "Edge target %s not in nodes list, adding implicitly", edge.target
            )
            in_degree[edge.target] = 0
            adj[edge.target] = []
        in_degree[edge.target] += 1
        adj[edge.source].append(edge.target)

    # 起点: 入度为 0 的节点
    queue: deque[NodeId] = deque(
        [nid for nid, deg in in_degree.items() if deg == 0]
    )
    result: list[NodeId] = []

    while queue:
        nid = queue.popleft()
        result.append(nid)
        for nxt in adj[nid]:
            in_degree[nxt] -= 1
            if in_degree[nxt] == 0:
                queue.append(nxt)

    # 若有节点未被输出 -> 存在环
    if len(result) != len(in_degree):
        return []
    return result


def identify_parallel_branches(
    nodes: list[Node], edges: list[Edge]
) -> dict[NodeId, list[NodeId]]:
    """识别并行分支 — 同一 level 中共享同一前驱集合的兄弟节点分组。

    实现思路:
    1. 计算拓扑序;
    2. 按 BFS level 分层 (同一层的节点互为兄弟);
    3. 返回 ``{前驱代表节点: [该层所有节点]}``。

    Args:
        nodes: 工作流节点列表。
        edges: 工作流有向边列表。

    Returns:
        字典: key 为该层代表节点 ID,value 为该层所有节点 ID 列表 (按拓扑序)。
    """
    topo = topological_sort(nodes, edges)
    if not topo:
        return {}

    # 计算每个节点的入度 — 使用 topological_sort 的节点集(一致的全量节点)
    # Bug 21: 之前用 {node.id: 0 for node in nodes} 与 topological_sort
    # 不一致(拓扑排序内部会从 edges 静默添加 nodes 之外的节点)。
    in_degree: dict[NodeId, int] = {nid: 0 for nid in topo}
    for edge in edges:
        if edge.target in in_degree:
            in_degree[edge.target] += 1

    # BFS 按 level 分层
    levels: list[list[NodeId]] = []
    current_level: list[NodeId] = [
        nid for nid in topo if in_degree.get(nid, 0) == 0
    ]
    visited: set[NodeId] = set(current_level)

    while current_level:
        levels.append(current_level)
        next_level: list[NodeId] = []
        for nid in current_level:
            for edge in edges:
                if edge.source == nid and edge.target not in visited:
                    visited.add(edge.target)
                    next_level.append(edge.target)
        # 保持拓扑序
        next_level.sort(key=lambda x: topo.index(x))
        current_level = next_level

    # 构造返回值: 每层第一个节点作为 key,该层全部节点作为 value
    result: dict[NodeId, list[NodeId]] = {}
    for level in levels:
        if level:
            result[level[0]] = level
    return result


def build_predecessors(edges: list[Edge]) -> dict[NodeId, list[NodeId]]:
    """构建前驱映射表。

    返回 ``{节点 ID: [其所有直接前驱节点 ID]}``。出现在 edges 中
    的所有节点都会作为 key (即使其前驱列表为空)。

    Args:
        edges: 工作流有向边列表。

    Returns:
        前驱映射字典。
    """
    predecessors: dict[NodeId, list[NodeId]] = {}
    for edge in edges:
        predecessors.setdefault(edge.source, [])
        predecessors.setdefault(edge.target, []).append(edge.source)
    return predecessors


def find_downstream(node_id: NodeId, edges: list[Edge]) -> list[NodeId]:
    """查找 node_id 的所有直接下游节点 (出边的 target)。

    Args:
        node_id: 源节点 ID。
        edges: 工作流有向边列表。

    Returns:
        node_id 的所有直接下游节点 ID 列表 (保持 edges 中的出现顺序)。
    """
    return [edge.target for edge in edges if edge.source == node_id]


def is_leaf(node_id: NodeId, edges: list[Edge]) -> bool:
    """判断节点是否为叶子节点 (无任何出边)。

    Args:
        node_id: 候选节点 ID。
        edges: 工作流有向边列表。

    Returns:
        若 node_id 不作为任何边的 source 则为 True,否则 False。
    """
    return not any(edge.source == node_id for edge in edges)


def is_only_successor(
    node_id: NodeId, pred_id: NodeId, edges: list[Edge]
) -> bool:
    """判断 ``node_id`` 是否是 ``pred_id`` 的唯一直接后继。

    用于识别"串行链":若 pred_id 只有一条出边指向 node_id,
    且 node_id 也只有 pred_id 这一个前驱,则两节点构成纯串行链段。

    Args:
        node_id: 候选后继节点 ID。
        pred_id: 候选前驱节点 ID。
        edges: 工作流有向边列表。

    Returns:
        若 pred_id → node_id 是唯一出边且 node_id 的唯一入边来自 pred_id 则 True。
    """
    # pred_id -> node_id 是否是 pred_id 的唯一出边
    pred_outgoing = [e for e in edges if e.source == pred_id]
    if len(pred_outgoing) != 1:
        return False
    if pred_outgoing[0].target != node_id:
        return False

    # node_id 的唯一入边是否来自 pred_id
    node_incoming = [e for e in edges if e.target == node_id]
    if len(node_incoming) != 1:
        return False
    return node_incoming[0].source == pred_id