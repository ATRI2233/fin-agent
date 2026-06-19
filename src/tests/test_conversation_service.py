"""Tests for ConversationService — CRUD, message handling, cascade delete."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# TASK-500: shim importer switched on 2026-06-19
# NOTE: This test file uses the legacy service interface. The new
# DefaultConversationService takes a single repo (not conv_repo + workflow_repo)
# and has a different API. Runtime test logic is not updated (TASK-501 territory).
from src.main.infra.db import Base
from src.main.modules.conversation.domain.conversation import Conversation
from src.main.modules.conversation.domain.message import Message
from src.main.modules.execution.domain.execution_node import ExecutionNode
from src.main.modules.execution.domain.execution import WorkflowExecution
from src.main.infra.errors import WorkflowNotFoundError as NotFoundError
# TODO: Workflow domain class not yet imported (legacy test logic uses it directly)
# Replaced with a placeholder
from dataclasses import dataclass
@dataclass
class Workflow:
    id: str
    name: str
from src.main.modules.conversation.service.conversation_service import DefaultConversationService as ConversationService
from src.main.modules.conversation.repo.conversation_repo import SqlAlchemyConversationRepository as ConversationRepository
# TODO: WorkflowRepository equivalent not in new system (WorkflowExecution not used by repo)
# Provide a stub for legacy test usage
class WorkflowRepository:
    def __init__(self, db): self.db = db
# TODO: TASK-500: ConversationCreate/ConversationUpdate Pydantic schemas replaced with API v1
# The legacy test used the old framework.schemas; new api/v1/conversations.py provides
# ConversationCreate but not ConversationUpdate. Provide stubs for legacy test usage.
from pydantic import BaseModel
from typing import Optional
class ConversationCreate(BaseModel):
    title: Optional[str] = None
class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    current_agent: Optional[str] = None


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def engine():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=eng)
    yield eng
    Base.metadata.drop_all(bind=eng)
    eng.dispose()


@pytest.fixture()
def db(engine) -> Session:
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture()
def service(db) -> ConversationService:
    return ConversationService(
        conv_repo=ConversationRepository(db=db),
        workflow_repo=WorkflowRepository(db=db),
    )


# ---------------------------------------------------------------------------
# create
# ---------------------------------------------------------------------------

class TestCreate:
    def test_create_with_default_title(self, service: ConversationService, db: Session):
        resp = service.create(ConversationCreate(), db)
        assert resp.title == "New Conversation"
        assert resp.current_agent == "fin-orchestrator"
        assert resp.id # UUID assigned

    def test_create_with_custom_title(self, service: ConversationService, db: Session):
        resp = service.create(ConversationCreate(title="My Chat"), db)
        assert resp.title == "My Chat"

    def test_create_persists_to_db(self, service: ConversationService, db: Session):
        resp = service.create(ConversationCreate(), db)
        row = db.get(Conversation, resp.id)
        assert row is not None
        assert row.title == "New Conversation"


# ---------------------------------------------------------------------------
# get
# ---------------------------------------------------------------------------

class TestGet:
    def test_get_existing(self, service: ConversationService, db: Session):
        created = service.create(ConversationCreate(), db)
        fetched = service.get(created.id, db)
        assert fetched.id == created.id
        assert fetched.title == created.title

    def test_get_nonexistent_raises(self, service: ConversationService, db: Session):
        with pytest.raises(NotFoundError):
            service.get("nonexistent-id", db)


# ---------------------------------------------------------------------------
# list
# ---------------------------------------------------------------------------

class TestList:
    def test_list_empty(self, service: ConversationService, db: Session):
        result = service.list(db)
        assert result == []

    def test_list_returns_all(self, service: ConversationService, db: Session):
        service.create(ConversationCreate(title="A"), db)
        service.create(ConversationCreate(title="B"), db)
        result = service.list(db)
        assert len(result) == 2

    def test_list_returns_all_with_data(self, service: ConversationService, db: Session):
        a = service.create(ConversationCreate(title="A"), db)
        service.update(a.id, ConversationUpdate(title="A-updated"), db)
        b = service.create(ConversationCreate(title="B"), db)
        result = service.list(db)
        titles = {r.title for r in result}
        assert titles == {"A-updated", "B"}


# ---------------------------------------------------------------------------
# update
# ---------------------------------------------------------------------------

class TestUpdate:
    def test_update_title(self, service: ConversationService, db: Session):
        created = service.create(ConversationCreate(), db)
        service.update(created.id, ConversationUpdate(title="Updated"), db)
        fetched = service.get(created.id, db)
        assert fetched.title == "Updated"

    def test_update_agent(self, service: ConversationService, db: Session):
        created = service.create(ConversationCreate(), db)
        service.update(created.id, ConversationUpdate(current_agent="macro-scout"), db)
        fetched = service.get(created.id, db)
        assert fetched.current_agent == "macro-scout"

    def test_update_nonexistent_raises(self, service: ConversationService, db: Session):
        with pytest.raises(NotFoundError):
            service.update("nope", ConversationUpdate(title="X"), db)


# ---------------------------------------------------------------------------
# delete (cascade)
# ---------------------------------------------------------------------------

class TestDelete:
    def test_delete_removes_conversation(self, service: ConversationService, db: Session):
        created = service.create(ConversationCreate(), db)
        service.delete(created.id, db)
        assert db.get(Conversation, created.id) is None

    def test_delete_removes_messages(self, service: ConversationService, db: Session):
        created = service.create(ConversationCreate(), db)
        service.save_user_message(created.id, "hello", db)
        service.delete(created.id, db)
        msgs = db.query(Message).filter(Message.conversation_id == created.id).all()
        assert msgs == []

    def test_delete_removes_linked_executions(self, service: ConversationService, db: Session):
        """Cascade delete should clean up WorkflowExecution + ExecutionNode."""
        created = service.create(ConversationCreate(), db)
        # Create an execution linked via a message
        exec_id = str(uuid4())
        wf = Workflow(id=str(uuid4()), name="test-wf")
        db.add(wf)
        execution = WorkflowExecution(id=exec_id, workflow_id=wf.id, conversation_id=created.id)
        db.add(execution)
        db.add(ExecutionNode(execution_id=exec_id, node_id="n1", agent="test"))
        msg = Message(
            id=str(uuid4()), conversation_id=created.id, role="system",
            content="started", execution_id=exec_id,
        )
        db.add(msg)
        db.commit()

        service.delete(created.id, db)

        assert db.get(WorkflowExecution, exec_id) is None
        assert db.query(ExecutionNode).filter(ExecutionNode.execution_id == exec_id).all() == []

    def test_delete_nonexistent_raises(self, service: ConversationService, db: Session):
        with pytest.raises(NotFoundError):
            service.delete("nonexistent", db)


# ---------------------------------------------------------------------------
# save_user_message + list_messages
# ---------------------------------------------------------------------------

class TestMessages:
    def test_save_and_list(self, service: ConversationService, db: Session):
        conv = service.create(ConversationCreate(), db)
        msg = service.save_user_message(conv.id, "hello", db)
        assert msg.role == "user"
        assert msg.content == "hello"

        msgs = service.list_messages(conv.id, db)
        assert len(msgs) == 1
        assert msgs[0].content == "hello"

    def test_save_multiple_messages(self, service: ConversationService, db: Session):
        conv = service.create(ConversationCreate(), db)
        service.save_user_message(conv.id, "first", db)
        service.save_user_message(conv.id, "second", db)
        msgs = service.list_messages(conv.id, db)
        assert len(msgs) == 2
        assert [m.content for m in msgs] == ["first", "second"]

    def test_save_message_nonexistent_conv_raises(self, service: ConversationService, db: Session):
        with pytest.raises(NotFoundError):
            service.save_user_message("nope", "hello", db)
