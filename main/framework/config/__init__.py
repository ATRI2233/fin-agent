"""Configuration package - migrated from main.framework.config and main.framework.models.database.

This package provides:
- settings: Application settings (Settings class)
- constants: Business constants
- database: SQLAlchemy engine, session, and base
"""

from main.framework.config.settings import Settings, settings, _find_opencode_bin
from main.framework.config.constants import (
    MAX_AGENT_RETRIES,
    DEFAULT_TIMEOUT,
    MAX_NODES_PER_WORKFLOW,
    SCHEDULER_MAX_INSTANCES,
    MAINTENANCE_RETENTION_DAYS,
)
from main.framework.config.database import engine, SessionLocal, Base, get_db, init_db

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
    "init_db",
]
