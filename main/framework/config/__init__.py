"""Configuration package - migrated from main.framework.config and main.framework.models.database.

This package provides:
- settings: Application settings (Settings class)
- constants: Business constants
- database: SQLAlchemy engine, session, and base
"""

from main.framework.config.constants import (
    DEFAULT_TIMEOUT,
    MAINTENANCE_RETENTION_DAYS,
    MAX_AGENT_RETRIES,
    MAX_NODES_PER_WORKFLOW,
    SCHEDULER_MAX_INSTANCES,
)
from main.framework.config.database import Base, SessionLocal, engine, get_db, get_session, init_db
from main.framework.config.settings import Settings, _find_opencode_bin, settings

__all__ = [
    "Settings",
    "settings",
    "_find_opencode_bin",
    "MAX_AGENT_RETRIES",
    "DEFAULT_TIMEOUT",
    "MAX_NODES_PER_WORKFLOW",
    "SCHEDULER_MAX_INSTANCES",
    "MAINTENANCE_RETENTION_DAYS",
    "engine",
    "SessionLocal",
    "Base",
    "get_db",
    "get_session",
    "init_db",
]
