"""UnitOfWork pattern for cross-Repository transaction management."""


from main.framework.config.database import SessionLocal
from sqlalchemy.orm import Session


class UnitOfWork:
    """Context manager for cross-Repository transaction boundaries.

    Provides a shared SQLAlchemy session that multiple repositories can use
    within a single atomic transaction. On normal exit, commits all changes;
    on exception, rolls back everything.

    This is the intended companion to BaseRepository — repositories handle
    CRUD but do NOT commit; UnitOfWork owns the transaction boundary.

    When to use:
    - Multiple repositories need atomic commit (e.g., creating an Agent
      and its associated Workflow in one transaction)
    - Service-layer code that orchestrates several repository operations

    When NOT to use:
    - Single repository calls (the repository's internal session handles it)
    - Read-only queries (no transaction boundary needed)

    Usage:
        with UnitOfWork() as uow:
            agent_repo = AgentRepository(uow.db)
            workflow_repo = WorkflowRepository(uow.db)
            agent = agent_repo.create(name="foo")
            workflow = workflow_repo.create(agent_id=agent.id, name="bar")
            # Both committed atomically on __exit__

    Args:
        db: Optional existing Session. If None, creates a new one via SessionLocal().
    """

    def __init__(self, db: Session | None = None):
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
