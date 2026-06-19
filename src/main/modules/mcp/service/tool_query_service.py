"""MCP 工具查询服务。

实现 ``ToolCatalog`` Protocol,作为 mcp 模块对外服务的唯一入口。
底层数据来自 ``OpencodeManifestLoader`` 生成的 ``ToolCatalogSnapshot``。
"""

from __future__ import annotations

from src.main.infra.domain import AgentReference
from src.main.modules.mcp.domain.tool import Tool, ToolServer
from src.main.modules.mcp.protocol import (
    ToolCatalog,
    ToolDescriptor,
    ToolServerDescriptor,
)
from src.main.modules.mcp.repo.manifest_loader import OpencodeManifestLoader


class OpencodeJsonToolCatalog:
    """基于 opencode.json 的 ToolCatalog 实现。

    Attributes:
        loader: opencode 清单加载器。
    """

    def __init__(self, loader: OpencodeManifestLoader) -> None:
        """初始化目录实例。

        Args:
            loader: opencode 清单加载器。
        """
        self.loader = loader
        self._snapshot = loader.load()

    @staticmethod
    def _tool_to_descriptor(tool: Tool) -> ToolDescriptor:
        """将 Tool 值对象转为 ToolDescriptor。

        Args:
            tool: 工具值对象。

        Returns:
            工具描述符字典。
        """
        return ToolDescriptor(
            name=tool.name,
            server=tool.server,
            description=tool.description,
            category=tool.category,
        )

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
        tools = self._snapshot.tools_matching(server=server, category=category)
        return [self._tool_to_descriptor(t) for t in tools]

    def list_servers(self) -> list[ToolServerDescriptor]:
        """列出所有 MCP server 及其工具。

        Returns:
            server 描述符列表。
        """
        result: list[ToolServerDescriptor] = []
        for srv in self._snapshot.servers:
            tools = [self._tool_to_descriptor(t) for t in srv.tools]
            result.append(
                ToolServerDescriptor(
                    name=srv.name,
                    description=srv.description,
                    enabled=srv.enabled,
                    tools=tools,
                )
            )
        return result

    def list_allowed_for_agent(self, agent: AgentReference) -> list[ToolDescriptor]:
        """列出指定 Agent 被授权使用的工具。

        通过 loader 的公开 ``get_agent_allowlist`` 获取工具全名白名单,
        再在 snapshot 中查找对应的 ToolDescriptor。
        全名格式为 ``{server}_{tool_name}``(与 opencode.json 白名单键一致)。

        Args:
            agent: Agent 引用。

        Returns:
            该 Agent 可调用的工具描述符列表。
        """
        allowed_names = set(self.loader.get_agent_allowlist(agent))
        if not allowed_names:
            return []
        result: list[ToolDescriptor] = []
        for srv in self._snapshot.servers:
            for tool in srv.tools:
                full_name = f"{srv.name}_{tool.name}"
                if full_name in allowed_names:
                    result.append(self._tool_to_descriptor(tool))
        return result

    def get_tool(self, server: str, name: str) -> ToolDescriptor | None:
        """获取指定 server 下指定名称的工具。

        Args:
            server: MCP server 名称。
            name: 工具名称。

        Returns:
            工具描述符,不存在则返回 None。
        """
        tool = self._snapshot.get_tool(server, name)
        if tool is None:
            return None
        return self._tool_to_descriptor(tool)

    def reload(self) -> None:
        """重新加载工具目录(重读 opencode.json)。

        清空内存快照并从配置文件重新解析。
        """
        self._snapshot = self.loader.reload()