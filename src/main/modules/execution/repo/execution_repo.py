"""SQLAlchemy implementation of ``ExecutionStateReader`` (sync, read-only).

The reader does **not** open a UnitOfWork: read-side queries do not need a
transaction, so we use the bare ``Session`` from the injected
``session_factory`` directly. This keeps the read path cheap and avoids
holding a connection longer than necessary.

Each query method converts ORM rows into the corresponding domain
dataclass (:class:`WorkflowExecution` or :class:`ExecutionNode`); the
caller never sees SQLAlchemy types.
"""

from __future__ import annotations

from typing import Callable

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from src.main.infra.domain import (
    AgentReference,
    ExecutionId,
    NodeId,
    WorkflowId,
)
from src.main.infra.errors import DatabaseError
from src.main.modules.execution.domain.execution import WorkflowExecution
from src.main.modules.execution.domain.execution_node import (
    ExecutionNode,
    ExecutionStatus,
)
from src.main.modules.execution.protocol import ExecutionStateReader
from src.main.modules.execution.repo.orm import (
    ExecutionNodeORM,
    WorkflowExecutionORM,
)


def _to_execution(row: WorkflowExecutionORM) -> WorkflowExecution:
    """Convert a ``WorkflowExecutionORM`` row to the domain dataclass."""
    return WorkflowExecution(
        id=ExecutionId(row.id),
        workflow_id=WorkflowId(row.workflow_id),
        status=ExecutionStatus(row.status),
        params=row.params,
        trace_id=row.trace_id,  # type: ignore[arg-type]
        created_at=row.created_at,
        started_at=row.started_at,
        completed_at=row.completed_at,
    )


def _to_node(row: ExecutionNodeORM) -> ExecutionNode:
    """Convert an ``ExecutionNodeORM`` row to the domain dataclass."""
    return ExecutionNode(
        node_id=NodeId(row.node_id),
        agent=AgentReference(name=row.agent, definition_path=None),
        status=ExecutionStatus(row.status),
        input=row.input,
        output=row.output,
        session_id=row.session_id,  # type: ignore[arg-type]
        error=row.error,
        started_at=row.started_at,
        completed_at=row.completed_at,
        retry_count=row.retry_count,
    )


