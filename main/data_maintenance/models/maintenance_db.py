"""Maintenance database — independent SQLite for stock/market data.

Separate from the business database (finagent.db) to avoid
performance interference from frequent data updates.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Column, String, Integer, Float, Text, DateTime, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

MaintenanceBase = declarative_base()

# Default path: <project_root>/data/maintenance.db
_DB_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "data")
_DB_PATH = os.path.join(os.path.abspath(_DB_DIR), "maintenance.db")

_engine = None
_SessionLocal = None


def _get_engine():
    global _engine
    if _engine is None:
        os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
        _engine = create_engine(
            f"sqlite:///{_DB_PATH}",
            connect_args={"check_same_thread": False},
        )
    return _engine


def get_maintenance_db():
    """FastAPI dependency — yields a DB session."""
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=_get_engine()
        )
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_session():
    """Direct session factory for non-FastAPI usage."""
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=_get_engine()
        )
    return _SessionLocal()


def init_maintenance_db():
    """Create all tables if they don't exist."""
    MaintenanceBase.metadata.create_all(bind=_get_engine())


# ---- ORM Models ----


class MaintenanceTask(MaintenanceBase):
    __tablename__ = "maintenance_tasks"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    agent = Column(String, nullable=False)
    prompt = Column(Text, nullable=False)
    schedule = Column(String, nullable=True)  # cron expression
    enabled = Column(Integer, default=1)
    trigger_type = Column(String, default="cron")  # cron | manual | interval
    interval_seconds = Column(Integer, nullable=True)
    last_run_at = Column(DateTime, nullable=True)
    last_status = Column(String, nullable=True)  # success | failed | running
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class MaintenanceData(MaintenanceBase):
    __tablename__ = "maintenance_data"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    task_id = Column(String, nullable=False, index=True)
    data_key = Column(String, nullable=False, index=True)
    content = Column(Text, nullable=True)  # JSON string
    fetched_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), index=True
    )


class MaintenanceLog(MaintenanceBase):
    __tablename__ = "maintenance_logs"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    task_id = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False)  # success | failed | timeout
    duration_seconds = Column(Float, nullable=True)
    records_updated = Column(Integer, default=0)
    error = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
