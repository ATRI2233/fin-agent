"""MCP 模块对外公开接口。

定义 ToolCatalog Protocol,供 API 层读取 MCP 工具目录。
本文件**只定义 Protocol**,不引用任何实现细节。
"""

from __future__ import annotations

from typing import Protocol, TypedDict, runtime_checkable

from src.main.infra.domain import AgentReference


class ToolDescriptor(TypedDict):
    """工具描述符。

    Attributes:
        name: 工具名称。
        server: 所属 MCP server 名称。
        description: 工具功能描述。
        category: 工具分类。
    """

    name: str
    server: str
    description: str
    category: str


class ToolServerDescriptor(TypedDict):
    """MCP server 描述符。

    Attributes:
        name: server 名称。
        description: server 描述。
        enabled: 是否启用。
        tools: 该 server 暴露的工具列表。
    """

    name: str
    description: str
    enabled: bool
    tools: list[ToolDescriptor]


@runtime_checkable
class ToolCatalog(Protocol):
    """MCP 工具目录对外接口。

    提供工具列表、筛选、查询和重新加载能力。
    所有方法均为查询或缓存刷新,无副作用。

    标 @runtime_checkable 以支持 `isinstance(x, ToolCatalog)` 运行时检查,
    与同阶段 TASK-105 agent Protocol 保持一致(均加 @runtime_checkable)。
    """

    def list_tools(
        self, *, server: str | None = None, category: str | None = None
    ) -> list[ToolDescriptor]:
        """列出工具,可按 server 与 category 筛选。

        Args:
            server: 可选,按 server 名称精确筛选。
            category: 可选,按分类精确筛选。

        Returns:
            符合条件的工具描述符列表。
        """
        ...

    def list_servers(self) -> list[ToolServerDescriptor]:
        """列出所有 MCP server 及其工具。

        Returns:
            server 描述符列表。
        """
        ...

    def list_allowed_for_agent(self, agent: AgentReference) -> list[ToolDescriptor]:
        """列出指定 Agent 被授权使用的工具。

        Args:
            agent: Agent 引用。

        Returns:
            该 Agent 可调用的工具列表。
        """
        ...

    def get_tool(self, server: str, name: str) -> ToolDescriptor | None:
        """获取指定 server 下指定名称的工具。

        Args:
            server: MCP server 名称。
            name: 工具名称。

        Returns:
            工具描述符,不存在则返回 None。
        """
        ...

    def reload(self) -> None:
        """重新加载工具目录(重读 opencode.json)。

        清空内存快照并从配置文件重新解析。
        """
        ...