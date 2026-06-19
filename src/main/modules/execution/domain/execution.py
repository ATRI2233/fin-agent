"""工作流执行聚合根 ``WorkflowExecution``。

``WorkflowExecution`` 表示一次工作流的执行实例;其状态可在生命周期内
发生变化(PENDING -> RUNNING -> COMPLETED/FAILED/CLEANED_UP),因此
不使用 ``frozen=True``。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from src.main.infra.domain import ExecutionId, TraceId, WorkflowId
from src.main.modules.execution.domain.execution_node import ExecutionStatus

# TODO: switch to ExecutionParams TypedDict once TASK-002 adds it.
# 当前 infra.domain 尚未导出 ExecutionParams,临时回退为 dict[str, Any]。
# Do Not(类型一致性):禁止完全无注解的 params: dict。
ParamsType = dict[str, Any]


@dataclass
class WorkflowExecution:
    """工作流执行实例聚合根。

    Attributes:
        id: 执行 ID。
        workflow_id: 所属工作流 ID。
        status: 当前状态(会在生命周期内迁移)。
        params: 触发执行的参数。
        trace_id: 审计/追踪 ID。
        created_at: 创建时间。
        started_at: 开始执行时间。
        completed_at: 完成时间。
    """

    id: ExecutionId
    workflow_id: WorkflowId
    status: ExecutionStatus
    params: ParamsType
    trace_id: TraceId
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
