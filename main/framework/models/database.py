# Re-export from new location for backward compat
from sqlalchemy import ForeignKey, Table, create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

from main.framework.config import Settings
from main.framework.config.database import Base, SessionLocal, engine, get_db, get_session, init_db  # noqa: F401

settings = Settings()

engine = create_engine(settings.DATABASE_URL, connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    """Enable WAL mode + busy_timeout + NORMAL synchronous on every new connection.

    PRAGMA journal_mode=WAL is a persistent property of the database file,
    but it must be issued per-connection for SQLAlchemy connection pools.
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
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


def init_db():
    Base.metadata.create_all(bind=engine)
