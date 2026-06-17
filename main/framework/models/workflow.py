from datetime import UTC, datetime
from uuid import uuid4

from main.framework.models.database import Base
from sqlalchemy import JSON, Column, DateTime, String


class Workflow(Base):
    __tablename__ = "workflows"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    nodes = Column(JSON, default=list)
    edges = Column(JSON, default=list)
    session_boundaries = Column(JSON, default=list)
    schedule_config = Column(JSON, default=dict)
    trigger_type = Column(String, default="manual")
    cron_expression = Column(String, nullable=True)
    config = Column(JSON, default=dict)
    status = Column(String, default="draft")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))
