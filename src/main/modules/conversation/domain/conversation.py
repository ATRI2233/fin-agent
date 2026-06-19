"""Conversation 聚合根。

定义对话会话领域实体，与持久化层解耦（具体 ORM 映射在 TASK-403 落地）。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from src.main.infra.domain import AgentReference, ConversationId


@dataclass
class Conversation:
    """对话会话聚合根。

    Attributes:
        id: 会话唯一标识。
        agent: 关联的 Agent 引用，标识该会话归属哪个 Agent。
        title: 可选会话标题，由用户或系统设定。
        created_at: 创建时间。
        updated_at: 最近更新时间（消息追加或元数据变更时刷新）。
    """

    id: ConversationId
    agent: AgentReference
    title: str | None
    created_at: datetime
    updated_at: datetime