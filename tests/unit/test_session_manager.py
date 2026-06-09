"""Unit tests for ConvSessionManager — mock-heavy, no real database.

Verifies the in-memory cache behaviour of ``core.session_manager.ConvSessionManager``
and the cleanup path against a mocked ``AgentBackend``.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, Mock

import pytest

from main.framework.core.protocols import AgentBackend
from main.framework.core.session_manager import ConvSessionManager

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_backend() -> MagicMock:
    """Mocked AgentBackend (the HAPI bridge / opencode backend)."""
    backend = MagicMock(spec=AgentBackend)
    backend.create_session = AsyncMock(return_value="session-new")
    backend.cleanup_sessions = AsyncMock(return_value={"session-new": "cleaned"})
    return backend


@pytest.fixture
def manager(mock_backend: MagicMock) -> ConvSessionManager:
    """Fresh ConvSessionManager with mocked backend."""
    return ConvSessionManager(backend=mock_backend)


# ---------------------------------------------------------------------------
# get_or_create_session
# ---------------------------------------------------------------------------


class TestGetOrCreateSession:
    """ConvSessionManager.get_or_create_session behaviour."""

    async def test_get_or_create_session_returns_cached(self, manager, mock_backend):
        """If conversation_id already in dict, return cached session_id (no backend call)."""
        # Pre-populate the cache
        manager._session_ids["conv-cached"] = "session-cached"

        session_id, backend = await manager.get_or_create_session("conv-cached")

        assert session_id == "session-cached"
        assert backend is mock_backend
        # Backend.create_session MUST NOT be called when we already have a cached entry
        mock_backend.create_session.assert_not_called()

    async def test_get_or_create_session_creates_new(self, manager, mock_backend):
        """Empty cache + no db → backend.create_session is called and result cached."""
        mock_backend.create_session.return_value = "session-fresh"

        session_id, backend = await manager.get_or_create_session(
            "conv-new",
            agent="fin-orchestrator",
        )

        assert session_id == "session-fresh"
        assert backend is mock_backend
        mock_backend.create_session.assert_awaited_once()
        # Verify the agent argument was forwarded
        _, kwargs = mock_backend.create_session.call_args
        assert kwargs.get("agent") == "fin-orchestrator"
        # Cache populated for next call
        assert manager._session_ids["conv-new"] == "session-fresh"

    async def test_get_or_create_session_default_agent(self, manager, mock_backend):
        """Default agent is 'opencode' when no agent kwarg provided."""
        mock_backend.create_session.return_value = "session-x"

        await manager.get_or_create_session("conv-x")

        _, kwargs = mock_backend.create_session.call_args
        assert kwargs.get("agent") == "opencode"


# ---------------------------------------------------------------------------
# cleanup_session
# ---------------------------------------------------------------------------


class TestCleanupSession:
    """ConvSessionManager.cleanup_session behaviour."""

    async def test_cleanup_session_removes_from_dict(self, manager, mock_backend):
        """Pre-populated entry is popped after cleanup."""
        manager._session_ids["conv-1"] = "session-1"

        result = await manager.cleanup_session("conv-1")

        assert result == "session-1"
        assert "conv-1" not in manager._session_ids
        mock_backend.cleanup_sessions.assert_awaited_once_with(["session-1"])

    async def test_cleanup_session_handles_missing(self, manager, mock_backend):
        """Empty dict + no db → returns None, no backend call."""
        result = await manager.cleanup_session("missing-conv")

        assert result is None
        mock_backend.cleanup_sessions.assert_not_called()

    async def test_cleanup_session_backend_failure_logs_warning(self, manager, mock_backend, caplog):
        """If backend.cleanup_sessions raises, the error is swallowed (warning logged)."""
        manager._session_ids["conv-err"] = "session-err"
        mock_backend.cleanup_sessions.side_effect = RuntimeError("hapi down")

        # Should not raise — defensive logging
        with caplog.at_level("WARNING"):
            result = await manager.cleanup_session("conv-err")

        # Even on backend failure, the session_id is returned (the dict-pop happens first)
        assert result == "session-err"
        assert "conv-err" not in manager._session_ids


# ---------------------------------------------------------------------------
# get_session_id
# ---------------------------------------------------------------------------


class TestGetSessionId:
    """ConvSessionManager.get_session_id behaviour (sync)."""

    def test_get_session_id_returns_value(self, manager):
        """Pre-populated entry returns the cached session_id."""
        manager._session_ids["conv-1"] = "session-1"

        assert manager.get_session_id("conv-1") == "session-1"

    def test_get_session_id_returns_none_for_unknown(self, manager):
        """Empty dict / unknown conversation → returns None."""
        assert manager.get_session_id("unknown") is None
        assert manager.get_session_id("anything") is None

    def test_get_session_id_after_cleanup_returns_none(self, manager):
        """After cleanup, get_session_id returns None for that conversation."""
        manager._session_ids["conv-1"] = "session-1"

        # Sanity check pre-cleanup
        assert manager.get_session_id("conv-1") == "session-1"

        # Remove via direct dict manipulation (sync — cleanup_session is async)
        manager._session_ids.pop("conv-1", None)

        assert manager.get_session_id("conv-1") is None
