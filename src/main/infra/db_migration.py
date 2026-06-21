"""Database migration orchestration — replaces ad-hoc create_all() and DEV DROP.

Provides a safe migration path:
1. If alembic is installed → check version → stamp new DBs → auto-upgrade if
   ``FIN_AGENT_AUTO_MIGRATE=1``.
2. If alembic is NOT installed → fall back to ``Base.metadata.create_all()``
   with a loud warning.

This module is intentionally thin; all heavy lifting is delegated to Alembic.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from sqlalchemy import Engine, inspect, text

from src.main.infra.errors import ConfigError

# ── Alembic optional import ──
try:
    from alembic import command as alembic_cmd
    from alembic.config import Config as AlembicConfig

    _ALEMBIC_AVAILABLE = True
except ImportError:  # pragma: no cover
    _ALEMBIC_AVAILABLE = False


# Baseline revision hard-coded to match the first migration file.
# When models change, generate a new migration with ``alembic revision --autogenerate``.
_BASELINE_REVISION = "001_initial_baseline"


def _alembic_ini_path() -> Path:
    """Resolve the project-root alembic.ini."""
    # This file lives in src/main/infra/, project root is 3 levels up.
    return Path(__file__).resolve().parents[3] / "alembic.ini"


def _has_alembic_version_table(engine: Engine) -> bool:
    """Return True if the alembic_version table already exists."""
    inspector = inspect(engine)
    return "alembic_version" in inspector.get_table_names()


def _get_current_revision(engine: Engine) -> str | None:
    """Return the current alembic revision stored in the DB, or None."""
    with engine.connect() as conn:
        result = conn.execute(text("SELECT version_num FROM alembic_version"))
        row = result.fetchone()
        return row[0] if row else None


def _run_stamp(engine: Engine, revision: str) -> None:
    """Stamp an empty database with the given revision (no DDL executed)."""
    ini_path = _alembic_ini_path()
    if not ini_path.exists():
        raise ConfigError(
            "alembic.ini not found; cannot stamp database.",
            details={"expected_path": str(ini_path)},
        )

    cfg = AlembicConfig(str(ini_path))
    cfg.set_main_option("sqlalchemy.url", str(engine.url))
    alembic_cmd.stamp(cfg, revision)


def _run_upgrade(engine: Engine) -> None:
    """Run ``alembic upgrade head`` programmatically."""
    ini_path = _alembic_ini_path()
    if not ini_path.exists():
        raise ConfigError(
            "alembic.ini not found; cannot run migrations.",
            details={"expected_path": str(ini_path)},
        )

    cfg = AlembicConfig(str(ini_path))
    cfg.set_main_option("sqlalchemy.url", str(engine.url))
    alembic_cmd.upgrade(cfg, "head")


def check_and_apply_migrations(engine: Engine) -> None:
    """Ensure the database schema is at the correct revision.

    Flow:
    1. If alembic is missing → warning + fallback to ``create_all``.
    2. If alembic_version table missing → database is new → stamp baseline
       (tables are assumed to be created by the first migration).
    3. If alembic_version exists but revision is stale:
       - ``FIN_AGENT_AUTO_MIGRATE=1`` → auto-upgrade.
       - Otherwise → raise ``ConfigError`` so the operator must run
         ``alembic upgrade head`` manually.
    """
    # ── Fallback: alembic not installed ──
    if not _ALEMBIC_AVAILABLE:
        print(
            "[WARN] alembic is not installed. Falling back to "
            "Base.metadata.create_all() which cannot handle column changes, "
            "renames, or deletions. Install alembic and run "
            "'alembic upgrade head' for safe schema management."
        )
        from src.main.infra.db import Base

        Base.metadata.create_all(bind=engine)
        return

    # ── Fresh database ──
    if not _has_alembic_version_table(engine):
        print(f"[DB] New database detected; stamping baseline revision {_BASELINE_REVISION}")
        _run_stamp(engine, _BASELINE_REVISION)
        # After stamping, run upgrade in case baseline was already superseded
        # by newer migrations.
        _run_upgrade(engine)
        print("[DB] Migrations applied successfully (new DB).")
        return

    # ── Existing database with version recorded ──
    current = _get_current_revision(engine)
    # Determine head revision programmatically
    ini_path = _alembic_ini_path()
    cfg = AlembicConfig(str(ini_path))
    cfg.set_main_option("sqlalchemy.url", str(engine.url))

    # Use alembic script directory to find the head revision
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(cfg)
    head = script.get_current_head()

    if current == head:
        print(f"[DB] Schema is up to date (revision={current}).")
        return

    # ── Stale revision ──
    auto_migrate = os.environ.get("FIN_AGENT_AUTO_MIGRATE", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }
    if auto_migrate:
        print(f"[DB] Schema stale ({current} → {head}); auto-upgrading …")
        _run_upgrade(engine)
        print("[DB] Migrations applied successfully (auto-upgrade).")
        return

    raise ConfigError(
        f"Database schema is out of date (current={current}, head={head}). "
        f"Run 'alembic upgrade head' or set FIN_AGENT_AUTO_MIGRATE=1 to auto-apply.",
        details={
            "current_revision": current,
            "head_revision": head,
            "fix": "alembic upgrade head",
        },
    )
