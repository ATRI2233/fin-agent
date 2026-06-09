"""UnitOfWork pattern for cross-Repository transaction management."""

from typing import Optional
from sqlalchemy.orm import Session
from main.framework.config.database import SessionLocal


class UnitOfWork:
    """Context manager that provides a shared DB session.

    Usage:
        with UnitOfWork() as uow:
            agent_repo = AgentRepository(uow.db)
            agent = agent_repo.create(name="foo")
            # Commits on __exit__ if no exception
    """

    def __init__(self, db: Optional[Session] = None):
        self._external_db = db is not None
        self._db = db or SessionLocal()

    @property
    def db(self) -> Session:
        return self._db

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            self._db.rollback()
        else:
            self._db.commit()
        if not self._external_db:
            self._db.close()
        return False
