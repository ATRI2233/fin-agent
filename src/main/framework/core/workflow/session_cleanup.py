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

    from main.framework.core.infrastructure.protocols import AgentBackend
    from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Global registry for active execution sessions
_active_sessions: dict[str, list[str]] = {} # execution_id -> session_ids
_cleanup_hooks: list[Callable[[], None]] = [] # all registered cleanup hooks
_signal_installed: bool = False


def _run_async(coro):
    """Run an async coroutine from sync context.

    Uses nest_asyncio to allow nested event loops when one is already running.
    Falls back to a thread pool if nest_asyncio is not available.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # Running inside an existing event loop (e.g., FastAPI).
        # Use nest_asyncio to allow nested run_until_complete.
        try:
            import nest_asyncio
            nest_asyncio.apply()
            return loop.run_until_complete(coro)
        except ImportError:
            # Fallback: run in a new thread with its own event loop
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                return pool.submit(asyncio.run, coro).result(timeout=60)
    else:
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
    """Register atexit/signal cleanup for an execution.

    Supports multiple concurrent executions — all hooks run on signal/atexit.
    """
    global _signal_installed

    def _cleanup():
        try:
            cleanup_workflow_sessions(execution_id, backend=backend, session_factory=session_factory)
            _active_sessions.pop(execution_id, None)
        except Exception as e:
            logger.error(f"Cleanup hook failed for {execution_id}: {e}")

    _cleanup_hooks.append(_cleanup)
    atexit.register(_cleanup)

    # Install signal handlers once (not per-execution) to avoid overwriting
    if not _signal_installed:
        def _signal_handler(signum: int, frame) -> None:
            logger.info(f"Received signal {signum}, running all cleanup hooks")
            for hook in _cleanup_hooks:
                try:
                    hook()
                except Exception:
                    pass
            sys.exit(0)

        try:
            signal.signal(signal.SIGTERM, _signal_handler)
            signal.signal(signal.SIGINT, _signal_handler)
            _signal_installed = True
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
