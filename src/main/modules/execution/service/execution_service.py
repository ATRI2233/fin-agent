"""SQLAlchemy implementation of ``ExecutionRecorder`` (async, write-side).

Every record_* method opens a fresh ``UnitOfWork`` via the injected
``UoWFactory`` and operates on the ORM session inside the ``with`` block.
The UoW ``__exit__`` handles commit/rollback automatically — successful
exit commits, raised exceptions roll back. **Never** catch
``SQLAlchemyError`` and silently drop it: every DB failure is translated
to :class:`src.main.infra.errors.DatabaseError` and propagated so that
``WorkflowRunner`` (TASK-309) sees it.

Design contract:
    - All 7 Protocol methods are ``async`` (write-side IO, awaited by
      the workflow runner).
    - ``trace_id`` is an explicit positional parameter on every method;
      the recorder does **not** implicitly read ``current_trace_id()``.
    - Status transitions go through ``transition()`` to enforce the
      legal-transitions table (REVISION_NOTES_2026-06-18 修订 T-4).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.exc import SQLAlchemyError

from src.main.infra.domain import (
    ExecutionId,
    NodeId,
    SessionId,
    TraceId,
    WorkflowId,
)
from src.main.infra.errors import DatabaseError, FinAgentError
from src.main.infra.uow import UoWFactory
from src.main.modules.execution.domain.execution_node import (
    ExecutionStatus,
    transition,
)
from src.main.modules.execution.protocol import ExecutionRecorder
from src.main.modules.execution.repo.orm import (
    ExecutionLogORM,
    ExecutionNodeORM,
    WorkflowExecutionORM,
)


def _now() -> datetime:
    """UTC ``datetime`` for ``created_at`` / ``started_at`` / ``completed_at``."""
    return datetime.now(timezone.utc)


class SqlAlchemyExecutionRecorder(ExecutionRecorder):
    """Async SQLAlchemy writer for execution state.

    Constructed with a :class:`UoWFactory`; each ``record_*`` method
    opens its own UoW so that each write is a discrete transaction.
    """

    def __init__(self, uow_factory: UoWFactory) -> None:
        self._uow = uow_factory

    # ── helpers (private) ──

    @staticmethod
    def _new_id() -> str:
        """Generate a fresh UUID4 string ID."""
        return str(uuid.uuid4())

    def _wrap(self, exc: SQLAlchemyError, op: str, **details: Any) -> DatabaseError:
        """Translate a SQLAlchemy failure into a structured DatabaseError."""
        return DatabaseError(
            f"execution recorder failed: {op}",
            details=details,
            cause=exc,
        )

    # ── ExecutionRecorder (7 async methods) ──

    async def create_execution(
        self,
        workflow_id: WorkflowId,
        params: dict[str, Any],
        trace_id: TraceId,
    ) -> ExecutionId:
        """Insert a new ``workflow_executions`` row in PENDING.

        Args:
            workflow_id: Owning workflow ID.
            params: Trigger payload (validated upstream).
            trace_id: Audit/trace ID for this execution.

        Returns:
            The newly minted :class:`ExecutionId`.

        Raises:
            DatabaseError: on any DB failure.
        """
        execution_id = ExecutionId(self._new_id())
        with self._uow.begin() as uow:
            try:
                uow.session.add(
                    WorkflowExecutionORM(
                        id=str(execution_id),
                        workflow_id=str(workflow_id),
                        status=ExecutionStatus.PENDING.value,
                        params=params,
                        trace_id=str(trace_id),
                        created_at=_now(),
                        started_at=None,
                        completed_at=None,
                    )
                )
                uow.session.add(
                    ExecutionLogORM(
                        id=self._new_id(),
                        execution_id=str(execution_id),
                        node_id=None,
                        agent_name=None,
                        event="execution.created",
                        payload={"workflow_id": str(workflow_id)},
                        trace_id=str(trace_id),
                        created_at=_now(),
                    )
                )
            except SQLAlchemyError as exc:
                raise self._wrap(
                    exc,
                    "create_execution",
                    workflow_id=str(workflow_id),
                    trace_id=str(trace_id),
                ) from exc
        return execution_id

    async def record_node_started(
        self,
        execution_id: ExecutionId,
        node_id: NodeId,
        trace_id: TraceId,
    ) -> None:
        """Transition the node PENDING → RUNNING and stamp ``started_at``.

        The :func:`transition` helper enforces the legal-transitions
        table; an illegal transition (e.g. trying to start a COMPLETED
        node) raises :class:`InvalidStateTransitionError`, which
        naturally propagates as a ``SystemError``.

        Args:
            execution_id: Owning execution ID.
            node_id: Node being started.
            trace_id: Audit/trace ID.

        Raises:
            DatabaseError: on any DB failure.
        """
        with self._uow.begin() as uow:
            try:
                row = (
                    uow.session.query(ExecutionNodeORM)
                    .filter(
                        ExecutionNodeORM.execution_id == str(execution_id),
                        ExecutionNodeORM.node_id == str(node_id),
                    )
                    .one_or_none()
                )
                if row is not None:
                    transition(
                        ExecutionStatus(row.status),
                        ExecutionStatus.RUNNING,
                    )
                    row.status = ExecutionStatus.RUNNING.value
                    row.started_at = _now()
                uow.session.add(
                    ExecutionLogORM(
                        id=self._new_id(),
                        execution_id=str(execution_id),
                        node_id=str(node_id),
                        agent_name=None,
                        event="node.started",
                        payload={},
                        trace_id=str(trace_id),
                        created_at=_now(),
                    )
                )
            except SQLAlchemyError as exc:
                raise self._wrap(
                    exc,
                    "record_node_started",
                    execution_id=str(execution_id),
                    node_id=str(node_id),
                    trace_id=str(trace_id),
                ) from exc

    async def record_node_completed(
        self,
        execution_id: ExecutionId,
        node_id: NodeId,
        output: dict[str, Any],
        session_id: SessionId | None,
        trace_id: TraceId,
    ) -> None:
        """Transition the node RUNNING → COMPLETED and persist ``output``.

        Args:
            execution_id: Owning execution ID.
            node_id: Node being completed.
            output: Structured output produced by the node.
            session_id: Optional session linkage.
            trace_id: Audit/trace ID.

        Raises:
            DatabaseError: on any DB failure.
        """
        with self._uow.begin() as uow:
            try:
                row = (
                    uow.session.query(ExecutionNodeORM)
                    .filter(
                        ExecutionNodeORM.execution_id == str(execution_id),
                        ExecutionNodeORM.node_id == str(node_id),
                    )
                    .one_or_none()
                )
                if row is not None:
                    transition(
                        ExecutionStatus(row.status),
                        ExecutionStatus.COMPLETED,
                    )
                    row.status = ExecutionStatus.COMPLETED.value
                    row.output = output
                    row.session_id = str(session_id) if session_id is not None else None
                    row.completed_at = _now()
                uow.session.add(
                    ExecutionLogORM(
                        id=self._new_id(),
                        execution_id=str(execution_id),
                        node_id=str(node_id),
                        agent_name=None,
                        event="node.completed",
                        payload={"output_keys": sorted(output.keys())},
                        trace_id=str(trace_id),
                        created_at=_now(),
                    )
                )
            except SQLAlchemyError as exc:
                raise self._wrap(
                    exc,
                    "record_node_completed",
                    execution_id=str(execution_id),
                    node_id=str(node_id),
                    trace_id=str(trace_id),
                ) from exc

    async def record_node_failed(
        self,
        execution_id: ExecutionId,
        node_id: NodeId,
        error: FinAgentError,
        trace_id: TraceId,
    ) -> None:
        """Transition the node RUNNING → FAILED and persist the structured error.

        The :class:`FinAgentError` is flattened into ``code`` / ``message``
        / ``details`` for the ``error`` TEXT column and replicated into
        the log payload for downstream auditing.

        Args:
            execution_id: Owning execution ID.
            node_id: Node that failed.
            error: Structured exception (must be a :class:`FinAgentError`).
            trace_id: Audit/trace ID.

        Raises:
            DatabaseError: on any DB failure.
        """
        error_payload = {
            "code": int(error.code),
            "message": error.message,
            "details": error.details or {},
        }
        error_text = f"{int(error.code)}: {error.message}"
        with self._uow.begin() as uow:
            try:
                row = (
                    uow.session.query(ExecutionNodeORM)
                    .filter(
                        ExecutionNodeORM.execution_id == str(execution_id),
                        ExecutionNodeORM.node_id == str(node_id),
                    )
                    .one_or_none()
                )
                if row is not None:
                    transition(
                        ExecutionStatus(row.status),
                        ExecutionStatus.FAILED,
                    )
                    row.status = ExecutionStatus.FAILED.value
                    row.error = error_text
                    row.completed_at = _now()
                uow.session.add(
                    ExecutionLogORM(
                        id=self._new_id(),
                        execution_id=str(execution_id),
                        node_id=str(node_id),
                        agent_name=None,
                        event="node.failed",
                        payload=error_payload,
                        trace_id=str(trace_id),
                        created_at=_now(),
                    )
                )
            except SQLAlchemyError as exc:
                raise self._wrap(
                    exc,
                    "record_node_failed",
                    execution_id=str(execution_id),
                    node_id=str(node_id),
                    trace_id=str(trace_id),
                ) from exc

    async def record_node_skipped(
        self,
        execution_id: ExecutionId,
        node_id: NodeId,
        trace_id: TraceId,
    ) -> None:
        """Transition the node PENDING → SKIPPED (terminal per 修订 T-4).

        Args:
            execution_id: Owning execution ID.
            node_id: Node being skipped.
            trace_id: Audit/trace ID.

        Raises:
            DatabaseError: on any DB failure.
        """
        with self._uow.begin() as uow:
            try:
                row = (
                    uow.session.query(ExecutionNodeORM)
                    .filter(
                        ExecutionNodeORM.execution_id == str(execution_id),
                        ExecutionNodeORM.node_id == str(node_id),
                    )
                    .one_or_none()
                )
                if row is not None:
                    transition(
                        ExecutionStatus(row.status),
                        ExecutionStatus.SKIPPED,
                    )
                    row.status = ExecutionStatus.SKIPPED.value
                    row.completed_at = _now()
                uow.session.add(
                    ExecutionLogORM(
                        id=self._new_id(),
                        execution_id=str(execution_id),
                        node_id=str(node_id),
                        agent_name=None,
                        event="node.skipped",
                        payload={},
                        trace_id=str(trace_id),
                        created_at=_now(),
                    )
                )
            except SQLAlchemyError as exc:
                raise self._wrap(
                    exc,
                    "record_node_skipped",
                    execution_id=str(execution_id),
                    node_id=str(node_id),
                    trace_id=str(trace_id),
                ) from exc

    async def mark_execution(
        self,
        execution_id: ExecutionId,
        status: ExecutionStatus,
        trace_id: TraceId,
    ) -> None:
        """Move the execution itself into the given terminal state.

        Only terminal statuses are accepted at the call site; the
        runner enforces this. We still record the transition through
        :func:`transition` for symmetry with node transitions.

        Args:
            execution_id: Target execution ID.
            status: Terminal :class:`ExecutionStatus`.
            trace_id: Audit/trace ID.

        Raises:
            DatabaseError: on any DB failure.
        """
        with self._uow.begin() as uow:
            try:
                row = (
                    uow.session.query(WorkflowExecutionORM)
                    .filter(WorkflowExecutionORM.id == str(execution_id))
                    .one_or_none()
                )
                if row is not None:
                    transition(ExecutionStatus(row.status), status)
                    row.status = status.value
                    if status in (
                        ExecutionStatus.COMPLETED,
                        ExecutionStatus.FAILED,
                        ExecutionStatus.CLEANED_UP,
                    ):
                        row.completed_at = _now()
                uow.session.add(
                    ExecutionLogORM(
                        id=self._new_id(),
                        execution_id=str(execution_id),
                        node_id=None,
                        agent_name=None,
                        event="execution.status_changed",
                        payload={"status": status.value},
                        trace_id=str(trace_id),
                        created_at=_now(),
                    )
                )
            except SQLAlchemyError as exc:
                raise self._wrap(
                    exc,
                    "mark_execution",
                    execution_id=str(execution_id),
                    target_status=status.value,
                    trace_id=str(trace_id),
                ) from exc

    async def mark_downstream_skipped(
        self,
        execution_id: ExecutionId,
        failed_node_id: NodeId,
        trace_id: TraceId,
    ) -> list[NodeId]:
        """Mark every node downstream of ``failed_node_id`` as SKIPPED.

        Downstream nodes are detected by inspecting the ``input`` field
        of every node in this execution: a node whose ``input`` dict
        carries a reference to ``failed_node_id`` is considered a
        downstream consumer. This avoids the workflow module needing to
        hand us a reverse adjacency list (REVISION T-1: execution module
        is DAG-agnostic). For richer DAG awareness, callers may fall
        back to the workflow module.

        Args:
            execution_id: Owning execution ID.
            failed_node_id: The node whose failure triggered the cascade.
            trace_id: Audit/trace ID.

        Returns:
            List of :class:`NodeId` actually marked SKIPPED, in
            stable order (sorted by ``node_id``).

        Raises:
            DatabaseError: on any DB failure.
        """
        with self._uow.begin() as uow:
            try:
                # Candidate nodes = everything in this execution whose
                # status is still PENDING (RUNNING nodes are also
                # candidates; COMPLETED/FAILED/SKIPPED/CLEANED_UP are
                # not — they are terminal and we must not resurrect
                # them). Filter further by whether their ``input`` field
                # references the failed node.
                rows = (
                    uow.session.query(ExecutionNodeORM)
                    .filter(
                        ExecutionNodeORM.execution_id == str(execution_id),
                        ExecutionNodeORM.node_id != str(failed_node_id),
                        ExecutionNodeORM.status.in_(
                            [
                                ExecutionStatus.PENDING.value,
                            ]
                        ),
                    )
                    .all()
                )
                skipped_ids: list[NodeId] = []
                to_process = [str(failed_node_id)]
                processed: set[str] = set()

                while to_process:
                    current = to_process.pop()
                    if current in processed:
                        continue
                    processed.add(current)

                    # Find all PENDING nodes whose input references current
                    rows = (
                        uow.session.query(ExecutionNodeORM)
                        .filter(
                            ExecutionNodeORM.execution_id == str(execution_id),
                            ExecutionNodeORM.node_id != str(failed_node_id),
                            ExecutionNodeORM.node_id.notin_(set(skipped_ids)),
                            ExecutionNodeORM.status == ExecutionStatus.PENDING.value,
                        )
                        .all()
                    )
                    for row in rows:
                        if _input_references(row.input, current):
                            transition(
                                ExecutionStatus(row.status),
                                ExecutionStatus.SKIPPED,
                            )
                            row.status = ExecutionStatus.SKIPPED.value
                            row.completed_at = _now()
                            nid = NodeId(row.node_id)
                            skipped_ids.append(nid)
                            to_process.append(str(nid))

                # Stable order: sort by node_id so the returned list is
                # deterministic regardless of DB row order.
                skipped_ids.sort(key=str)

                uow.session.add(
                    ExecutionLogORM(
                        id=self._new_id(),
                        execution_id=str(execution_id),
                        node_id=str(failed_node_id),
                        agent_name=None,
                        event="execution.downstream_skipped",
                        payload={
                            "failed_node_id": str(failed_node_id),
                            "node_ids": [str(n) for n in skipped_ids],
                        },
                        trace_id=str(trace_id),
                        created_at=_now(),
                    )
                )
                return skipped_ids
            except SQLAlchemyError as exc:
                raise self._wrap(
                    exc,
                    "mark_downstream_skipped",
                    execution_id=str(execution_id),
                    failed_node_id=str(failed_node_id),
                    trace_id=str(trace_id),
                ) from exc


def _input_references(input_payload: dict[str, Any], node_id: str) -> bool:
    """Return True if ``input_payload`` mentions ``node_id`` anywhere.

    Walks the payload recursively and checks for the string anywhere a
    dict value, list element, or stringified scalar can be observed.
    This is intentionally lenient — false positives are safe (an extra
    SKIPPED node is harmless) and false negatives would silently break
    the cascade.
    """
    if input_payload is None:
        return False
    return _walk(input_payload, node_id)


def _walk(value: Any, needle: str) -> bool:
    """Recursive containment check used by :func:`_input_references`."""
    if isinstance(value, dict):
        for k, v in value.items():
            if k == needle:
                return True
            if _walk(v, needle):
                return True
        return False
    if isinstance(value, (list, tuple, set)):
        return any(_walk(v, needle) for v in value)
    if isinstance(value, str):
        return value == needle
    return False


__all__ = ["SqlAlchemyExecutionRecorder"]