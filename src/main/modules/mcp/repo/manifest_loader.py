"""Opencode manifest loader.

解析 ``.opencode/opencode.json``,构造不可变 ``ToolCatalogSnapshot``。
所有配置读取走 ``Settings``,异常通过 ``ConfigError`` 抛出。
"""

from __future__ import annotations

import json
from pathlib import Path

from src.main.infra.domain import AgentReference
from src.main.infra.errors import ConfigError
from src.main.infra.settings import Settings
from src.main.modules.mcp.domain.catalog import ToolCatalogSnapshot
from src.main.modules.mcp.domain.tool import Tool, ToolServer


class OpencodeManifestLoader:
    """加载并解析 opencode.json,生成 ToolCatalogSnapshot。

    Attributes:
        settings: 全局配置实例。
    """

    def __init__(self, settings: Settings) -> None:
        """初始化 loader。

        Args:
            settings: 配置实例。
        """
        self.settings = settings
        self._snapshot: ToolCatalogSnapshot | None = None
        self._agent_allowlist: dict[str, frozenset[str]] = {}

    def _parse_tool(self, server_name: str, tool_dict: dict) -> Tool:
        """解析单个 tool 字典为 Tool 值对象。

        Args:
            server_name: 所属服务器名称。
            tool_dict: 工具原始字典,含 name/description/category 字段。

        Returns:
            不可变 Tool 实例。
        """
        name = tool_dict["name"]
        description = tool_dict.get("description", "")
        category = tool_dict.get("category", "")
        return Tool(
            name=name,
            server=server_name,
            description=description,
            category=category,
        )

    def _parse_server(self, name: str, server_dict: dict) -> ToolServer:
        """解析单个 MCP server 节点为 ToolServer 值对象。

        Args:
            name: 服务器名称。
            server_dict: 服务器原始字典,含 command/description/enabled/tools 字段。

        Returns:
            不可变 ToolServer 实例。
        """
        command = server_dict.get("command", [])
        description = server_dict.get("description", "")
        enabled = server_dict.get("enabled", True)
        tools_raw = server_dict.get("tools", [])
        tools = tuple(
            self._parse_tool(name, tool_dict) for tool_dict in tools_raw
        )
        return ToolServer(
            name=name,
            description=description,
            enabled=enabled,
            command=tuple(command),
            tools=tools,
        )

    def _parse_agent_allowlist(
        self, config_dict: dict
    ) -> dict[str, frozenset[str]]:
        """解析 agent.*.tools 白名单为 dict[agent_name, frozenset[tool_full_name]]。

        Args:
            config_dict: opencode.json 顶层字典。

        Returns:
            agent 名称到允许工具全名集合的映射。
        """
        agent_section = config_dict.get("agent", {})
        result: dict[str, frozenset[str]] = {}
        for agent_name, agent_dict in agent_section.items():
            tools_allowlist = agent_dict.get("tools", {})
            allowed: set[str] = set()
            for tool_full_name, flag in tools_allowlist.items():
                if flag is True:
                    allowed.add(tool_full_name)
            result[agent_name] = frozenset(allowed)
        return result

    def load(self) -> ToolCatalogSnapshot:
        """读取并解析 opencode.json,生成快照。

        Returns:
            不可变 ToolCatalogSnapshot 实例。

        Raises:
            ConfigError: 配置文件不存在或 JSON 解析失败。
        """
        config_path: Path = self.settings.OPENCODE_MCP_CONFIG
        try:
            raw_text = config_path.read_text(encoding="utf-8")
        except FileNotFoundError as exc:
            raise ConfigError(
                f"Opencode manifest not found: {config_path}",
                details={"path": str(config_path)},
                cause=exc,
            ) from exc
        try:
            config_dict = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise ConfigError(
                f"Invalid JSON in opencode manifest: {config_path}",
                details={"path": str(config_path), "line": exc.lineno},
                cause=exc,
            ) from exc

        mcp_section = config_dict.get("mcp", {})
        servers = tuple(
            self._parse_server(server_name, server_dict)
            for server_name, server_dict in mcp_section.items()
        )
        snapshot = ToolCatalogSnapshot(servers=servers)
        self._snapshot = snapshot
        self._agent_allowlist = self._parse_agent_allowlist(config_dict)
        return snapshot

    def reload(self) -> ToolCatalogSnapshot:
        """清空缓存并重新加载。

        Returns:
            新生成的不可变 ToolCatalogSnapshot 实例。
        """
        self._snapshot = None
        return self.load()

    def get_agent_allowlist(self, agent: AgentReference) -> list[str]:
        """Return the list of tool full-names allowed for the given agent.

        Args:
            agent: Agent 引用。

        Returns:
            该 Agent 允许使用的工具全名列表（已排序）。
        """
        return sorted(self._agent_allowlist.get(agent.name, frozenset()))