"""Agent 定义值对象。

描述从 .opencode/agents/*.md 加载的 Agent 系统提示与元数据。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AgentDefinition:
    """Agent 定义值对象。

    Attributes:
        name: Agent 名称(对应 .md 文件 stem)。
        path: 源 .md 文件路径。
        system_prompt: 解析后的系统提示文本(已 strip)。
    """

    name: str
    path: Path
    system_prompt: str

    @classmethod
    def from_path(cls, path: Path) -> AgentDefinition:
        """从 .md 文件路径构造 AgentDefinition。

        读取文件内容,strip 空白后作为 system_prompt。
        文件名 stem 作为 name。

        Args:
            path: .md 文件路径。

        Returns:
            AgentDefinition 实例。
        """
        text = path.read_text(encoding="utf-8")
        return cls(name=path.stem, path=path, system_prompt=text.strip())
