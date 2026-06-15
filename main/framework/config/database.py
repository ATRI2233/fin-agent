"""Database configuration - migrated from main.framework.models.database."""

from collections.abc import Iterator
from contextlib import contextmanager

from main.framework.config.settings import Settings
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, declarative_base, sessionmaker

settings = Settings()

engine = create_engine(settings.DATABASE_URL, connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    """Enable WAL mode + busy_timeout + NORMAL synchronous on every new connection."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def get_session() -> Iterator[Session]:
    """Context manager for standalone DB sessions (background tasks, scripts).

    Use ``get_db()`` (FastAPI Depends) in request handlers;
    use ``get_session()`` everywhere else.

    Rolls back on exception to avoid dirty state in WAL.
    Callers should still call ``db.commit()`` explicitly before the block ends.
    """
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
