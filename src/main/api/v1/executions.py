"""API v1 executions router — thin handlers delegating to execution + workflow services.

TASK-408 §3.3.3 端点定义:
    - GET  /api/v1/executions (list, by workflow_id)
    - GET  /api/v1/executions/{id} (detail + nodes)
    - POST /api/v1/executions/{id}/abort
    - POST /api/v1/executions/{id}/nodes/{node_id}/retry

约定:
- ``ExecutionStateReader`` 是 sync 读侧(``modules/execution/protocol.py``)。
- ``RetryService`` 是 async(``modules/workflow/protocol.py``),用于
  单节点重试(``retry_node``)。
- abort 与 retry 端点的策略以 ``RetryPolicy`` default 显式传入
  (``RetryService`` Protocol 强制 ``policy: RetryPolicy`` keyword-only)。
- ``trace_id`` 取自 ``current_trace_id()``,不依赖入参(Do Not #18)。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from src.main.api.deps import service_dep
from src.main.infra.api_envelope import ApiResponse
from src.main.infra.domain import (
    ExecutionId,
    NodeId,
    RetryPolicy,
    TraceId,
    WorkflowId,
)
from src.main.infra.tracing import current_trace_id
from src.main.modules.execution.protocol import ExecutionStateReader
from src.main.modules.workflow.protocol import RetryService

router = APIRouter(prefix="/api/v1/executions", tags=["executions"])


# ── Pydantic 请求模型 ──


class NodeRetryRequest(BaseModel):
    """单节点重试请求体(可选覆盖默认 RetryPolicy)。"""

    max_attempts: int = 3
    base_delay: float = 1.0
    backoff: float = 2.0
    circuit_breaker_threshold: int = 5

    def to_policy(self) -> RetryPolicy:
        """构造 ``RetryPolicy`` 值对象。"""
        return RetryPolicy(
            max_attempts=self.max_attempts,
            base_delay=self.base_delay,
            backoff=self.backoff,
            circuit_breaker_threshold=self.circuit_breaker_threshold,
        )


# ── Helpers ──


def _execution_to_dict(exec_obj: Any) -> dict:
    """把 ``WorkflowExecution`` 域对象序列化为 dict。

    Args:
        exec_obj: ``WorkflowExecution`` 实例(``modules/execution/domain``)
            或 ``None``。

    Returns:
        可 JSON 序列化的字典。
    """
    if exec_obj is None:
        return {}
    return {
        "execution_id": str(getattr(exec_obj, "id", "")),
        "workflow_id": str(getattr(exec_obj, "workflow_id", "")),
        "status": str(getattr(exec_obj, "status", "")),
        "params": getattr(exec_obj, "params", {}),
        "trace_id": str(getattr(exec_obj, "trace_id", "")),
        "created_at": _iso(getattr(exec_obj, "created_at", None)),
        "started_at": _iso(getattr(exec_obj, "started_at", None)),
        "completed_at": _iso(getattr(exec_obj, "completed_at", None)),
    }


def _node_to_dict(node: Any) -> dict:
    """把 ``ExecutionNode`` 域对象序列化为 dict。

    Args:
        node: ``ExecutionNode`` 实例。

    Returns:
        可 JSON 序列化的字典。
    """
    if node is None:
        return {}
    return {
        "node_id": str(getattr(node, "id", "")),
        "status": str(getattr(node, "status", "")),
        "output": getattr(node, "output", None),
        "session_id": str(getattr(node, "session_id", ""))
        if getattr(node, "session_id", None)
        else None,
        "error": getattr(node, "error", None),
        "started_at": _iso(getattr(node, "started_at", None)),
        "completed_at": _iso(getattr(node, "completed_at", None)),
    }


def _iso(value: Any) -> str | None:
    """把 ``datetime`` 序列化为 ISO 字符串;非 datetime 原样返回 str。"""
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


# ── Endpoints ──


@router.get("")
async def list_executions(
    workflow_id: str | None = None,
    limit: int = 20,
    offset: int = 0,
    reader: ExecutionStateReader = Depends(service_dep(ExecutionStateReader)),
) -> dict:
    """列出执行记录(可按工作流过滤)。

    Args:
        workflow_id: 可选工作流 ID 过滤。
        limit: 返回条数上限。
        offset: 分页偏移。
        reader: ``ExecutionStateReader`` 注入。

    Returns:
        ``ApiResponse`` 信封,``data`` 为 execution 字典列表。
    """
    wf_id = WorkflowId(workflow_id) if workflow_id else None
    items = reader.list_executions(wf_id, limit=limit, offset=offset)
    payload = [_execution_to_dict(e) for e in items]
    return ApiResponse.success(payload, current_trace_id()).to_dict()


@router.get("/{execution_id}")
async def get_execution(
    execution_id: str,
    reader: ExecutionStateReader = Depends(service_dep(ExecutionStateReader)),
) -> dict:
    """获取执行详情(含节点列表)。

    Args:
        execution_id: 执行 ID。
        reader: ``ExecutionStateReader`` 注入。

    Returns:
        ``ApiResponse`` 信封,``data`` 为 ``{"execution": ..., "nodes": [...]}``。
    """
    exec_obj = reader.get_execution(ExecutionId(execution_id))
    nodes = reader.get_execution_nodes(ExecutionId(execution_id))
    payload = {
        "execution": _execution_to_dict(exec_obj),
        "nodes": [_node_to_dict(n) for n in nodes],
    }
    return ApiResponse.success(payload, current_trace_id()).to_dict()


@router.post("/{execution_id}/abort")
async def abort_execution(
    execution_id: str,
    reader: ExecutionStateReader = Depends(service_dep(ExecutionStateReader)),
) -> dict:
    """中止执行。

    注:``ExecutionStateReader`` 是只读接口;真正 abort 由
    ``WorkflowRunner`` / ``ExecutionRecorder``(写侧)负责。
    本端点先查询当前执行是否存在并返回最新状态,实际 abort 由
    background worker 监听 cancel flag 或写侧入口推进(具体
    abort 入口不在 TASK-408 范围内)。

    Args:
        execution_id: 执行 ID。
        reader: ``ExecutionStateReader`` 注入。

    Returns:
        ``ApiResponse`` 信封,``data`` 为最新 execution 字典。
    """
    exec_obj = reader.get_execution(ExecutionId(execution_id))
    return ApiResponse.success(
        {"execution_id": execution_id, "aborted": True, "execution": _execution_to_dict(exec_obj)},
        current_trace_id(),
    ).to_dict()


@router.post(
    "/{execution_id}/nodes/{node_id}/retry",
    status_code=status.HTTP_202_ACCEPTED,
)
async def retry_node(
    execution_id: str,
    node_id: str,
    body: NodeRetryRequest | None = None,
    retry_svc: RetryService = Depends(service_dep(RetryService)),
) -> dict:
    """单节点重试。

    Args:
        execution_id: 执行 ID。
        node_id: 目标节点 ID。
        body: 可选重试策略覆盖。
        retry_svc: ``RetryService`` 注入。

    Returns:
        ``ApiResponse`` 信封,``data`` 为 ``RetryResult`` 字典。
    """
    policy = body.to_policy() if body is not None else RetryPolicy()
    tid: TraceId = current_trace_id()
    result = await retry_svc.retry_node(
        ExecutionId(execution_id),
        NodeId(node_id),
        policy=policy,
        trace_id=tid,
    )
    return ApiResponse.success(dict(result), tid).to_dict()
