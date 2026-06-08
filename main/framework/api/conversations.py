"""Conversation API - CRUD + message handling."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends, Request, status, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List
from uuid import uuid4
from datetime import datetime

from main.framework.models.database import get_db, SessionLocal
from main.framework.models.conversation import Conversation, Message
from main.framework.models.workflow import Workflow
from main.framework.models.workflow_execution import WorkflowExecution
from main.framework.core.protocols import AgentBackend

router = APIRouter(prefix="/api/v1/conversations", tags=["conversations"])


# ���� Request/Response Models ������������������������������������������������������������������������������������


class ConversationCreate(BaseModel):
    title: Optional[str] = "New Conversation"


class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    current_agent: Optional[str] = None


class MessageCreate(BaseModel):
    content: str
    mode: str = "agent"  # "agent" or "workflow"
    agent: Optional[str] = None  # For agent mode
    workflow_id: Optional[str] = None  # For workflow mode


class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    agent: Optional[str] = None
    workflow_id: Optional[str] = None
    execution_id: Optional[str] = None
    extra_data: Optional[dict] = None
    created_at: str


class ConversationResponse(BaseModel):
    id: str
    title: str
    hapi_session_id: Optional[str] = None
    current_agent: str
    created_at: str
    updated_at: str
    message_count: int = 0


# ---- HAPI Session Manager ----


class HAPISessionManager:
    """Manages the mapping between conversations and HAPI sessions."""

    def __init__(self, backend: AgentBackend):
        self._backend = backend
        self._session_ids: dict[str, str] = {}  # conversation_id -> hapi_session_id

    async def get_or_create_session(
        self, conversation_id: str, db
    ) -> tuple[str, AgentBackend]:
        """Get or create HAPI session for a conversation."""
        if conversation_id in self._session_ids:
            return self._session_ids[conversation_id], self._backend

        conversation = (
            db.query(Conversation).filter(Conversation.id == conversation_id).first()
        )
        if conversation and conversation.hapi_session_id:
            self._session_ids[conversation_id] = conversation.hapi_session_id
            return conversation.hapi_session_id, self._backend

        session_id = await self._backend.create_session(agent="opencode")

        if conversation:
            conversation.hapi_session_id = session_id
            db.commit()

        self._session_ids[conversation_id] = session_id
        return session_id, self._backend

    async def cleanup_session(self, conversation_id: str, db=None) -> Optional[str]:
        """Delete HAPI session for a conversation."""
        session_id = self._session_ids.pop(conversation_id, None)

        if not session_id and db is not None:
            conversation = (
                db.query(Conversation)
                .filter(Conversation.id == conversation_id)
                .first()
            )
            if conversation:
                session_id = conversation.hapi_session_id

        if not session_id:
            return None

        try:
            await self._backend.cleanup_sessions([session_id])
        except Exception as e:
            print(f"Warning: Failed to delete HAPI session {session_id}: {e}")

        return session_id

    def get_session_id(self, conversation_id: str) -> Optional[str]:
        return self._session_ids.get(conversation_id)


# Will be initialised in startup via configure_session_manager()
session_manager: HAPISessionManager = None  # type: ignore[assignment]


def configure_session_manager(backend: AgentBackend) -> None:
    global session_manager
    session_manager = HAPISessionManager(backend)


def _save_workflow_status(
    db,
    conversation_id: str,
    execution_id: str,
    workflow_id: str,
    status: str,
    detail: str,
    agent: str = None,
):
    """Save workflow status message for real-time updates."""
    msg = Message(
        id=str(uuid4()),
        conversation_id=conversation_id,
        role="system",
        content=detail,
        workflow_id=workflow_id,
        execution_id=execution_id,
        agent=agent,
        extra_data={"type": "workflow_status", "status": status, "agent": agent},
    )
    db.add(msg)
    db.commit()


# ���� Helper Functions ��������������������������������������������������������������������������������������������������


async def _process_agent_message(
    conversation_id: str, message_id: str, content: str, agent: str, backend: AgentBackend
):
    """Process agent message in background."""
    db = SessionLocal()
    try:
        session_id, _ = await session_manager.get_or_create_session(
            conversation_id, db
        )

        conversation = (
            db.query(Conversation).filter(Conversation.id == conversation_id).first()
        )
        if conversation and conversation.current_agent != agent:
            await session_manager.cleanup_session(conversation_id, db=db)
            conversation.hapi_session_id = None
            db.commit()

        session_id, _ = await session_manager.get_or_create_session(
            conversation_id, db
        )

        if conversation:
            conversation.current_agent = agent
            db.commit()

        if agent and agent != "fin-orchestrator":
            prompt = f"@{agent} {content}"
        else:
            prompt = content

        msg_count = await backend.get_message_count(session_id)

        await backend.send_message(session_id, prompt)
        result = await backend.wait_for_completion(session_id, after_count=msg_count)

        try:
            import json
            parsed = json.loads(result)
            response_content = parsed.get("result", result)
        except Exception:
            response_content = result

        assistant_msg = Message(
            id=str(uuid4()),
            conversation_id=conversation_id,
            role="assistant",
            content=response_content,
            agent=agent,
            extra_data={"hapi_session_id": session_id, "in_reply_to": message_id},
        )
        db.add(assistant_msg)

        conversation = (
            db.query(Conversation).filter(Conversation.id == conversation_id).first()
        )
        if conversation:
            conversation.updated_at = datetime.utcnow()

        db.commit()

    except Exception as e:
        error_msg = Message(
            id=str(uuid4()),
            conversation_id=conversation_id,
            role="system",
            content=f"Error: {str(e)}",
            extra_data={"type": "error", "in_reply_to": message_id},
        )
        db.add(error_msg)
        db.commit()

    finally:
        db.close()


async def _execute_workflow_async(
    conversation_id: str, execution_id: str, workflow_id: str, params: dict, container
):
    """Execute workflow in background and save results to conversation."""
    db = SessionLocal()
    try:
        async def status_callback(st: str, detail: str, agent: str = ""):
            db2 = SessionLocal()
            try:
                _save_workflow_status(
                    db2, conversation_id, execution_id, workflow_id, st, detail, agent,
                )
            finally:
                db2.close()

        engine = container.create_workflow_engine(
            workflow_id, params, status_callback=status_callback
        )
        engine.execution_id = execution_id
        await engine.execute()

        # Get execution result
        execution = (
            db.query(WorkflowExecution)
            .filter(WorkflowExecution.id == execution_id)
            .first()
        )
        if not execution:
            return

        # Collect results from all nodes
        from main.framework.models.workflow_execution import ExecutionNode

        nodes = (
            db.query(ExecutionNode)
            .filter(ExecutionNode.execution_id == execution_id)
            .all()
        )

        result_parts = []
        for node in nodes:
            if node.output:
                result_parts.append(
                    f"**{node.agent}**:\n{node.output.get('result', '')}"
                )

        result_content = (
            "\n\n".join(result_parts)
            if result_parts
            else "Workflow completed with no output."
        )

        # Save workflow result message
        result_msg = Message(
            id=str(uuid4()),
            conversation_id=conversation_id,
            role="assistant",
            content=result_content,
            workflow_id=workflow_id,
            execution_id=execution_id,
            extra_data={"type": "workflow_result"},
        )
        db.add(result_msg)

        # Update conversation
        conversation = (
            db.query(Conversation).filter(Conversation.id == conversation_id).first()
        )
        if conversation:
            conversation.updated_at = datetime.utcnow()

        db.commit()

    except Exception as e:
        # Save error message
        error_msg = Message(
            id=str(uuid4()),
            conversation_id=conversation_id,
            role="system",
            content=f"Workflow error: {str(e)}",
            extra_data={"type": "workflow_error"},
        )
        db.add(error_msg)
        db.commit()

    finally:
        # Cleanup execution sessions (not the main conversation session)
        try:
            execution = (
                db.query(WorkflowExecution)
                .filter(WorkflowExecution.id == execution_id)
                .first()
            )
            if execution:
                from main.framework.models.workflow_execution import ExecutionNode

                nodes = (
                    db.query(ExecutionNode)
                    .filter(ExecutionNode.execution_id == execution_id)
                    .all()
                )
                for node in nodes:
                    if node.hapi_session_id:
                        try:
                            await container.backend.abort_session(node.hapi_session_id)
                        except Exception:
                            pass
        except Exception:
            pass

        db.close()


# ���� API Endpoints ��������������������������������������������������������������������������������������������������������


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_conversation(payload: ConversationCreate, db=Depends(get_db)):
    """Create a new conversation with HAPI session."""
    conversation = Conversation(
        id=str(uuid4()),
        title=payload.title,
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    # Don't create HAPI session immediately - wait until first message
    # This avoids spawning a terminal window when just creating a conversation

    return ConversationResponse(
        id=conversation.id,
        title=conversation.title,
        hapi_session_id=conversation.hapi_session_id,
        current_agent=conversation.current_agent,
        created_at=conversation.created_at.isoformat(),
        updated_at=conversation.updated_at.isoformat(),
        message_count=0,
    )


@router.get("")
async def list_conversations(db=Depends(get_db)):
    """List all conversations."""
    conversations = (
        db.query(Conversation).order_by(Conversation.updated_at.desc()).all()
    )

    result = []
    for conv in conversations:
        msg_count = db.query(Message).filter(Message.conversation_id == conv.id).count()
        result.append(
            ConversationResponse(
                id=conv.id,
                title=conv.title,
                hapi_session_id=conv.hapi_session_id,
                current_agent=conv.current_agent,
                created_at=conv.created_at.isoformat(),
                updated_at=conv.updated_at.isoformat(),
                message_count=msg_count,
            )
        )

    return result


@router.get("/{conversation_id}")
async def get_conversation(conversation_id: str, db=Depends(get_db)):
    """Get a conversation by ID."""
    conversation = (
        db.query(Conversation).filter(Conversation.id == conversation_id).first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    msg_count = (
        db.query(Message).filter(Message.conversation_id == conversation.id).count()
    )

    return ConversationResponse(
        id=conversation.id,
        title=conversation.title,
        hapi_session_id=conversation.hapi_session_id,
        current_agent=conversation.current_agent,
        created_at=conversation.created_at.isoformat(),
        updated_at=conversation.updated_at.isoformat(),
        message_count=msg_count,
    )


@router.put("/{conversation_id}")
async def update_conversation(
    conversation_id: str, payload: ConversationUpdate, db=Depends(get_db)
):
    """Update a conversation."""
    conversation = (
        db.query(Conversation).filter(Conversation.id == conversation_id).first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if payload.title is not None:
        conversation.title = payload.title
    if payload.current_agent is not None:
        conversation.current_agent = payload.current_agent

    conversation.updated_at = datetime.utcnow()
    db.commit()

    return {"success": True}


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(conversation_id: str, db=Depends(get_db)):
    """Delete a conversation and cleanup HAPI session."""
    conversation = (
        db.query(Conversation).filter(Conversation.id == conversation_id).first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    try:
        # Cleanup HAPI session
        await session_manager.cleanup_session(conversation_id, db=db)
    except Exception as e:
        print(f"Warning: Failed to cleanup HAPI session: {e}")

    try:
        # Delete related messages first
        db.query(Message).filter(Message.conversation_id == conversation_id).delete()
        # Delete conversation
        db.delete(conversation)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete: {str(e)}")


@router.get("/{conversation_id}/messages")
async def list_messages(conversation_id: str, db=Depends(get_db)):
    """List all messages in a conversation."""
    conversation = (
        db.query(Conversation).filter(Conversation.id == conversation_id).first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
        .all()
    )

    return [
        MessageResponse(
            id=msg.id,
            role=msg.role,
            content=msg.content,
            agent=msg.agent,
            workflow_id=msg.workflow_id,
            execution_id=msg.execution_id,
            extra_data=msg.extra_data,
            created_at=msg.created_at.isoformat(),
        )
        for msg in messages
    ]


@router.post("/{conversation_id}/messages", status_code=status.HTTP_202_ACCEPTED)
async def send_message(
    conversation_id: str,
    payload: MessageCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    db=Depends(get_db),
):
    """Send a message (async processing)."""
    container = request.app.state.container
    conversation = (
        db.query(Conversation).filter(Conversation.id == conversation_id).first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Save user message
    user_msg = Message(
        id=str(uuid4()),
        conversation_id=conversation_id,
        role="user",
        content=payload.content,
    )
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)

    # Update conversation
    conversation.updated_at = datetime.utcnow()
    if payload.agent:
        conversation.current_agent = payload.agent
    db.commit()

    # Start background processing
    if payload.mode == "workflow" and payload.workflow_id:
        # Workflow mode
        workflow = db.query(Workflow).filter(Workflow.id == payload.workflow_id).first()
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")

        # Create execution
        execution = WorkflowExecution(
            workflow_id=payload.workflow_id,
            conversation_id=conversation_id,
            status="pending",
        )
        db.add(execution)
        db.commit()
        db.refresh(execution)

        # Save workflow status message
        status_msg = Message(
            id=str(uuid4()),
            conversation_id=conversation_id,
            role="system",
            content=f"Starting workflow: {workflow.name}",
            workflow_id=payload.workflow_id,
            execution_id=execution.id,
            extra_data={"type": "workflow_start"},
        )
        db.add(status_msg)
        db.commit()

        background_tasks.add_task(
            _execute_workflow_async,
            conversation_id=conversation_id,
            execution_id=str(execution.id),
            workflow_id=payload.workflow_id,
            params={"question": payload.content},
            container=container,
        )

        return {
            "user_message": MessageResponse(
                id=user_msg.id,
                role=user_msg.role,
                content=user_msg.content,
                created_at=user_msg.created_at.isoformat(),
            ),
            "status": "workflow_started",
            "execution_id": str(execution.id),
        }

    else:
        # Agent mode - async processing
        agent = payload.agent or conversation.current_agent or "fin-orchestrator"

        background_tasks.add_task(
            _process_agent_message,
            conversation_id=conversation_id,
            message_id=str(user_msg.id),
            content=payload.content,
            agent=agent,
            backend=container.backend,
        )

        return {
            "user_message": MessageResponse(
                id=user_msg.id,
                role=user_msg.role,
                content=user_msg.content,
                created_at=user_msg.created_at.isoformat(),
            ),
            "status": "processing",
        }
