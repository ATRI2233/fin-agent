"""ConversationService — business logic for conversations and messages.

Wraps the CRUD/lookup operations that were previously inline in
``api/conversations.py`` endpoints. The service is intentionally sync:
async background work (``process_agent_message``, ``execute_workflow_async``)
lives in ``services/message_processor.py`` and is orchestrated by the
controllers, not by this class.

Session lifecycle
-----------------
Every public method accepts ``db: Session`` owned by the caller (controller /
unit-of-work). The service binds a per-call ``ConversationRepository`` to that
session so all operations participate in the caller's transaction. The
constructor-injected repositories serve as templates / fallbacks.

SessionManager cleanup (the ConvSessionManager in ``core/session_manager.py``)
is intentionally NOT called here — it is wired in by the controller after the
DB-level delete succeeds, so HAPI side-effects are decoupled from this class.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from main.framework.models.conversation import Conversation, Message
from main.framework.models.workflow_execution import WorkflowExecution
from main.framework.repositories.conversation_repo import ConversationRepository
from main.framework.repositories.workflow_repo import WorkflowRepository
from main.framework.schemas.conversation import (
    ConversationCreate,
    ConversationResponse,
    ConversationUpdate,
    MessageResponse,
)
from main.framework.services.exceptions import NotFoundError
from sqlalchemy.orm import Session


class ConversationService:
    """Business-logic facade over Conversation / Message / WorkflowExecution.

    Public surface (8 methods, all sync):
      create, get, list, update, delete,
      list_messages, save_user_message, start_workflow_execution
    """

    def __init__(
        self,
        conv_repo: ConversationRepository,
        workflow_repo: WorkflowRepository,
    ) -> None:
        # Repos are templates / fallbacks; per-call repos are bound to db.
        self._conv_repo = conv_repo
        self._workflow_repo = workflow_repo

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _repo_for(db: Session | None) -> ConversationRepository:
        """Return a ConversationRepository bound to the caller's session.

        Falls back to a default-mode repo if ``db`` is None (legacy usage).
        """
        if db is not None:
            return ConversationRepository(db=db)
        return ConversationRepository()

    @staticmethod
    def _to_response(conv: Conversation, msg_count: int) -> ConversationResponse:
        return ConversationResponse(
            id=conv.id,
            title=conv.title,
            current_agent=conv.current_agent,
            created_at=conv.created_at.isoformat(),
            updated_at=conv.updated_at.isoformat(),
            message_count=msg_count,
        )

    @staticmethod
    def _msg_to_response(msg: Message) -> MessageResponse:
        return MessageResponse(
            id=msg.id,
            role=msg.role,
            content=msg.content,
            agent=msg.agent,
            workflow_id=msg.workflow_id,
            execution_id=msg.execution_id,
            extra_data=msg.extra_data,
            created_at=msg.created_at.isoformat(),
        )

    # ------------------------------------------------------------------
    # Conversation CRUD
    # ------------------------------------------------------------------

    def create(self, request: ConversationCreate, db: Session) -> ConversationResponse:
        """Create a new conversation row. Returns the response model."""
        repo = self._repo_for(db)
        conv = repo.create(
            id=str(uuid4()),
            title=request.title or "New Conversation",
        )
        return self._to_response(conv, msg_count=0)

    def get(self, conv_id: str, db: Session) -> ConversationResponse:
        """Fetch a conversation by id. Raises NotFoundError if missing."""
        repo = self._repo_for(db)
        conv = repo.get(conv_id)
        if conv is None:
            raise NotFoundError(f"Conversation {conv_id} not found")
        msg_count = db.query(Message).filter(Message.conversation_id == conv.id).count()
        return self._to_response(conv, msg_count)

    def list(self, db: Session) -> list[ConversationResponse]:
        """List all conversations, most-recently-updated first."""
        repo = self._repo_for(db)
        convs = repo.list()
        result: list[ConversationResponse] = []
        for conv in convs:
            msg_count = db.query(Message).filter(Message.conversation_id == conv.id).count()
            result.append(self._to_response(conv, msg_count))
        return result

    def update(self, conv_id: str, request: ConversationUpdate, db: Session) -> bool:
        """Update mutable fields. Raises NotFoundError if missing."""
        repo = self._repo_for(db)
        kwargs: dict = {"updated_at": datetime.now(UTC)}
        if request.title is not None:
            kwargs["title"] = request.title
        if request.current_agent is not None:
            kwargs["current_agent"] = request.current_agent
        if repo.update(conv_id, **kwargs) is None:
            raise NotFoundError(f"Conversation {conv_id} not found")
        return True

    def delete(self, conv_id: str, db: Session) -> None:
        """Delete conversation and all related data (cascade).

        Cleanup order:
        1. ExecutionNode records linked to executions of this conversation
        2. WorkflowExecution records linked via messages
        3. Messages
        4. Conversation
        """
        repo = self._repo_for(db)
        if repo.get(conv_id) is None:
            raise NotFoundError(f"Conversation {conv_id} not found")

        # Collect execution IDs from messages before deleting
        execution_ids = [
            m.execution_id for m in
            db.query(Message.execution_id)
              .filter(Message.conversation_id == conv_id,
                      Message.execution_id.isnot(None))
              .distinct().all()
        ]

        # 1. Delete ExecutionNode records for these executions
        if execution_ids:
            from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution
            db.query(ExecutionNode).filter(ExecutionNode.execution_id.in_(execution_ids)).delete(synchronize_session=False)
            # 2. Delete WorkflowExecution records
            db.query(WorkflowExecution).filter(WorkflowExecution.id.in_(execution_ids)).delete(synchronize_session=False)

        # 3. Delete messages
        db.query(Message).filter(Message.conversation_id == conv_id).delete()
        # 4. Delete conversation
        repo.delete(conv_id)

    # ------------------------------------------------------------------
    # Messages
    # ------------------------------------------------------------------

    def list_messages(self, conv_id: str, db: Session) -> list[MessageResponse]:
        """Return all messages of a conversation in chronological order."""
        repo = self._repo_for(db)
        if repo.get(conv_id) is None:
            raise NotFoundError(f"Conversation {conv_id} not found")
        return [self._msg_to_response(m) for m in repo.get_messages(conv_id)]

    def save_user_message(self, conv_id: str, content: str, db: Session) -> Message:
        """Persist a user-authored message and bump conversation.updated_at.

        Used by the send_message endpoint's user-msg path. Async agent /
        workflow dispatch lives in the controller / message_processor.
        """
        repo = self._repo_for(db)
        if repo.get(conv_id) is None:
            raise NotFoundError(f"Conversation {conv_id} not found")
        msg = repo.add_message(conv_id, role="user", content=content)
        repo.update(conv_id, updated_at=datetime.now(UTC))
        db.commit()
        return msg

    # ------------------------------------------------------------------
    # Workflow execution (sync part of send_message endpoint)
    # ------------------------------------------------------------------

    def start_workflow_execution(self, conv_id: str, workflow_id: str, db: Session) -> WorkflowExecution:
        """Create a pending WorkflowExecution + system status message.

        Raises NotFoundError if the conversation or workflow does not exist.
        The caller (controller) is responsible for kicking off async execution
        via ``message_processor.execute_workflow_async``.
        """
        conv_repo = self._repo_for(db)
        if conv_repo.get(conv_id) is None:
            raise NotFoundError(f"Conversation {conv_id} not found")

        workflow = self._workflow_repo.get(workflow_id)
        if workflow is None:
            raise NotFoundError(f"Workflow {workflow_id} not found")

        execution = WorkflowExecution(
            workflow_id=workflow_id,
            conversation_id=conv_id,
            status="pending",
        )
        db.add(execution)
        db.commit()
        db.refresh(execution)
        return execution
