"""InMemorySessionManager: conversation_id ↔ session_id 双向绑定。"""

from __future__ import annotations

import asyncio

from src.main.infra.domain import ConversationId, SessionId
from src.main.modules.agent.protocol import SessionManager


class InMemorySessionManager(SessionManager):
    """内存版 SessionManager,用于单进程 FastAPI 部署。

    Attributes:
        _map: conversation_id → session_id 的实例属性 dict。
        _lock: 保护 _map 并发访问的锁。
    """

    def __init__(self) -> None:
        """初始化空的绑定映射和锁。"""
        self._map: dict[ConversationId, SessionId] = {}
        self._lock: asyncio.Lock = asyncio.Lock()

    async def bind(
        self,
        conversation_id: ConversationId,
        session_id: SessionId,
    ) -> None:
        """绑定 ``conversation_id`` 到 ``session_id``(后者覆盖前者)。

        Args:
            conversation_id: 会话 ID。
            session_id: opencode session ID。
        """
        async with self._lock:
            self._map[conversation_id] = session_id

    async def lookup(
        self,
        conversation_id: ConversationId,
    ) -> SessionId | None:
        """查询 ``conversation_id`` 对应的 ``session_id``。

        Args:
            conversation_id: 会话 ID。

        Returns:
            对应的 ``SessionId``;若无绑定返回 ``None``。
        """
        async with self._lock:
            return self._map.get(conversation_id)

    async def unbind(self, conversation_id: ConversationId) -> None:
        """解除 ``conversation_id`` 的绑定(供 cleanup 使用)。

        Args:
            conversation_id: 会话 ID。
        """
        async with self._lock:
            self._map.pop(conversation_id, None)