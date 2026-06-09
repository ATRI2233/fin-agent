"""Unit tests for ConversationService — mock-heavy, no real database.

Verifies the business-logic layer extracted from ``api/conversations.py``.
Every method on the service is exercised against a mocked
``ConversationRepository`` and a mocked ``WorkflowRepository``.  The
SQLAlchemy ``db`` Session is itself a ``MagicMock`` because the service
calls ``db.query(...).count()`` and ``db.commit()`` directly.

Design note
-----------
``ConversationService._repo_for(db)`` constructs a fresh
``ConversationRepository`` per call.  To mock at the *repository
boundary* (the project's testing convention), we patch the instance
method to return our MagicMock.  This keeps the test focused on the
service's orchestration of repo calls, not on SQLAlchemy plumbing.
"""

from __future__ import annotations

from unittest.mock import MagicMock, Mock, patch

import pytest

from main.framework.models.workflow_execution import WorkflowExecution
from main.framework.schemas.conversation import (
    ConversationCreate,
    ConversationResponse,
    ConversationUpdate,
    MessageResponse,
)
from main.framework.services.conversation_service import ConversationService
from main.framework.services.exceptions import NotFoundError

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_conv_mock(
    conv_id: str = "conv-1",
    title: str = "Hello",
    current_agent: str = "fin-orchestrator",
) -> Mock:
    """Build a Mock that quacks like a Conversation row."""
    conv = Mock()
    conv.id = conv_id
    conv.title = title
    conv.current_agent = current_agent
    conv.created_at = Mock()
    conv.created_at.isoformat.return_value = "2026-01-01T00:00:00"
    conv.updated_at = Mock()
    conv.updated_at.isoformat.return_value = "2026-01-01T00:00:00"
    return conv


def _make_msg_mock(
    msg_id: str = "msg-1",
    role: str = "user",
    content: str = "hi",
    agent: str | None = None,
) -> Mock:
    """Build a Mock that quacks like a Message row."""
    msg = Mock()
    msg.id = msg_id
    msg.role = role
    msg.content = content
    msg.agent = agent
    msg.workflow_id = None
    msg.execution_id = None
    msg.extra_data = None
    msg.created_at = Mock()
    msg.created_at.isoformat.return_value = "2026-01-01T00:00:00"
    return msg


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_db() -> MagicMock:
    """A mocked SQLAlchemy session.

    The service uses ``db.query(Message).filter(...).count()``,
    ``db.query(Message).filter(...).delete()``, and ``db.commit()`` /
    ``db.add()`` / ``db.refresh()``.  All are routed through this Mock.
    """
    db = MagicMock()
    # Query.count() default — overridable per-test
    db.query.return_value.filter.return_value.count.return_value = 0
    # Query.delete() default
    db.query.return_value.filter.return_value.delete.return_value = 0
    # Query.all() default
    db.query.return_value.filter.return_value.all.return_value = []
    return db


@pytest.fixture
def conv_repo() -> MagicMock:
    """Mocked ConversationRepository."""
    return MagicMock()


@pytest.fixture
def workflow_repo() -> MagicMock:
    """Mocked WorkflowRepository — default to a valid workflow lookup."""
    repo = MagicMock()
    wf = Mock()
    wf.id = "wf-1"
    wf.name = "Test Workflow"
    repo.get.return_value = wf
    return repo


@pytest.fixture
def service(conv_repo: MagicMock, workflow_repo: MagicMock) -> ConversationService:
    """ConversationService wired with mocked deps + patched _repo_for."""
    svc = ConversationService(conv_repo=conv_repo, workflow_repo=workflow_repo)
    # Force _repo_for(db) to return our MagicMock so the test exercises the
    # service's logic against the injected mock rather than constructing a real
    # ConversationRepository(db=...).
    svc._repo_for = staticmethod(lambda db: conv_repo)  # type: ignore[assignment]
    return svc


# ---------------------------------------------------------------------------
# create
# ---------------------------------------------------------------------------


class TestCreateConversation:
    """ConversationService.create behaviour."""

    def test_create_conversation(self, service, conv_repo, mock_db):
        """Service.create calls repo.create and returns a ConversationResponse."""
        conv = _make_conv_mock()
        conv_repo.create.return_value = conv

        request = ConversationCreate(title="New Chat")
        result = service.create(request, db=mock_db)

        conv_repo.create.assert_called_once()
        # Assert that title was passed through
        _, kwargs = conv_repo.create.call_args
        assert kwargs.get("title") == "New Chat"
        assert isinstance(result, ConversationResponse)
        assert result.id == "conv-1"
        assert result.title == "Hello"
        assert result.message_count == 0

    def test_create_conversation_default_title(self, service, conv_repo, mock_db):
        """Default title 'New Conversation' when request.title is None."""
        conv = _make_conv_mock(title="New Conversation")
        conv_repo.create.return_value = conv

        request = ConversationCreate(title=None)
        result = service.create(request, db=mock_db)

        _, kwargs = conv_repo.create.call_args
        assert kwargs.get("title") == "New Conversation"
        assert result.title == "New Conversation"


