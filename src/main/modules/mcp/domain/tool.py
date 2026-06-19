"""MCP 工具与服务器值对象。

定义 ``Tool`` 与 ``ToolServer`` 两个不可变值对象。所有容器字段
必须为 ``tuple`` 以满足 ``frozen=True`` 的不可变性约束。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Tool:
    """MCP 工具值对象。

    Attributes:
        name: 工具名称（在同一服务器内唯一）。
        server: 所属服务器名称。
        description: 工具描述。
        category: 工具分类（如 "stock" / "macro" / "risk"）。
    """

    name: str
    server: str
    description: str
    category: str


@dataclass(frozen=True)
class ToolServer:
    """MCP 服务器值对象。

    Attributes:
        name: 服务器名称。
        description: 服务器描述。
        enabled: 是否启用。
        command: 启动命令（argv 列表的不可变形式）。
        tools: 该服务器提供的工具列表。
    """

    name: str
    description: str
    enabled: bool
    command: tuple[str, ...]
    tools: tuple[Tool, ...]
