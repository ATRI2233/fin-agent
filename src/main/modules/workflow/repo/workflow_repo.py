"""Workflow Repository — SQLAlchemy 实现。

``SqlAlchemyWorkflowRepository`` 实现了 ``WorkflowReader`` Protocol 的
``get`` 与 ``list`` 方法,负责从 ``workflows`` 表读取数据并转换为
domain 层对象。

异常处理:
    - 工作流不存在时 ``get`` 必须 ``raise WorkflowNotFoundError``(Do Not #3)。
"""

from __future__ import annotations

from typing import Callable

from sqlalchemy.orm import Session, sessionmaker

from src.main.infra.domain import NodeId, WorkflowId
from src.main.infra.errors import WorkflowNotFoundError
from src.main.modules.workflow.domain.edge import Edge
from src.main.modules.workflow.domain.node import Node, NodeType
from src.main.modules.workflow.domain.workflow import Workflow
from src.main.modules.workflow.protocol import WorkflowReader
from src.main.modules.workflow.repo.orm import WorkflowORM


class SqlAlchemyWorkflowRepository(WorkflowReader):
    """基于 SQLAlchemy 的工作流只读仓储。

    Args:
        session_factory: ``sessionmaker`` 工厂,用于创建 Session 实例。
    """

    def __init__(self, session_factory: Callable[[], Session] | sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def get(self, workflow_id: WorkflowId) -> Workflow | None:
        """根据工作流 ID 获取工作流定义。

        Args:
            workflow_id: 工作流唯一 ID。

        Returns:
            ``Workflow`` 领域对象。

        Raises:
            WorkflowNotFoundError: 工作流不存在。
        """
        with self._session_factory() as session:
            row = session.query(WorkflowORM).filter_by(id=str(workflow_id)).first()
            if row is None:
                raise WorkflowNotFoundError(
                    f"workflow {workflow_id} not found",
                )
            return self._to_domain(row)

    def list(
        self,
        *,
        limit: int,
        offset: int,
    ) -> list[Workflow]:
        """列出工作流(分页,按 ``updated_at`` 倒序)。

        Args:
            limit: 返回条数上限(keyword-only)。
            offset: 分页偏移(keyword-only)。

        Returns:
            ``Workflow`` 领域对象列表。
        """
        with self._session_factory() as session:
            rows = (
                session.query(WorkflowORM)
                .order_by(WorkflowORM.updated_at.desc())
                .offset(offset)
                .limit(limit)
                .all()
            )
            return [self._to_domain(r) for r in rows]

    @staticmethod
    def _to_domain(row: WorkflowORM) -> Workflow:
        """将 ORM 行转换为 ``Workflow`` 领域对象。

        JSON 字段反序列化为 ``Node`` / ``Edge`` 数据类实例。

        Args:
            row: ``WorkflowORM`` 实例。

        Returns:
            ``Workflow`` 领域对象。
        """
        nodes: list[Node] = []
        for raw in row.nodes or []:
            node_type = NodeType(raw["type"])
            nodes.append(
                Node(
                    id=NodeId(raw["id"]),
                    type=node_type,
                    data=raw.get("data", {}),
                    agent=None,
                    prompt=raw.get("prompt"),
                )
            )

        edges: list[Edge] = [
            Edge(source=NodeId(e["source"]), target=NodeId(e["target"]))
            for e in (row.edges or [])
        ]

        return Workflow(
            id=WorkflowId(row.id),
            name=row.name,
            nodes=nodes,
            edges=edges,
            trigger_type=row.trigger_type,
            config=row.config or {},
            status=row.status,
        )
