"""Automatic session cleanup after workflow execution."""

import asyncio
import atexit
import logging
import signal
import sys
from typing import Callable

from main.framework.core.hapi_bridge import HAPIBridge
from main.framework.models.database import SessionLocal
from main.framework.models.workflow_execution import ExecutionNode
from main.framework.config import settings

logger = logging.getLogger(__name__)

# Global registry for active execution sessions
_active_sessions: dict[str, list[str]] = {}  # execution_id -> session_ids


def cleanup_workflow_sessions(execution_id: str) -> dict:
    """
    Cleanup all HAPI sessions for a workflow execution.

    Queries all ExecutionNode records for the execution, collects HAPI session IDs,
    calls HAPIBridge.cleanup_sessions(), and updates ExecutionNode status to 'cleaned_up'.

    Args:
        execution_id: The workflow execution ID

    Returns:
        dict with cleanup results keyed by session_id
    """
    db = SessionLocal()
    try:
        # Query all execution nodes for this execution
        exec_nodes = (
            db.query(ExecutionNode)
            .filter(ExecutionNode.execution_id == execution_id)
            .all()
        )

        # Collect all HAPI session IDs (exclude None/empty)
        session_ids: list[str] = []
        for node in exec_nodes:
            session_id = str(node.hapi_session_id) if node.hapi_session_id else None
            if session_id and session_id.strip():
                session_ids.append(session_id)

        if not session_ids:
            logger.debug(f"No sessions to cleanup for execution {execution_id}")
            return {}

        # Call HAPI bridge to cleanup sessions
        hapi = HAPIBridge(hub_url=settings.HAPI_HUB_URL)

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures

                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(
                        asyncio.run, hapi.cleanup_sessions(session_ids)
                    )
                    results = future.result()
            else:
                results = loop.run_until_complete(hapi.cleanup_sessions(session_ids))
        except RuntimeError:
            results = asyncio.run(hapi.cleanup_sessions(session_ids))

        # Update execution node status to 'cleaned_up'
        for node in exec_nodes:
            if node.hapi_session_id:
                node.status = "cleaned_up"

        db.commit()

        logger.info(
            f"Cleaned up {len(session_ids)} sessions for execution {execution_id}"
        )
        return results

    except Exception as e:
        logger.error(f"Failed to cleanup sessions for execution {execution_id}: {e}")
        db.rollback()
        raise

    finally:
        db.close()


def register_cleanup_hook(execution_id: str) -> None:
    """
    Register callback to cleanup sessions after WorkflowEngine.execute().

    Uses atexit-style cleanup to ensure cleanup runs even on crash.
    Must be called BEFORE WorkflowEngine.execute() to properly hook into execution.

    Args:
        execution_id: The workflow execution ID to cleanup later
    """

    def _cleanup():
        try:
            cleanup_workflow_sessions(execution_id)
            # Remove from active sessions registry
            _active_sessions.pop(execution_id, None)
        except Exception as e:
            logger.error(f"Cleanup hook failed for {execution_id}: {e}")

    # Register with atexit for normal exit
    atexit.register(_cleanup)

    # Register signal handlers for crash scenarios (Unix-style signals on Windows)
    def _signal_handler(signum: int, frame) -> None:
        logger.info(f"Received signal {signum}, running cleanup for {execution_id}")
        _cleanup()
        sys.exit(0)

    try:
        signal.signal(signal.SIGTERM, _signal_handler)
        signal.signal(signal.SIGINT, _signal_handler)
    except (AttributeError, ValueError):
        # Windows doesn't support SIGTERM/SIGINT in the same way
        pass


def cleanup_on_shutdown() -> None:
    """
    Cleanup all active sessions on application shutdown.

    Called from FastAPI shutdown event to ensure all HAPI sessions
    are properly cleaned up when the application terminates.
    """
    db = SessionLocal()
    try:
        # Find all active (non-cleaned_up) execution nodes
        active_nodes = (
            db.query(ExecutionNode)
            .filter(ExecutionNode.status.notin_(["cleaned_up", "failed", "skipped"]))
            .all()
        )

        # Collect all session IDs grouped by execution
        all_session_ids: list[str] = []
        for node in active_nodes:
            session_id = str(node.hapi_session_id) if node.hapi_session_id else None
            if session_id and session_id.strip():
                all_session_ids.append(session_id)

        if not all_session_ids:
            logger.debug("No active sessions to cleanup on shutdown")
            return

        # Cleanup all sessions
        hapi = HAPIBridge(hub_url=settings.HAPI_HUB_URL)

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures

                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(
                        asyncio.run, hapi.cleanup_sessions(all_session_ids)
                    )
                    future.result()
            else:
                loop.run_until_complete(hapi.cleanup_sessions(all_session_ids))
        except RuntimeError:
            asyncio.run(hapi.cleanup_sessions(all_session_ids))

        # Mark all as cleaned_up
        for node in active_nodes:
            if node.hapi_session_id:
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
    """
    Register an execution's sessions for later cleanup.

    Args:
        execution_id: The workflow execution ID
        session_ids: List of HAPI session IDs for this execution
    """
    _active_sessions[execution_id] = session_ids


def get_active_executions() -> dict[str, list[str]]:
    """
    Get all registered active executions and their sessions.

    Returns:
        dict mapping execution_id -> list of session_ids
    """
    return _active_sessions.copy()
