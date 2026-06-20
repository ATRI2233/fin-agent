"""API v1 workflows router — thin handlers delegating to workflow services.

本文件遵循 TASK-408: 每个 handler 是 thin wrapper,
``Depends(service_dep(Protocol))`` -> service call -> ``ApiResponse``。

约定:
- 所有 handler 均 ``async def``,即便底层 service 为 sync(``def``),
  FastAPI 在 threadpool 内执行(``WorkflowQueryService`` 是 sync 的);
  trigger 端点通过 ``BackgroundTasks`` 异步触发 ``WorkflowRunner.run``。
- ``trace_id`` 取自 ``current_trace_id()``(Do Not #18)。
- 异常向上抛,不吞(Do Not #3);由全局异常处理 + ``FinAgentError``
  体系 + ``LegacyEnvelopeMiddleware`` 统一包装(Do Not #4)。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field

from src.main.api.deps import service_dep
from src.main.infra.api_envelope import ApiResponse
from src.main.infra.domain import (
    ExecutionId,
    NodeId,
    TraceId,
    WorkflowId,
)
from src.main.infra.errors import WorkflowNotFoundError
from src.main.infra.tracing import current_trace_id
from src.main.modules.workflow.protocol import (
    WorkflowReader,
    WorkflowRunner,
)
from src.main.modules.workflow.service.workflow_query_service import (
    WorkflowQueryService,
)

router = APIRouter(prefix="/api/v1/workflows", tags=["workflows"])


# ── Pydantic 请求模型 ──


class WorkflowCreate(BaseModel):
    """创建工作流的请求体。

    Attributes:
        name: 工作流名称。
        nodes: 节点列表(原始 dict,结构与 DAG 定义一致)。
        edges: 边列表(原始 dict,结构与 DAG 定义一致)。
        trigger_type: 触发类型字符串(``"manual"`` / ``"scheduled"`` /
            ``"event"`` 等)。
        config: 运行时配置字典。
        status: 工作流状态字符串。
    """

    name: str
    nodes: list[dict] = Field(default_factory=list)
    edges: list[dict] = Field(default_factory=list)
    trigger_type: str = "manual"
    config: dict = Field(default_factory=dict)
    status: str = "draft"


class WorkflowUpdate(BaseModel):
    """更新工作流的请求体(部分字段)。"""

    name: str | None = None
    nodes: list[dict] | None = None
    edges: list[dict] | None = None
    trigger_type: str | None = None
    config: dict | None = None
    status: str | None = None


class WorkflowTrigger(BaseModel):
    """触发工作流执行的请求体。

    Attributes:
        params: 触发参数(payload);``dict[str, Any]`` 宽泛类型,
            业务字段由调用方契约保证。
    """

    params: dict[str, Any] = Field(default_factory=dict)


# ── Helpers ──


def _workflow_to_dict(wf: Any) -> dict:
    """将 ``Workflow`` 域对象序列化为 dict。

    Args:
        wf: ``Workflow`` 聚合根或 ``None``。

    Returns:
        可 JSON 序列化的字典。
    """
    if wf is None:
        return {}
    return {
        "id": str(getattr(wf, "id", "")),
        "name": getattr(wf, "name", ""),
        "nodes": [
            {
                "id": str(getattr(n, "id", "")),
                "type": getattr(getattr(n, "type", None), "value", str(n.type)),
                "data": getattr(n, "data", {}),
                "prompt": getattr(n, "prompt", None),
            }
            for n in getattr(wf, "nodes", [])
        ],
        "edges": [
            {"source": str(getattr(e, "source", "")), "target": str(getattr(e, "target", ""))}
            for e in getattr(wf, "edges", [])
        ],
        "trigger_type": getattr(wf, "trigger_type", "manual"),
        "config": getattr(wf, "config", {}),
        "status": getattr(wf, "status", "draft"),
    }


# ── Endpoints ──


@router.get("")
async def list_workflows(
    limit: int = 20,
    offset: int = 0,
    reader: WorkflowReader = Depends(service_dep(WorkflowReader)),
) -> dict:
    """列出工作流(分页)。

    Args:
        limit: 返回条数上限。
        offset: 分页偏移。
        reader: 通过 ``service_dep(WorkflowReader)`` 注入的只读工作流服务。

    Returns:
        ``ApiResponse`` 信封,``data`` 为工作流字典列表。
    """
    items = reader.list(limit=limit, offset=offset)
    payload = [_workflow_to_dict(w) for w in items]
    return ApiResponse.success(payload, current_trace_id()).to_dict()


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_workflow(
    body: WorkflowCreate,
    svc: WorkflowQueryService = Depends(service_dep(WorkflowQueryService)),
) -> dict:
    """创建工作流。

    Args:
        body: 工作流定义请求体。
        svc: 通过 ``service_dep(WorkflowQueryService)`` 注入的工作流 CRUD 服务。

    Returns:
        ``ApiResponse`` 信封,``data`` 为 ``{"workflow_id": str}``。
    """
    from src.main.modules.workflow.domain.node import Node
    from src.main.modules.workflow.domain.edge import Edge
    from src.main.modules.workflow.domain.workflow import Workflow

    nodes = [
        Node(
            id=NodeId(n.get("id", "")),
            type=n.get("type", "agent"),
            data=n.get("data", {}),
            prompt=n.get("prompt"),
        )
        for n in body.nodes
    ]
    edges = [
        Edge(source=NodeId(e.get("source", "")), target=NodeId(e.get("target", "")))
        for e in body.edges
    ]
    workflow = Workflow(
        id=WorkflowId(""),  # service 端按需生成
        name=body.name,
        nodes=nodes,
        edges=edges,
        trigger_type=body.trigger_type,
        config=body.config,
        status=body.status,
    )
    new_id = svc.create(workflow, current_trace_id())
    return ApiResponse.success(
        {"workflow_id": str(new_id)}, current_trace_id()
    ).to_dict()


@router.get("/{workflow_id}")
async def get_workflow(
    workflow_id: str,
    svc: WorkflowQueryService = Depends(service_dep(WorkflowQueryService)),
) -> dict:
    """获取工作流定义。

    Args:
        workflow_id: 工作流 ID(路径参数)。
        svc: 通过 ``service_dep(WorkflowQueryService)`` 注入的工作流服务。

    Returns:
        ``ApiResponse`` 信封,``data`` 为工作流字典。

    Raises:
        WorkflowNotFoundError: 工作流不存在(由 service 抛出)。
    """
    wf = svc.get(WorkflowId(workflow_id))
    if wf is None:
        raise WorkflowNotFoundError(f"workflow {workflow_id} not found")
    return ApiResponse.success(_workflow_to_dict(wf), current_trace_id()).to_dict()


@router.put("/{workflow_id}")
async def update_workflow(
    workflow_id: str,
    body: WorkflowUpdate,
    svc: WorkflowQueryService = Depends(service_dep(WorkflowQueryService)),
) -> dict:
    """更新工作流。

    Args:
        workflow_id: 工作流 ID。
        body: 部分字段更新体。
        svc: 通过 ``service_dep(WorkflowQueryService)`` 注入的工作流服务。

    Returns:
        ``ApiResponse`` 信封,``data`` 为更新后的工作流字典。
    """
    kwargs: dict[str, Any] = {
        k: v
        for k, v in body.model_dump(exclude_unset=True).items()
        if v is not None
    }
    wf = svc.update(WorkflowId(workflow_id), **kwargs)
    return ApiResponse.success(_workflow_to_dict(wf), current_trace_id()).to_dict()


@router.delete("/{workflow_id}", status_code=status.HTTP_200_OK)
async def delete_workflow(
    workflow_id: str,
    svc: WorkflowQueryService = Depends(service_dep(WorkflowQueryService)),
) -> dict:
    """删除工作流。

    Args:
        workflow_id: 工作流 ID。
        svc: 通过 ``service_dep(WorkflowQueryService)`` 注入的工作流服务。

    Returns:
        ``ApiResponse`` 信封,``data`` 为 ``{"workflow_id": str, "deleted": True}``。
    """
    svc.delete(WorkflowId(workflow_id))
    return ApiResponse.success(
        {"workflow_id": workflow_id, "deleted": True}, current_trace_id()
    ).to_dict()


@router.post("/{workflow_id}/trigger", status_code=status.HTTP_202_ACCEPTED)
async def trigger_workflow(
    workflow_id: str,
    body: WorkflowTrigger,
    background_tasks: BackgroundTasks,
    query_svc: WorkflowQueryService = Depends(service_dep(WorkflowQueryService)),
    runner: WorkflowRunner = Depends(service_dep(WorkflowRunner)),
) -> dict:
    """触发工作流执行。

    流程:
        1. ``WorkflowQueryService.trigger`` 创建 ``workflow_executions``
           占位记录(PENDING),返回 ``ExecutionId``;
        2. 通过 ``BackgroundTasks`` 异步触发 ``WorkflowRunner.run``。

    Args:
        workflow_id: 工作流 ID。
        body: 触发参数。
        background_tasks: FastAPI BackgroundTasks 注入。
        query_svc: ``WorkflowQueryService``(用于创建 execution 占位)。
        runner: ``WorkflowRunner``(实际执行)。

    Returns:
        ``ApiResponse`` 信封,``data`` 为 ``{"execution_id": str}``。
    """
    tid: TraceId = current_trace_id()
    execution_id: ExecutionId = query_svc.trigger(
        WorkflowId(workflow_id), body.params, tid
    )

    async def _run() -> None:
        await runner.run(
            WorkflowId(workflow_id),
            body.params,
            execution_id=execution_id,
            trace_id=tid,
        )

    background_tasks.add_task(_run)
    return ApiResponse.success(
        {"execution_id": str(execution_id)}, tid
    ).to_dict()
