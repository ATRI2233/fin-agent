"""SQLAlchemy engine and session factory — single DB entry point.

All modules obtain their session via ``get_session_local()`` and never
import a module-level engine or session singleton.
"""

from __future__ import annotations

from sqlalchemy import create_engine as _sa_create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from src.main.infra.settings import Settings


class Base(DeclarativeBase):
    """Base class for all ORM models (SQLAlchemy 2.0 declarative style)."""

    pass


def configure_sqlite(connection, connection_record) -> None:
    """Configure SQLite connection with recommended PRAGMAs.

    Applied on every new connection via the SQLAlchemy ``connect`` event.

    Parameters
    ----------
    connection : sqlalchemy.engine.Connection
        The raw DB-API connection being opened.
    connection_record : object
        The connection record from the pool (unused but required by the event
        listener signature).
    """
    connection.execute(f"PRAGMA journal_mode={Settings().DB_JOURNAL_MODE}")
    connection.execute(f"PRAGMA busy_timeout={Settings().DB_BUSY_TIMEOUT_MS}")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute("PRAGMA foreign_keys=ON")


def create_engine(settings: Settings) -> Engine:
    """Create a SQLAlchemy Engine from the provided *settings*.

    The engine is configured with:

    - ``pool_size`` from *settings*.
    - ``max_overflow`` from *settings*.
    - ``pool_timeout`` from *settings*.
    - ``pool_pre_ping`` from *settings*.
    - ``check_same_thread=False`` (SQLite requirement for shared-thread access).
    - ``timeout`` from ``settings.DB_BUSY_TIMEOUT_MS``, converted to seconds.
    - A ``connect`` event listener that applies WAL + busy_timeout + synchronous
      + foreign_keys PRAGMAs using the given *settings* values.

    Parameters
    ----------
    settings : Settings
        Application settings containing ``DATABASE_URL``, ``DB_POOL_SIZE``,
        ``DB_POOL_MAX_OVERFLOW``, ``DB_POOL_TIMEOUT``, ``DB_POOL_PRE_PING``,
        and ``DB_BUSY_TIMEOUT_MS``.

    Returns
    -------
    Engine
        A fully configured SQLAlchemy engine.
    """
    timeout_seconds = settings.DB_BUSY_TIMEOUT_MS / 1000

    engine = _sa_create_engine(
        settings.DATABASE_URL,
        pool_size=settings.DB_POOL_SIZE,
        max_overflow=settings.DB_POOL_MAX_OVERFLOW,
        pool_timeout=settings.DB_POOL_TIMEOUT,
        pool_pre_ping=settings.DB_POOL_PRE_PING,
        connect_args={
            "check_same_thread": False,
            "timeout": timeout_seconds,
        },
    )

    # Closure captures the caller's settings instance so the PRAGMA values
    # reflect the caller's configuration (not a freshly-constructed default).
    def _on_connect(connection, connection_record) -> None:
        connection.execute(f"PRAGMA journal_mode={settings.DB_JOURNAL_MODE}")
        connection.execute(f"PRAGMA busy_timeout={settings.DB_BUSY_TIMEOUT_MS}")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute("PRAGMA foreign_keys=ON")

    event.listen(engine, "connect", _on_connect)
    return engine


def get_session_local(engine: Engine) -> sessionmaker[Session]:
    """Create a ``sessionmaker`` bound to *engine*.

    The returned callable produces ``Session`` instances with
    ``expire_on_commit=False``, allowing detached objects to remain
    usable after the transaction commits.

    Parameters
    ----------
    engine : Engine
        The SQLAlchemy engine to bind.

    Returns
    -------
    sessionmaker[Session]
        A factory callable that yields ``Session`` instances.
    """
    return sessionmaker(bind=engine, expire_on_commit=False)
