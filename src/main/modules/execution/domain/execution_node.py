"""ExecutionNode 状态机定义。

本文件包含:
    - ``ExecutionStatus`` 枚举(6 个值)。
    - ``LEGAL_TRANSITIONS`` 合法迁移表(严格按设计文档 §3.5)。
    - ``transition()`` 迁移校验函数。
    - ``ExecutionNode`` 聚合根 dataclass。

修订关联:
    - REVISION_NOTES_2026-06-18.md 修订 **T-4**: CLEANED_UP 终态不可复活明示。
    - REVISION_NOTES_2026-06-18.md 修订 SKIPPED 终态化(LEGAL_TRANSITIONS[SKIPPED]
      为 frozenset,禁止任何出迁移)。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum

from src.main.infra.domain import AgentReference, NodeId, SessionId
from src.main.infra.errors import InvalidStateTransitionError


# === 设计约束(不允许在实现中绕过)===
# - CLEANED_UP 是终态;不允许 CLEANED_UP -> PENDING 复活。
# - 用户在 session 清理后想重跑工作流,必须创建**新的 WorkflowExecution**
#   (即 RetryService.retry_workflow() 内部的"新建 execution"语义),
#   而不是把现有 execution 的状态从 CLEANED_UP 拉回 PENDING/RUNNING。
# - 历史 execution 的 CLEANED_UP 行保留作为审计追溯。
# - SKIPPED 是**真终态**,不允许任何迁移出(LEGAL_TRANSITIONS[SKIPPED] = frozenset())。
#   - RetryService.retry_node 遇到 SKIPPED 节点必须**直接跳过**(详见 TASK-310 §4.1)。
#   - 若业务需要重跑,创建新 execution(retry_workflow 语义,详见 TASK-310 §4.1)。
# === 设计约束结束 ===


class ExecutionStatus(str, Enum):
    """执行节点状态枚举。"""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"
    CLEANED_UP = "cleaned_up"


# 合法迁移表(任何不在表内的迁移 -> InvalidStateTransitionError)
# 严格按设计文档 §3.5 + 修订 T-4 强约束。
LEGAL_TRANSITIONS: dict[ExecutionStatus, frozenset[ExecutionStatus]] = {
    ExecutionStatus.PENDING: frozenset(
        {ExecutionStatus.RUNNING, ExecutionStatus.SKIPPED}
    ),
    ExecutionStatus.RUNNING: frozenset(
        {ExecutionStatus.COMPLETED, ExecutionStatus.FAILED}
    ),
    ExecutionStatus.COMPLETED: frozenset({ExecutionStatus.CLEANED_UP}),
    # FAILED 可重试(PENDING) / 跳过(SKIPPED) / 清理(CLEANED_UP)
    ExecutionStatus.FAILED: frozenset(
        {ExecutionStatus.PENDING, ExecutionStatus.SKIPPED, ExecutionStatus.CLEANED_UP}
    ),
    # SKIPPED 是真终态(修订 T-4)
    ExecutionStatus.SKIPPED: frozenset(),
    # CLEANED_UP 是真终态(修订 T-4):禁止 CLEANED_UP -> PENDING 复活
    ExecutionStatus.CLEANED_UP: frozenset(),
}


def transition(current: ExecutionStatus, target: ExecutionStatus) -> None:
    """校验并执行状态迁移。

    Args:
        current: 当前状态。
        target: 目标状态。

    Raises:
        InvalidStateTransitionError: 迁移不合法时抛出。
    """
    if target not in LEGAL_TRANSITIONS[current]:
        raise InvalidStateTransitionError(
            f"illegal: {current.value} -> {target.value}",
            details={"from": current.value, "to": target.value},
        )


@dataclass
class ExecutionNode:
    """执行节点聚合根。

    Attributes:
        node_id: 节点 ID。
        agent: Agent 引用(frozen 值对象,**禁止** str)。
        status: 当前状态。
        input: 节点输入参数。
        output: 节点输出结果(完成时填充)。
        session_id: 关联 session(可能为 None,例如纯计算节点)。
        error: 错误信息字符串(失败时填充)。
        started_at: 开始时间。
        completed_at: 完成时间。
        retry_count: 已重试次数。
    """

    node_id: NodeId
    agent: AgentReference
    status: ExecutionStatus
    input: dict
    output: dict | None
    session_id: SessionId | None
    error: str | None
    started_at: datetime | None
    completed_at: datetime | None
    retry_count: int = 0
