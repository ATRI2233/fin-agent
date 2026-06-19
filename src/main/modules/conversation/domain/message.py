"""Message 聚合根与 MessageRole 枚举。

定义对话消息领域实体及消息角色枚举。
Message.id 使用 forward ref "MessageId"，等待 TASK-002 后续在
src/main.infra.domain 中落地 MessageId 后回填为 NewType 引用。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum

from src.main.infra.domain import ConversationId


class MessageRole(str, Enum):
    """消息角色枚举。

    继承 str 以便与现有 JSON/字符串接口直接互通，
    ``.value`` 返回 ``"user" / "assistant" / "system"``。
    """

    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


@dataclass
class Message:
    """对话消息实体。

    Attributes:
        id: 消息唯一标识，类型为 ``MessageId``（TODO: infra.domain 尚未导出，
            当前以 forward ref 字符串占位，TASK-002 补齐后切换为 NewType 引用）。
        conversation_id: 所属会话 ID。
        role: 消息角色（user / assistant / system）。
        content: 消息正文。
        created_at: 创建时间。
    """

    # TODO: 切换为 `MessageId`（infra.domain NewType）— 待 TASK-002 落地
    id: "MessageId"
    conversation_id: ConversationId
    role: MessageRole
    content: str
    created_at: datetime