class SqlAlchemyExecutionReader(ExecutionStateReader):
    """Sync SQLAlchemy reader for execution state.

    Constructed with a ``sessionmaker``-compatible callable (``() ->
    Session``). Each query opens its own session and closes it when done
    — no UoW is involved because read operations do not require a
    transaction boundary.

    Implements the 5 sync methods declared by
    :class:`src.main.modules.execution.protocol.ExecutionStateReader`.
    """

    def __init__(self, session_factory: Callable[[], Session] | sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    # ── read helpers (private) ──

    def _open(self) -> Session:
        """Open a new session (caller is responsible for closing it)."""
        return self._session_factory()

    # ── ExecutionStateReader ──

    def get_execution(self, execution_id: ExecutionId) -> WorkflowExecution | None:
        """Fetch a single execution by id.

        Args:
            execution_id: Target execution ID.

        Returns:
            The matching :class:`WorkflowExecution`, or ``None`` if no
            row exists.

        Raises:
            DatabaseError: on any underlying SQLAlchemy failure.
        """
        session: Session = self._open()
        try:
            row = (
                session.query(WorkflowExecutionORM)
                .filter(WorkflowExecutionORM.id == execution_id)
                .one_or_none()
            )
            if row is None:
                return None
            return _to_execution(row)
        except SQLAlchemyError as exc:
            raise DatabaseError(
                "failed to load workflow execution",
                details={"execution_id": str(execution_id)},
                cause=exc,
            ) from exc
        finally:
            session.close()

    def get_execution_nodes(self, execution_id: ExecutionId) -> list[ExecutionNode]:
        """Fetch all nodes belonging to one execution.

        Args:
            execution_id: Target execution ID.

        Returns:
            List of :class:`ExecutionNode` (empty if execution has no
            node rows yet).

        Raises:
            DatabaseError: on any underlying SQLAlchemy failure.
        """
        session: Session = self._open()
        try:
            rows = (
                session.query(ExecutionNodeORM)
                .filter(ExecutionNodeORM.execution_id == execution_id)
                .all()
            )
            return [_to_node(r) for r in rows]
        except SQLAlchemyError as exc:
            raise DatabaseError(
                "failed to load execution nodes",
                details={"execution_id": str(execution_id)},
                cause=exc,
            ) from exc
        finally:
            session.close()

    def get_failed_nodes(self, execution_id: ExecutionId) -> list[ExecutionNode]:
        """Fetch all FAILED nodes of one execution.

        Args:
            execution_id: Target execution ID.

        Returns:
            List of :class:`ExecutionNode` whose status is FAILED
            (empty if none).

        Raises:
            DatabaseError: on any underlying SQLAlchemy failure.
        """
        session: Session = self._open()
        try:
            rows = (
                session.query(ExecutionNodeORM)
                .filter(
                    ExecutionNodeORM.execution_id == execution_id,
                    ExecutionNodeORM.status == ExecutionStatus.FAILED.value,
                )
                .all()
            )
            return [_to_node(r) for r in rows]
        except SQLAlchemyError as exc:
            raise DatabaseError(
                "failed to load failed nodes",
                details={"execution_id": str(execution_id)},
                cause=exc,
            ) from exc
        finally:
            session.close()

    def get_node(
        self,
        execution_id: ExecutionId,
        node_id: NodeId,
    ) -> ExecutionNode | None:
        """Fetch a single node within an execution.

        Args:
            execution_id: Owning execution ID.
            node_id: Target node ID.

        Returns:
            The matching :class:`ExecutionNode`, or ``None`` if no row
            exists.

        Raises:
            DatabaseError: on any underlying SQLAlchemy failure.
        """
        session: Session = self._open()
        try:
            row = (
                session.query(ExecutionNodeORM)
                .filter(
                    ExecutionNodeORM.execution_id == execution_id,
                    ExecutionNodeORM.node_id == node_id,
                )
                .one_or_none()
            )
            if row is None:
                return None
            return _to_node(row)
        except SQLAlchemyError as exc:
            raise DatabaseError(
                "failed to load execution node",
                details={
                    "execution_id": str(execution_id),
                    "node_id": str(node_id),
                },
                cause=exc,
            ) from exc
        finally:
            session.close()

    def list_executions(
        self,
        workflow_id: WorkflowId | None = None,
        *,
        limit: int,
        offset: int,
    ) -> list[WorkflowExecution]:
        """List executions, optionally filtered by workflow.

        Results are ordered by ``created_at`` descending (newest first),
        matching the Protocol contract.

        Args:
            workflow_id: If provided, restrict to this workflow.
            limit: Maximum number of rows to return.
            offset: Number of rows to skip (pagination).

        Returns:
            List of :class:`WorkflowExecution` (possibly empty).

        Raises:
            DatabaseError: on any underlying SQLAlchemy failure.
        """
        session: Session = self._open()
        try:
            query = session.query(WorkflowExecutionORM)
            if workflow_id is not None:
                query = query.filter(WorkflowExecutionORM.workflow_id == workflow_id)
            rows = (
                query.order_by(WorkflowExecutionORM.created_at.desc())
                .offset(offset)
                .limit(limit)
                .all()
            )
            return [_to_execution(r) for r in rows]
        except SQLAlchemyError as exc:
            raise DatabaseError(
                "failed to list executions",
                details={
                    "workflow_id": str(workflow_id) if workflow_id else None,
                    "limit": limit,
                    "offset": offset,
                },
                cause=exc,
            ) from exc
        finally:
            session.close()


# Re-export for callers that import helpers from this module.
__all__ = ["SqlAlchemyExecutionReader"]