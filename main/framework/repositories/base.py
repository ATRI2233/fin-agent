"""Generic Repository base class for SQLAlchemy ORM models.

Receives a Session via constructor (DI-friendly). Does NOT manage
transactions - caller controls when to commit/rollback.

Concrete repositories (AgentRepository, WorkflowRepository, etc.)
should extend this class and add domain-specific queries.
"""

from __future__ import annotations
from typing import Generic, TypeVar, Type, Optional, List, Any
from sqlalchemy.orm import Session

T = TypeVar("T")


class BaseRepository(Generic[T]):
    """Generic CRUD repository.

    Transaction management: this class does NOT commit/rollback.
    The caller (Service or API handler) owns transaction boundaries.

    Usage:
        with UnitOfWork() as uow:
            repo = AgentRepository(uow.db)
            agent = repo.create(name="foo")
            # uow commits on __exit__ if no exception
    """

    def __init__(self, model: Type[T], db: Session):
        self._model = model
        self._db = db

    def get(self, id: str) -> Optional[T]:
        """Get entity by primary key."""
        return self._db.get(self._model, id)

    def list(self, limit: int = 100, offset: int = 0, **filters: Any) -> List[T]:
        """List entities with optional filters."""
        query = self._db.query(self._model)
        for key, value in filters.items():
            if hasattr(self._model, key):
                query = query.filter(getattr(self._model, key) == value)
        return query.limit(limit).offset(offset).all()

    def create(self, **kwargs: Any) -> T:
        """Create new entity. Does NOT commit."""
        entity = self._model(**kwargs)
        self._db.add(entity)
        self._db.flush()
        return entity

    def update(self, id: str, **kwargs: Any) -> Optional[T]:
        """Update entity by id. Does NOT commit."""
        entity = self.get(id)
        if entity is None:
            return None
        for key, value in kwargs.items():
            if hasattr(entity, key):
                setattr(entity, key, value)
        self._db.flush()
        return entity

    def delete(self, id: str) -> bool:
        """Delete entity by id. Does NOT commit."""
        entity = self.get(id)
        if entity is None:
            return False
        self._db.delete(entity)
        self._db.flush()
        return True

    def count(self, **filters: Any) -> int:
        """Count entities matching filters."""
        query = self._db.query(self._model)
        for key, value in filters.items():
            if hasattr(self._model, key):
                query = query.filter(getattr(self._model, key) == value)
        return query.count()

    def exists(self, id: str) -> bool:
        """Check if entity exists."""
        return self._db.query(self._model).filter_by(id=id).first() is not None
