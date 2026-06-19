"""Workflow CRUD service — sync, SQLAlchemy 2.0 同步 session 语义。

本服务所有方法均为同步 ``def``:
    - ``repo`` 是 ``SqlAlchemyWorkflowRepository``(同步 session);
    - 写操作通过 ``uow_factory.begin()`` 打开同步事务上下文;
    - Router 在 async handler 中可直接同步调用,FastAPI 会自动在线程
      池内执行;不要写 ``await svc.create(...)``。

``trigger`` 方法只创建 ``workflow_executions`` 占位记录(PENDING),
实际运行留给 ``WorkflowRunner``(TASK-309)异步任务调度。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.exc import SQLAlchemyError

from src.main.infra.domain import ExecutionId, TraceId, WorkflowId
from src.main.infra.errors import DatabaseError, FinAgentError, WorkflowNotFoundError
from src.main.infra.uow import UoWFactory
from src.main.modules.execution.domain.execution_node import ExecutionStatus
from src.main.modules.execution.repo.orm import WorkflowExecutionORM
from src.main.modules.workflow.domain.workflow import Workflow
from src.main.modules.workflow.protocol import WorkflowReader
from src.main.modules.workflow.repo.workflow_repo import SqlAlchemyWorkflowRepository


def _now() -> datetime:
    """UTC ``datetime`` for ``created_at`` / ``updated_at``."""
    return datetime.now(timezone.utc)


class WorkflowQueryService:
    """工作流 CRUD 服务 — 纯 sync 语义。

    所有写操作(``create`` / ``update`` / ``delete`` / ``trigger``)通过
    ``uow_factory.begin()`` 打开同步事务;读操作(``get`` / ``list``)
    直接委托 ``reader``。
    """

    def __init__(
        self,
        reader: WorkflowReader,
        repo: SqlAlchemyWorkflowRepository,
        uow_factory: UoWFactory,
    ) -> None:
        self._reader = reader
        self._repo = repo
        self._uow = uow_factory

    # ── reads (delegated to WorkflowReader) ──

    def get(self, workflow_id: WorkflowId) -> Workflow:
        """根据 ID 获取工作流。

        Args:
            workflow_id: 工作流唯一 ID。

        Returns:
            ``Workflow`` 领域对象。

        Raises:
            WorkflowNotFoundError: 工作流不存在。
        """
        return self._reader.get(workflow_id)

    def list(self, *, limit: int, offset: int) -> list[Workflow]:
        """列出工作流(分页,按 ``updated_at`` 倒序)。

        Args:
            limit: 返回条数上限(keyword-only)。
            offset: 分页偏移(keyword-only)。

        Returns:
            ``Workflow`` 领域对象列表。
        """
        return self._reader.list(limit=limit, offset=offset)

    # ── writes (UoW-managed) ──

    def create(self, workflow: Workflow, trace_id: TraceId) -> WorkflowId:
        """创建工作流记录。

        Args:
            workflow: 工作流聚合根(``Workflow.id`` 可由调用方预填)。
            trace_id: 审计/追踪 ID。

        Returns:
            新创建工作流的 ``WorkflowId``。

        Raises:
            DatabaseError: DB 写入失败。
            FinAgentError: 其他结构化错误。
        """
        workflow_id = workflow.id
        now = _now()
        nodes_payload = [
            {
                "id": str(n.id),
                "type": n.type.value,
                "data": n.data,
                "prompt": n.prompt,
            }
            for n in workflow.nodes
        ]
        edges_payload = [
            {"source": str(e.source), "target": str(e.target)}
            for e in workflow.edges
        ]
        with self._uow.begin() as uow:
            try:
                from src.main.modules.workflow.repo.orm import WorkflowORM

                uow.session.add(
                    WorkflowORM(
                        id=str(workflow_id),
                        name=workflow.name,
                        description=None,
                        nodes=nodes_payload,
                        edges=edges_payload,
                        trigger_type=workflow.trigger_type,
                        config=workflow.config,
                        status=workflow.status,
                        created_at=now,
                        updated_at=now,
                    )
                )
            except SQLAlchemyError as exc:
                raise DatabaseError(
                    "workflow create failed",
                    details={
                        "workflow_id": str(workflow_id),
                        "trace_id": str(trace_id),
                    },
                    cause=exc,
                ) from exc
        return workflow_id

    def update(self, workflow_id: WorkflowId, **kwargs: Any) -> Workflow:
        """更新工作流字段。

        支持通过 ``**kwargs`` 更新 ``WorkflowORM`` 的任意可写字段
        (``name`` / ``description`` / ``nodes`` / ``edges`` /
        ``trigger_type`` / ``config`` / ``status``)。

        Args:
            workflow_id: 目标工作流 ID。
            **kwargs: 待更新字段,key 须与 ``WorkflowORM`` 列名一致。

        Returns:
            更新后的 ``Workflow`` 领域对象。

        Raises:
            WorkflowNotFoundError: 工作流不存在。
            DatabaseError: DB 写入失败。
        """
        from src.main.modules.workflow.repo.orm import WorkflowORM

        with self._uow.begin() as uow:
            try:
                row = (
                    uow.session.query(WorkflowORM)
                    .filter(WorkflowORM.id == str(workflow_id))
                    .one_or_none()
                )
                if row is None:
                    raise WorkflowNotFoundError(
                        f"workflow {workflow_id} not found",
                    )
                for key, value in kwargs.items():
                    if not hasattr(row, key):
                        raise FinAgentError(
                            "unknown workflow field for update",
                            details={
                                "workflow_id": str(workflow_id),
                                "field": key,
                            },
                        )
                    setattr(row, key, value)
                row.updated_at = _now()
            except SQLAlchemyError as exc:
                raise DatabaseError(
                    "workflow update failed",
                    details={"workflow_id": str(workflow_id)},
                    cause=exc,
                ) from exc

        return self._reader.get(workflow_id)

    def delete(self, workflow_id: WorkflowId) -> None:
        """删除工作流记录。

        Args:
            workflow_id: 目标工作流 ID。

        Raises:
            WorkflowNotFoundError: 工作流不存在。
            DatabaseError: DB 写入失败。
        """
        from src.main.modules.workflow.repo.orm import WorkflowORM

        with self._uow.begin() as uow:
            try:
                row = (
                    uow.session.query(WorkflowORM)
                    .filter(WorkflowORM.id == str(workflow_id))
                    .one_or_none()
                )
                if row is None:
                    raise WorkflowNotFoundError(
                        f"workflow {workflow_id} not found",
                    )
                uow.session.delete(row)
            except SQLAlchemyError as exc:
                raise DatabaseError(
                    "workflow delete failed",
                    details={"workflow_id": str(workflow_id)},
                    cause=exc,
                ) from exc

    def trigger(
        self,
        workflow_id: WorkflowId,
        params: dict[str, Any],
        trace_id: TraceId,
    ) -> ExecutionId:
        """创建执行占位记录(PENDING)。

        本方法仅负责插入 ``workflow_executions`` 行(PENDING 状态,
        ``started_at`` / ``completed_at`` 均为 ``None``),实际 DAG
        推进留给 ``WorkflowRunner``(TASK-309)异步任务。

        Args:
            workflow_id: 目标工作流 ID。
            params: 触发参数;``dict[str, Any]`` 宽泛类型,业务字段在
                ``ExecutionParams`` TypedDict(TASK-002 ``infra.domain``)
                中定义,本服务只做存储不做 schema 校验。
            trace_id: 审计/追踪 ID。

        Returns:
            新创建的 ``ExecutionId``。

        Raises:
            WorkflowNotFoundError: 工作流不存在。
            DatabaseError: DB 写入失败。
        """
        from src.main.modules.workflow.repo.orm import WorkflowORM

        execution_id = ExecutionId(str(uuid.uuid4()))
        now = _now()
        with self._uow.begin() as uow:
            try:
                wf_row = (
                    uow.session.query(WorkflowORM)
                    .filter(WorkflowORM.id == str(workflow_id))
                    .one_or_none()
                )
                if wf_row is None:
                    raise WorkflowNotFoundError(
                        f"workflow {workflow_id} not found",
                    )
                uow.session.add(
                    WorkflowExecutionORM(
                        id=str(execution_id),
                        workflow_id=str(workflow_id),
                        status=ExecutionStatus.PENDING.value,
                        params=params,
                        trace_id=str(trace_id),
                        created_at=now,
                        started_at=None,
                        completed_at=None,
                    )
                )
            except SQLAlchemyError as exc:
                raise DatabaseError(
                    "workflow trigger failed",
                    details={
                        "workflow_id": str(workflow_id),
                        "execution_id": str(execution_id),
                        "trace_id": str(trace_id),
                    },
                    cause=exc,
                ) from exc
        return execution_id


__all__ = ["WorkflowQueryService"]
