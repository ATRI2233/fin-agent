"""Workflow domain - Edge value object (immutable DAG connection)."""

from __future__ import annotations

from dataclasses import dataclass

from src.main.infra.domain import NodeId


@dataclass(frozen=True)
class Edge:
    """工作流有向边 (不可变值对象)。

    表示一条从 source 节点指向 target 节点的有向边,
    在 DAG 中即"数据/控制流"的传递方向。

    使用 ``frozen=True`` 保证边一旦创建不可修改 — 边的变化应通过
    替换整个 Edge 实例表达,而非原地修改 (符合值对象语义)。

    Attributes:
        source: 源节点 ID。
        target: 目标节点 ID。
    """

    source: NodeId
    target: NodeId