"""MCP 工具目录快照。

``ToolCatalogSnapshot`` 是工具目录的不可变内存快照，供查询与过滤使用。
所有方法返回新 ``tuple``，不暴露内部可变状态。
"""

from __future__ import annotations

from dataclasses import dataclass

from src.main.infra.domain import AgentReference
from src.main.modules.mcp.domain.tool import Tool, ToolServer


@dataclass(frozen=True)
class ToolCatalogSnapshot:
    """工具目录不可变快照。

    Attributes:
        servers: 服务器列表。
    """

    servers: tuple[ToolServer, ...]

    def tools_matching(
        self,
        *,
        server: str | None = None,
        category: str | None = None,
    ) -> tuple[Tool, ...]:
        """按服务器名与/或分类筛选工具。

        Args:
            server: 可选服务器名过滤。
            category: 可选分类过滤。

        Returns:
            匹配的工具元组。
        """
        result: list[Tool] = []
        for srv in self.servers:
            if server is not None and srv.name != server:
                continue
            for tool in srv.tools:
                if category is not None and tool.category != category:
                    continue
                result.append(tool)
        return tuple(result)

    def get_tool(self, server: str, name: str) -> Tool | None:
        """按服务器名与工具名查找工具。

        Args:
            server: 服务器名。
            name: 工具名。

        Returns:
            命中的 ``Tool``，未命中时返回 ``None``。
        """
        for srv in self.servers:
            if srv.name != server:
                continue
            for tool in srv.tools:
                if tool.name == name:
                    return tool
        return None

    def list_allowed_for_agent(self, agent: AgentReference) -> tuple[Tool, ...]:
        """列出允许某 Agent 使用的工具。

        当前实现按 ``agent.name`` 决定白名单：以 agent 名称作为分类前缀
        匹配的工具即为该 agent 允许使用的工具。后续可按白名单配置扩展。

        Args:
            agent: Agent 引用。

        Returns:
            允许使用的工具元组。
        """
        prefix = agent.name
        return self.tools_matching(category=prefix)
