"""Unit tests for ConversationRepository."""

from __future__ import annotations

import uuid

import pytest

from main.framework.models.conversation import Conversation, Message
from main.framework.repositories.conversation_repo import ConversationRepository

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_conv(db, **overrides) -> Conversation:
    """Create and flush a Conversation with sensible defaults."""
    defaults = {"id": str(uuid.uuid4()), "title": "Test Conv"}
    defaults.update(overrides)
    conv = Conversation(**defaults)
    db.add(conv)
    db.flush()
    return conv


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestCreateAndGet:
    """Basic CRUD inherited from BaseRepository."""

    def test_create_conversation(self, db_session):
        repo = ConversationRepository(db_session)
        conv = repo.create(id=str(uuid.uuid4()), title="Hello")
        assert conv.id is not None
        assert conv.title == "Hello"

    def test_get_conversation(self, db_session):
        repo = ConversationRepository(db_session)
        created = repo.create(id=str(uuid.uuid4()), title="Lookup")
        fetched = repo.get(created.id)
        assert fetched is not None
        assert fetched.title == "Lookup"

    def test_get_nonexistent_returns_none(self, db_session):
        repo = ConversationRepository(db_session)
        assert repo.get("no-such-id") is None


class TestAddMessage:
    """ConversationRepository.add_message behaviour."""

    def test_add_message_returns_message(self, db_session):
        repo = ConversationRepository(db_session)
        conv = _make_conv(db_session)
        msg = repo.add_message(conv.id, "user", "hello")
        assert isinstance(msg, Message)
        assert msg.conversation_id == conv.id
        assert msg.role == "user"
        assert msg.content == "hello"

    def test_add_message_with_optional_fields(self, db_session):
        repo = ConversationRepository(db_session)
        conv = _make_conv(db_session)
        msg = repo.add_message(
            conv.id,
            "assistant",
            "reply",
            agent="fin-orchestrator",
            extra_data={"tools": ["search"]},
        )
        assert msg.agent == "fin-orchestrator"
        assert msg.extra_data == {"tools": ["search"]}


class TestGetMessages:
    """ConversationRepository.get_messages behaviour."""

    def test_get_messages_returns_all(self, db_session):
        repo = ConversationRepository(db_session)
        conv = _make_conv(db_session)
        repo.add_message(conv.id, "user", "q1")
        repo.add_message(conv.id, "assistant", "a1")
        repo.add_message(conv.id, "user", "q2")

        msgs = repo.get_messages(conv.id)
        assert len(msgs) == 3
        assert [m.content for m in msgs] == ["q1", "a1", "q2"]

    def test_get_messages_empty_conversation(self, db_session):
        repo = ConversationRepository(db_session)
        conv = _make_conv(db_session)
        assert repo.get_messages(conv.id) == []


class TestGetRecent:
    """ConversationRepository.get_recent behaviour."""

    def test_get_recent_returns_ordered_by_updated(self, db_session):
        repo = ConversationRepository(db_session)
        c1 = _make_conv(db_session, title="First")
        c2 = _make_conv(db_session, title="Second")
        # Touch c1 so it becomes most recent
        c1.title = "First Updated"
        db_session.flush()

        recent = repo.get_recent(limit=10)
        assert len(recent) == 2
        assert recent[0].id == c1.id  # most recently updated first

    def test_get_recent_respects_limit(self, db_session):
        repo = ConversationRepository(db_session)
        for i in range(5):
            _make_conv(db_session, title=f"Conv {i}")

        recent = repo.get_recent(limit=3)
        assert len(recent) == 3


class TestDeleteWithMessages:
    """ConversationRepository.delete_with_messages behaviour."""

    def test_delete_conversation_and_messages(self, db_session):
        repo = ConversationRepository(db_session)
        conv = _make_conv(db_session)
        repo.add_message(conv.id, "user", "msg1")
        repo.add_message(conv.id, "assistant", "msg2")

        result = repo.delete_with_messages(conv.id)
        assert result is True
        assert repo.get(conv.id) is None
        assert repo.get_messages(conv.id) == []

    def test_delete_nonexistent_returns_false(self, db_session):
        repo = ConversationRepository(db_session)
        assert repo.delete_with_messages("ghost-id") is False
