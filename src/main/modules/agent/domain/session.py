"""Agent 会话值对象。

描述一次 Agent 会话的状态(标识、绑定 Agent、时间戳)。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from src.main.infra.domain import AgentReference, SessionId


@dataclass(frozen=True)
class Session:
    """Agent 会话值对象。

    Attributes:
        session_id: 会话唯一标识。
        agent: 会话绑定的 Agent 引用。
        created_at: 会话创建时间。
        last_used_at: 最近一次使用时间。
    """

    session_id: SessionId
    agent: AgentReference
    created_at: datetime
    last_used_at: datetime