# ---------------------------------------------------------------------------
# get
# ---------------------------------------------------------------------------


class TestGetConversation:
    """ConversationService.get behaviour."""

    def test_get_conversation_found(self, service, conv_repo, mock_db):
        """Service.get returns a ConversationResponse when repo finds the row."""
        conv = _make_conv_mock()
        conv_repo.get.return_value = conv
        mock_db.query.return_value.filter.return_value.count.return_value = 3

        result = service.get("conv-1", db=mock_db)

        conv_repo.get.assert_called_once_with("conv-1")
        assert isinstance(result, ConversationResponse)
        assert result.id == "conv-1"
        assert result.message_count == 3

    def test_get_conversation_not_found_raises(self, service, conv_repo, mock_db):
        """Service.get raises NotFoundError when repo returns None."""
        conv_repo.get.return_value = None

        with pytest.raises(NotFoundError) as exc_info:
            service.get("ghost-id", db=mock_db)

        assert "ghost-id" in str(exc_info.value)
        assert "not found" in str(exc_info.value).lower()


# ---------------------------------------------------------------------------
# list
# ---------------------------------------------------------------------------


class TestListConversations:
    """ConversationService.list behaviour."""

    def test_list_conversations_empty(self, service, conv_repo, mock_db):
        """Empty repo returns an empty list — no exceptions."""
        conv_repo.list.return_value = []

        result = service.list(db=mock_db)

        assert result == []
        conv_repo.list.assert_called_once()

    def test_list_conversations_with_results(self, service, conv_repo, mock_db):
        """Two mock conversations → response list length 2."""
        c1 = _make_conv_mock(conv_id="conv-1", title="First")
        c2 = _make_conv_mock(conv_id="conv-2", title="Second")
        conv_repo.list.return_value = [c1, c2]
        mock_db.query.return_value.filter.return_value.count.return_value = 1

        result = service.list(db=mock_db)

        assert isinstance(result, list)
        assert len(result) == 2
        assert all(isinstance(r, ConversationResponse) for r in result)
        assert result[0].id == "conv-1"
        assert result[1].id == "conv-2"


# ---------------------------------------------------------------------------
# update
# ---------------------------------------------------------------------------


class TestUpdateConversation:
    """ConversationService.update behaviour."""

    def test_update_conversation_title(self, service, conv_repo, mock_db):
        """Service.update calls repo.update with title and updated_at."""
        updated = _make_conv_mock(title="New Title")
        conv_repo.update.return_value = updated

        request = ConversationUpdate(title="New Title")
        result = service.update("conv-1", request, db=mock_db)

        conv_repo.update.assert_called_once()
        _, kwargs = conv_repo.update.call_args
        assert kwargs.get("title") == "New Title"
        assert "updated_at" in kwargs  # service bumps updated_at automatically
        assert result is True

    def test_update_conversation_not_found_raises(self, service, conv_repo, mock_db):
        """Service.update raises NotFoundError when repo.update returns None."""
        conv_repo.update.return_value = None

        request = ConversationUpdate(title="Anything")
        with pytest.raises(NotFoundError):
            service.update("missing-id", request, db=mock_db)


# ---------------------------------------------------------------------------
# delete
# ---------------------------------------------------------------------------


class TestDeleteConversation:
    """ConversationService.delete behaviour."""

    def test_delete_conversation_success(self, service, conv_repo, mock_db):
        """Service.delete removes messages then conversation when found."""
        conv = _make_conv_mock()
        conv_repo.get.return_value = conv
        mock_db.query.return_value.filter.return_value.delete.return_value = 2

        service.delete("conv-1", db=mock_db)

        # Verify ordering: messages deleted first, then conversation
        conv_repo.get.assert_called_once_with("conv-1")
        # db.query(Message).filter(...).delete() was called
        mock_db.query.return_value.filter.return_value.delete.assert_called_once()
        # repo.delete was called
        conv_repo.delete.assert_called_once_with("conv-1")

    def test_delete_conversation_not_found_raises(self, service, conv_repo, mock_db):
        """Service.delete raises NotFoundError when conversation is missing."""
        conv_repo.get.return_value = None

        with pytest.raises(NotFoundError):
            service.delete("ghost-id", db=mock_db)

        # Critical: do NOT delete messages if conversation doesn't exist
        conv_repo.delete.assert_not_called()


# ---------------------------------------------------------------------------
# list_messages
# ---------------------------------------------------------------------------


