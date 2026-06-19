"""对话管理模块对外公开接口。

定义 ConversationService Protocol,供 API 层调用对话服务。
本文件**只定义 Protocol**,不引用任何实现细节。
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from src.main.infra.domain import AgentReference, ConversationId


@runtime_checkable
class ConversationService(Protocol):
    """对话服务对外接口。

    提供会话的创建、列表、查询、消息追加与消息查询能力。
    所有方法均为异步,以适配异步数据库访问层。

    标 @runtime_checkable 以支持 `isinstance(x, ConversationService)` 运行时检查,
    与同阶段 MCP 协议模块保持一致(均加 @runtime_checkable)。

    ``append_message`` 的 ``role`` 参数使用字符串 forward ref ``"MessageRole"``,
    避免 Protocol 与 domain.MessageRole 之间的循环依赖。
    """

    async def create(
        self, agent: AgentReference, title: str | None
    ) -> "Conversation":
        """创建新会话。

        Args:
            agent: Agent 引用,标识会话归属的 Agent。
            title: 可选会话标题。

        Returns:
            新建的 Conversation 实体。
        """
        ...

    async def list(self, *, limit: int, offset: int) -> list["Conversation"]:
        """分页列出会话。

        Args:
            limit: 返回数量上限。
            offset: 分页偏移量。

        Returns:
            会话列表。
        """
        ...

    async def get(self, conversation_id: ConversationId) -> "Conversation | None":
        """获取指定会话。

        Args:
            conversation_id: 会话 ID。

        Returns:
            会话实体,不存在则返回 None。
        """
        ...

    async def append_message(
        self,
        conversation_id: ConversationId,
        role: "MessageRole",
        content: str,
    ) -> "Message":
        """向指定会话追加一条消息。

        Args:
            conversation_id: 目标会话 ID。
            role: 消息角色(字符串 forward ref,引用 domain.MessageRole)。
            content: 消息内容。

        Returns:
            追加的 Message 实体。
        """
        ...

    async def get_messages(
        self,
        conversation_id: ConversationId,
        *,
        limit: int,
        offset: int,
    ) -> list["Message"]:
        """分页获取指定会话的消息列表。

        Args:
            conversation_id: 目标会话 ID。
            limit: 返回数量上限。
            offset: 分页偏移量。

        Returns:
            消息列表。
        """
        ...