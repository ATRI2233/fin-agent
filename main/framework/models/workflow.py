from uuid import uuid4

from sqlalchemy import Column, String, DateTime, JSON

from main.framework.models.database import Base
from datetime import datetime, timezone


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
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