class TestListMessages:
    """ConversationService.list_messages behaviour."""

    def test_list_messages_returns_list(self, service, conv_repo, mock_db):
        """Service.list_messages returns a list of MessageResponse."""
        conv = _make_conv_mock()
        conv_repo.get.return_value = conv
        m1 = _make_msg_mock(msg_id="m1", role="user", content="hi")
        m2 = _make_msg_mock(msg_id="m2", role="assistant", content="hello")
        conv_repo.get_messages.return_value = [m1, m2]

        result = service.list_messages("conv-1", db=mock_db)

        conv_repo.get_messages.assert_called_once_with("conv-1")
        assert isinstance(result, list)
        assert len(result) == 2
        assert all(isinstance(m, MessageResponse) for m in result)
        assert result[0].id == "m1"
        assert result[0].role == "user"
        assert result[1].role == "assistant"

    def test_list_messages_conversation_missing_raises(self, service, conv_repo, mock_db):
        """list_messages raises NotFoundError when conversation is missing."""
        conv_repo.get.return_value = None

        with pytest.raises(NotFoundError):
            service.list_messages("missing", db=mock_db)

        conv_repo.get_messages.assert_not_called()


# ---------------------------------------------------------------------------
# save_user_message
# ---------------------------------------------------------------------------


class TestSaveUserMessage:
    """ConversationService.save_user_message behaviour."""

    def test_save_user_message_persists(self, service, conv_repo, mock_db):
        """save_user_message creates a Message with role=user and the supplied content."""
        conv = _make_conv_mock()
        conv_repo.get.return_value = conv
        saved_msg = _make_msg_mock(msg_id="msg-99", role="user", content="hello world")
        conv_repo.add_message.return_value = saved_msg

        result = service.save_user_message("conv-1", "hello world", db=mock_db)

        # repo.add_message called with role='user' and our content
        # The service uses: repo.add_message(conv_id, role="user", content=content)
        # so conv_id is positional and role/content are kwargs.
        conv_repo.add_message.assert_called_once()
        args, kwargs = conv_repo.add_message.call_args
        # conv_id is always passed positionally
        assert len(args) >= 1
        assert args[0] == "conv-1"
        assert kwargs.get("role") == "user"
        assert kwargs.get("content") == "hello world"

        # updated_at is bumped on the conversation
        conv_repo.update.assert_called_once()
        # db.commit() was called
        mock_db.commit.assert_called()
        # Returned value is the Message (or Message-like Mock)
        assert result is saved_msg


# ---------------------------------------------------------------------------
# start_workflow_execution
# ---------------------------------------------------------------------------


class TestStartWorkflowExecution:
    """ConversationService.start_workflow_execution behaviour."""

    def test_start_workflow_execution_creates_record(self, service, conv_repo, workflow_repo, mock_db):
        """start_workflow_execution creates a WorkflowExecution + status message."""
        conv = _make_conv_mock()
        conv_repo.get.return_value = conv
        status_msg = _make_msg_mock(msg_id="sys-1", role="system", content="Starting workflow: Test Workflow")
        conv_repo.add_message.return_value = status_msg

        # Mimic SQLAlchemy: db.refresh() populates execution.id (UUID string).
        # Real SQLAlchemy applies column defaults on flush; in our mock we set it
        # via the side_effect so the service sees a real ID when calling
        # execution.id for the status message.
        def fake_refresh(obj):
            import uuid as _uuid

            obj.id = str(_uuid.uuid4())

        mock_db.refresh.side_effect = fake_refresh

        result = service.start_workflow_execution("conv-1", "wf-1", db=mock_db)

        # Workflow looked up via injected repo
        workflow_repo.get.assert_called_once_with("wf-1")
        # WorkflowExecution persisted
        mock_db.add.assert_called_once()
        added = mock_db.add.call_args[0][0]
        assert isinstance(added, WorkflowExecution)
        assert added.workflow_id == "wf-1"
        assert added.conversation_id == "conv-1"
        assert added.status == "pending"
        # db.commit + db.refresh called
        mock_db.commit.assert_called()
        mock_db.refresh.assert_called_once_with(added)
        # Status message added with workflow_start marker
        conv_repo.add_message.assert_called_once()
        add_args, add_kwargs = conv_repo.add_message.call_args
        # The service calls add_message(conv_id, role="system", content=..., ...)
        # so conv_id is positional and role/content/etc are kwargs.
        assert len(add_args) >= 1
        assert add_args[0] == "conv-1"
        assert add_kwargs.get("role") == "system"
        assert "Starting workflow" in add_kwargs.get("content", "")
        assert add_kwargs.get("workflow_id") == "wf-1"
        assert add_kwargs.get("execution_id") == str(added.id)
        assert add_kwargs.get("extra_data") == {"type": "workflow_start"}
        # Returned object is the WorkflowExecution (refreshed)
        assert result is added
        assert result.id is not None

    def test_start_workflow_execution_workflow_missing_raises(self, service, conv_repo, workflow_repo, mock_db):
        """start_workflow_execution raises NotFoundError when workflow is missing."""
        conv = _make_conv_mock()
        conv_repo.get.return_value = conv
        workflow_repo.get.return_value = None  # Workflow not found

        with pytest.raises(NotFoundError):
            service.start_workflow_execution("conv-1", "missing-wf", db=mock_db)

        # Critical: no execution created if workflow lookup fails
        mock_db.add.assert_not_called()
