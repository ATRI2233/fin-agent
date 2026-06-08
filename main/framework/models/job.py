from uuid import uuid4

from sqlalchemy import Column, String, DateTime, JSON, Integer

from main.framework.models.database import Base
from datetime import datetime, timezone


class Job(Base):
    __tablename__ = "jobs"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    agent = Column(String, nullable=False)
    prompt = Column(String, nullable=False)
    status = Column(String, default="pending")
    result = Column(JSON, nullable=True)
    params = Column(JSON, default=dict)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    timeout = Column(Integer, default=300)
