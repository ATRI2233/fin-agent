"""Workflow ORM 模型。

定义 ``WorkflowORM`` 类,映射 ``workflows`` 表,负责工作流定义
的持久化存储。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from src.main.infra.db import Base


class WorkflowORM(Base):
    """工作流 ORM 模型。

    表名: ``workflows``

    Attributes:
        id: 工作流唯一标识(主键)。
        name: 工作流名称。
        description: 可选描述。
        nodes: 节点列表(JSON 序列化的 Node 字典列表)。
        edges: 边列表(JSON 序列化的 Edge 字典列表)。
        trigger_type: 触发类型字符串。
        config: 运行时配置字典(JSON)。
        status: 工作流状态字符串。
        created_at: 创建时间。
        updated_at: 更新时间。
    """

    __tablename__ = "workflows"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    nodes: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    edges: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    trigger_type: Mapped[str] = mapped_column(String, nullable=False, default="manual")
    config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String, nullable=False, default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, index=True
    )