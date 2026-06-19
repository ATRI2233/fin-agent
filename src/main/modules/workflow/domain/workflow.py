"""Workflow domain - Workflow aggregate root.

定义工作流聚合根,包含节点、边、触发器类型与运行时配置。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from src.main.infra.domain import WorkflowId

from src.main.modules.workflow.domain.edge import Edge
from src.main.modules.workflow.domain.node import Node


@dataclass
class Workflow:
    """工作流聚合根。

    Attributes:
        id: 工作流唯一标识 (WorkflowId)。
        name: 工作流可读名称。
        nodes: 节点列表 (DAG 顶点)。
        edges: 边列表 (DAG 有向边)。
        trigger_type: 触发类型 (e.g. "manual" / "scheduled" / "event")。
        config: 运行时配置字典 (调度 cron、超时、重试等)。
        status: 工作流状态字符串 (e.g. "draft" / "active" / "archived")。
    """

    id: WorkflowId
    name: str
    nodes: list[Node] = field(default_factory=list)
    edges: list[Edge] = field(default_factory=list)
    trigger_type: str = "manual"
    config: dict = field(default_factory=dict)
    status: str = "draft"