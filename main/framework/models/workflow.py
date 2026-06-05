from uuid import uuid4

from sqlalchemy import Column, String, DateTime, JSON

from main.framework.models.database import Base
from datetime import datetime


class Workflow(Base):
    __tablename__ = "workflows"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    nodes = Column(JSON, default=[])
    edges = Column(JSON, default=[])
    session_boundaries = Column(JSON, default=[])
    schedule_config = Column(JSON, default={})
    trigger_type = Column(String, default="manual")
    cron_expression = Column(String, nullable=True)
    config = Column(JSON, default={})
    status = Column(String, default="draft")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
