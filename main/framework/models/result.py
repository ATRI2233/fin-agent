from uuid import uuid4

from sqlalchemy import Column, String, DateTime, JSON, ForeignKey

from main.framework.models.database import Base
from datetime import datetime, timezone


class Result(Base):
    __tablename__ = "results"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    job_id = Column(String, ForeignKey("jobs.id"), nullable=False)
    data = Column(JSON)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
