"""状态机辅助函数。

提供 ``can_transition`` / ``validate_transition`` 两个工具函数。
``validate_transition`` 在非法迁移时 raise 的异常 message 中包含 ``execution_id``,
便于审计与排错。
"""

from __future__ import annotations

from src.main.infra.domain import ExecutionId
from src.main.infra.errors import InvalidStateTransitionError
from src.main.modules.execution.domain.execution_node import (
    LEGAL_TRANSITIONS,
    ExecutionStatus,
)


def can_transition(current: ExecutionStatus, target: ExecutionStatus) -> bool:
    """判断迁移是否合法。

    Args:
        current: 当前状态。
        target: 目标状态。

    Returns:
        合法返回 ``True``,否则 ``False``。
    """
    return target in LEGAL_TRANSITIONS[current]


def validate_transition(
    execution_id: ExecutionId,
    current: ExecutionStatus,
    target: ExecutionStatus,
) -> None:
    """校验状态迁移,非法时 raise ``InvalidStateTransitionError``。

    错误 message 中包含 ``execution_id``,便于排错定位。

    Args:
        execution_id: 所属执行 ID(进入 error message 便于审计)。
        current: 当前状态。
        target: 目标状态。

    Raises:
        InvalidStateTransitionError: 迁移不合法时抛出。
    """
    if target not in LEGAL_TRANSITIONS[current]:
        raise InvalidStateTransitionError(
            f"illegal transition for execution_id={execution_id}: "
            f"{current.value} -> {target.value}",
            details={
                "execution_id": str(execution_id),
                "from": current.value,
                "to": target.value,
            },
        )
