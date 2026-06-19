"""共享值对象。

跨模块共享的 ID 类型与值对象。所有 Protocol/DTO 都引用本文件的基础类型。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import NewType

from src.main.infra.error_codes import ErrorCode
from src.main.infra.errors import BizError

# ── ID 类型 ──

TraceId = NewType("TraceId", str)
WorkflowId = NewType("WorkflowId", str)
ExecutionId = NewType("ExecutionId", str)
NodeId = NewType("NodeId", str)
SessionId = NewType("SessionId", str)
ConversationId = NewType("ConversationId", str)


@dataclass(frozen=True)
class AgentReference:
    """Agent 引用，表示对一个 Agent 定义的引用。

    Attributes:
        name: Agent 名称。
        definition_path: 可选的 Agent 定义文件路径。
    """

    name: str
    definition_path: Path | None

    @classmethod
    def from_node(cls, node: dict) -> AgentReference:
        """从工作流节点字典解析 Agent 引用。

        按 ``node["agent"] → node["data"]["agentType"] → node["data"]["label"]``
        顺序解析，首个非空值即作为 name 返回。
        全空时抛出 BizError(ErrorCode.AGENT_NOT_DEFINED)。

        Args:
            node: 工作流节点字典。

        Returns:
            AgentReference 实例。

        Raises:
            BizError: 当无法从节点解析出任何 Agent 名称时。
        """
        name: str | None = node.get("agent")
        if not name:
            data: dict | None = node.get("data")
            if data:
                name = data.get("agentType") or data.get("label")
        if not name:
            raise BizError(
                "Agent reference could not be resolved from node",
                details={"node": node},
            )
        return cls(name=name, definition_path=None)


@dataclass(frozen=True)
class RetryPolicy:
    """重试策略。

    Attributes:
        max_attempts: 最大重试次数（含首次尝试）。
        base_delay: 初始延迟秒数。
        backoff: 指数退避因子。
        circuit_breaker_threshold: 熔断阈值，连续失败次数超过此值触发熔断。
    """

    max_attempts: int = 3
    base_delay: float = 1.0
    backoff: float = 2.0
    circuit_breaker_threshold: int = 5
