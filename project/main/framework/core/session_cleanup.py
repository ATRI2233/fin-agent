"""Automatic session cleanup after workflow execution."""

from __future__ import annotations

import asyncio
import atexit
import logging
import signal
import sys
from typing import TYPE_CHECKING

from main.framework.models.workflow_execution import ExecutionNode

if TYPE_CHECKING:
    from collections.abc import Callable

    from sqlalchemy.orm import Session

    from main.framework.core.protocols import AgentBackend

logger = logging.getLogger(__name__)

# Global registry for active execution sessions
_active_sessions: dict[str, list[str]] = {}  # execution_id -> session_ids


def _run_async(coro):
    """Run an async coroutine from sync context."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, coro).result()
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


def cleanup_workflow_sessions(
    execution_id: str,
    backend: AgentBackend,
    session_factory: Callable[[], Session] | None = None,
) -> dict:
    """Cleanup all sessions for a workflow execution."""
    from main.framework.models.database import SessionLocal

    factory = session_factory or SessionLocal
    db = factory()
    try:
        exec_nodes = db.query(ExecutionNode).filter(ExecutionNode.execution_id == execution_id).all()

        session_ids: list[str] = []
        for node in exec_nodes:
            sid = str(node.session_id) if node.session_id else None
            if sid and sid.strip():
                session_ids.append(sid)

        if not session_ids:
            return {}

        results = _run_async(backend.cleanup_sessions(session_ids))

        for node in exec_nodes:
            if node.session_id:
                node.status = "cleaned_up"
        db.commit()

        logger.info(f"Cleaned up {len(session_ids)} sessions for execution {execution_id}")
        return results
    except Exception as e:
        logger.error(f"Failed to cleanup sessions for execution {execution_id}: {e}")
        db.rollback()
        raise
    finally:
        db.close()


def register_cleanup_hook(
    execution_id: str,
    backend: AgentBackend,
    session_factory: Callable[[], Session] | None = None,
) -> None:
    """Register atexit/signal cleanup for an execution."""

    def _cleanup():
        try:
            cleanup_workflow_sessions(execution_id, backend=backend, session_factory=session_factory)
            _active_sessions.pop(execution_id, None)
        except Exception as e:
            logger.error(f"Cleanup hook failed for {execution_id}: {e}")

    atexit.register(_cleanup)

    def _signal_handler(signum: int, frame) -> None:
        logger.info(f"Received signal {signum}, running cleanup for {execution_id}")
        _cleanup()
        sys.exit(0)

    try:
        signal.signal(signal.SIGTERM, _signal_handler)
        signal.signal(signal.SIGINT, _signal_handler)
    except (AttributeError, ValueError):
        pass


def cleanup_on_shutdown(
    backend: AgentBackend,
    session_factory: Callable[[], Session] | None = None,
) -> None:
    """Cleanup all active sessions on application shutdown."""
    from main.framework.models.database import SessionLocal

    factory = session_factory or SessionLocal
    db = factory()
    try:
        active_nodes = (
            db.query(ExecutionNode).filter(ExecutionNode.status.notin_(["cleaned_up", "failed", "skipped"])).all()
        )

        all_session_ids: list[str] = []
        for node in active_nodes:
            sid = str(node.session_id) if node.session_id else None
            if sid and sid.strip():
                all_session_ids.append(sid)

        if not all_session_ids:
            return

        _run_async(backend.cleanup_sessions(all_session_ids))

        for node in active_nodes:
            if node.session_id:
                node.status = "cleaned_up"
        db.commit()

        logger.info(f"Cleaned up {len(all_session_ids)} sessions on shutdown")
    except Exception as e:
        logger.error(f"Failed to cleanup sessions on shutdown: {e}")
        db.rollback()
        raise
    finally:
        db.close()


def register_execution_session(execution_id: str, session_ids: list[str]) -> None:
    _active_sessions[execution_id] = session_ids


def get_active_executions() -> dict[str, list[str]]:
    return _active_sessions.copy()
