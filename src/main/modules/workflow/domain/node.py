"""Workflow domain - Node value object and NodeType enum.

Defines the unit of a DAG: a typed node (INPUT / OUTPUT / AGENT / DEBATE)
with its associated data and optional Agent reference and prompt template.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from src.main.infra.domain import AgentReference, NodeId


class NodeType(str, Enum):
    """Node 类型枚举,对应 React Flow 编辑器中的 4 种节点类型。

    字符串值与设计文档一致:
    - "input":  入参节点 (用户提供输入或触发数据)
    - "output": 出参节点 (汇聚结果)
    - "agent":  Agent 执行节点 (调用单个 Agent)
    - "debate": 辩论节点 (多 Agent 辩论 / 冲突解决)
    """

    INPUT = "input"
    OUTPUT = "output"
    AGENT = "agent"
    DEBATE = "debate"


@dataclass
class Node:
    """工作流节点值对象。

    Attributes:
        id: 节点唯一标识 (NodeId, 字符串 NewType)。
        type: 节点类型枚举值。
        data: 原始 React Flow 节点数据 (保留前端 payload 以便回写)。
        agent: Agent 引用 (仅 AGENT/DEBATE 节点非 None;INPUT/OUTPUT 为 None)。
        prompt: 提示词模板字符串 (可由前端编辑,可为 None)。
    """

    id: NodeId
    type: NodeType
    data: dict = field(default_factory=dict)
    agent: AgentReference | None = None
    prompt: str | None = None