"""文件系统 Agent 定义仓库。

从 .opencode/agents/*.md 目录读取 Agent 定义。
"""

from __future__ import annotations

from src.main.infra.errors import AgentNotFoundError
from src.main.infra.settings import Settings
from src.main.modules.agent.domain.agent_definition import AgentDefinition


class FileSystemAgentDefinitionRepository:
    """文件系统 Agent 定义仓库。

    通过 Settings.OPENCODE_AGENTS_DIR 定位 Agent 定义目录,
    提供按名称获取和列表查询能力。
    """

    def __init__(self, settings: Settings) -> None:
        """初始化仓库。

        Args:
            settings: 全局配置实例。
        """
        self.settings = settings

    def get(self, name: str) -> AgentDefinition:
        """按名称获取 Agent 定义。

        拼装路径 settings.OPENCODE_AGENTS_DIR / f"{name}.md"。
        文件不存在时抛出 AgentNotFoundError。

        Args:
            name: Agent 名称。

        Returns:
            AgentDefinition 实例。

        Raises:
            AgentNotFoundError: 对应 .md 文件不存在时。
        """
        path = self.settings.OPENCODE_AGENTS_DIR / f"{name}.md"
        if not path.is_file():
            raise AgentNotFoundError(f"agent not found: {name}")
        return AgentDefinition.from_path(path)

    def list_all(self) -> list[AgentDefinition]:
        """列出目录下所有 Agent 定义。

        glob *.md 后按 name 排序返回。

        Returns:
            AgentDefinition 列表(按 name 升序)。
        """
        return sorted(
            [AgentDefinition.from_path(p) for p in self.settings.OPENCODE_AGENTS_DIR.glob("*.md")],
            key=lambda d: d.name,
        )
