"""Conversation API - CRUD + message handling."""

from __future__ import annotations

import logging
from fastapi import APIRouter, HTTPException, Depends, Request, status, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Optional, List
from uuid import uuid4
from datetime import datetime, timezone

from main.framework.models.database import get_db, get_session
from main.framework.models.conversation import Conversation, Message
from main.framework.models.workflow import Workflow
from main.framework.models.workflow_execution import WorkflowExecution
from main.framework.core.protocols import AgentBackend

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/conversations", tags=["conversations"])


# ---- Request/Response Models ----


class ConversationCreate(BaseModel):
    title: Optional[str] = "New Conversation"


class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    current_agent: Optional[str] = None


class MessageCreate(BaseModel):
    content: str = Field(..., max_length=10000)
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
    current_agent: str
    created_at: str
    updated_at: str
    message_count: int = 0


# ---- Session Manager ----


class ConvSessionManager:
    """Manages the mapping between conversations and agent sessions."""

    def __init__(self, backend: AgentBackend):
        self._backend = backend
        self._session_ids: dict[str, str] = {}  # conversation_id -> session_id

    async def get_or_create_session(
        self, conversation_id: str, agent: str = "opencode", db=None
    ) -> tuple[str, AgentBackend]:
        """Get or create a session for a conversation."""
        if conversation_id in self._session_ids:
            return self._session_ids[conversation_id], self._backend

        # Check DB for persisted session
        if db is not None:
            conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
            if conversation and conversation.session_id:
                self._session_ids[conversation_id] = conversation.session_id
                return conversation.session_id, self._backend

        # Create new session with the target agent
        session_id = await self._backend.create_session(agent=agent)

        if db is not None:
            conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
            if conversation:
                conversation.session_id = session_id
                db.commit()

        self._session_ids[conversation_id] = session_id
        return session_id, self._backend

    async def cleanup_session(self, conversation_id: str, db=None) -> Optional[str]:
        """Delete session for a conversation."""
        session_id = self._session_ids.pop(conversation_id, None)

        if not session_id and db is not None:
            conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
            if conversation:
                session_id = conversation.session_id

        if not session_id:
            return None

        try:
            await self._backend.cleanup_sessions([session_id])
        except Exception as e:
            logger.warning(f"Failed to cleanup session {session_id}: {e}")

        return session_id

    def get_session_id(self, conversation_id: str) -> Optional[str]:
        return self._session_ids.get(conversation_id)


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


# ---- Helper Functions ----


async def _process_agent_message(
    conversation_id: str,
    message_id: str,
    content: str,
    agent: str,
    backend: AgentBackend,
    session_manager: ConvSessionManager,
):
    """Process agent message in background."""
    with get_session() as db:
        try:
            conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()

            # If agent changed, cleanup old session to create fresh one
            if conversation and conversation.current_agent and conversation.current_agent != agent:
                await session_manager.cleanup_session(conversation_id, db=db)
                conversation.session_id = None
                db.commit()

            if conversation:
                conversation.current_agent = agent
                db.commit()

            # Create session with the target agent (direct routing, no @prefix)
            session_id, _ = await session_manager.get_or_create_session(conversation_id, agent=agent, db=db)

            # Send message directly — opencode --agent handles routing
            await backend.send_message(session_id, content)

            # Get response (send_message already waits for completion)
            result = await backend.wait_for_completion(session_id)

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
                extra_data={"session_id": session_id, "in_reply_to": message_id},
            )
            db.add(assistant_msg)

            conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
            if conversation:
                conversation.updated_at = datetime.now(timezone.utc)

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


async def _execute_workflow_async(conversation_id: str, execution_id: str, workflow_id: str, params: dict, container):
    """Execute workflow in background and save results to conversation."""
    with get_session() as db:
        try:
            from main.framework.models.workflow import Workflow
            from main.framework.models.workflow_execution import ExecutionNode
            from main.framework.core.workflow_engine import WorkflowEngine

            workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
            if not workflow:
                logger.error(f"Workflow {workflow_id} not found")
                return

            execution = db.query(WorkflowExecution).filter(WorkflowExecution.id == execution_id).first()
            if not execution:
                logger.error(f"Execution {execution_id} not found")
                return
            execution.status = "running"
            db.commit()

            # Create all ExecutionNode records
            nodes = workflow.nodes or []
            for node in nodes:
                agent = node.get("agent", "")
                if not agent:
                    data = node.get("data", {})
                    if isinstance(data, dict):
                        agent = data.get("agentType", "") or data.get("label", "")
                exec_node = ExecutionNode(
                    execution_id=execution_id,
                    node_id=node["id"],
                    agent=agent,
                    status="pending",
                    input=params,
                )
                db.add(exec_node)
            db.commit()

            def status_callback(st: str, detail: str, agent: str = ""):
                with get_session() as db2:
                    _save_workflow_status(
                        db2,
                        conversation_id,
                        execution_id,
                        workflow_id,
                        st,
                        detail,
                        agent,
                    )

            engine = container.create_workflow_engine(
                workflow_id, params, status_callback=status_callback, execution_id=execution_id
            )
            await engine.execute()

            # Expire cached objects so we read fresh data from DB (engine updated them in its own session)
            db.expire_all()

            execution = db.query(WorkflowExecution).filter(WorkflowExecution.id == execution_id).first()
            if not execution:
                return

            from main.framework.models.workflow_execution import ExecutionNode

            nodes = db.query(ExecutionNode).filter(ExecutionNode.execution_id == execution_id).all()

            result_parts = []
            for node in nodes:
                if node.output:
                    result_parts.append(f"**{node.agent}**:\n{node.output.get('result', '')}")

            result_content = "\n\n".join(result_parts) if result_parts else "Workflow completed with no output."

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

            conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
            if conversation:
                conversation.updated_at = datetime.now(timezone.utc)

            db.commit()

        except Exception as e:
            logger.error(f"Workflow {workflow_id} execution failed: {e}", exc_info=True)
            error_msg = Message(
                id=str(uuid4()),
                conversation_id=conversation_id,
                role="system",
                content=f"Workflow error: {str(e)}",
                extra_data={"type": "workflow_error"},
            )
            db.add(error_msg)
            db.commit()


# ---- API Endpoints ----


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_conversation(payload: ConversationCreate, db=Depends(get_db)):
    """Create a new conversation."""
    conversation = Conversation(
        id=str(uuid4()),
        title=payload.title,
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    return ConversationResponse(
        id=conversation.id,
        title=conversation.title,
        current_agent=conversation.current_agent,
        created_at=conversation.created_at.isoformat(),
        updated_at=conversation.updated_at.isoformat(),
        message_count=0,
    )


@router.get("")
async def list_conversations(db=Depends(get_db)):
    """List all conversations."""
    conversations = db.query(Conversation).order_by(Conversation.updated_at.desc()).all()

    result = []
    for conv in conversations:
        msg_count = db.query(Message).filter(Message.conversation_id == conv.id).count()
        result.append(
            ConversationResponse(
                id=conv.id,
                title=conv.title,
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
    conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    msg_count = db.query(Message).filter(Message.conversation_id == conversation.id).count()

    return ConversationResponse(
        id=conversation.id,
        title=conversation.title,
        current_agent=conversation.current_agent,
        created_at=conversation.created_at.isoformat(),
        updated_at=conversation.updated_at.isoformat(),
        message_count=msg_count,
    )


@router.put("/{conversation_id}")
async def update_conversation(conversation_id: str, payload: ConversationUpdate, db=Depends(get_db)):
    """Update a conversation."""
    conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if payload.title is not None:
        conversation.title = payload.title
    if payload.current_agent is not None:
        conversation.current_agent = payload.current_agent

    conversation.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {"success": True}


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(conversation_id: str, request: Request, db=Depends(get_db)):
    """Delete a conversation and cleanup session."""
    container = request.app.state.container
    conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    try:
        await container.session_manager.cleanup_session(conversation_id, db=db)
    except Exception as e:
        logger.warning(f"Failed to cleanup session: {e}")

    try:
        db.query(Message).filter(Message.conversation_id == conversation_id).delete()
        db.delete(conversation)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete: {str(e)}")


@router.get("/{conversation_id}/messages")
async def list_messages(conversation_id: str, db=Depends(get_db)):
    """List all messages in a conversation."""
    conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = (
        db.query(Message).filter(Message.conversation_id == conversation_id).order_by(Message.created_at.asc()).all()
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
    conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
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
    conversation.updated_at = datetime.now(timezone.utc)
    if payload.agent:
        conversation.current_agent = payload.agent
    db.commit()

    # Start background processing
    if payload.mode == "workflow" and payload.workflow_id:
        # Workflow mode
        workflow = db.query(Workflow).filter(Workflow.id == payload.workflow_id).first()
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")

        execution = WorkflowExecution(
            workflow_id=payload.workflow_id,
            conversation_id=conversation_id,
            status="pending",
        )
        db.add(execution)
        db.commit()
        db.refresh(execution)

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
        # Agent mode — direct routing via --agent flag
        agent = payload.agent or conversation.current_agent or "fin-orchestrator"

        background_tasks.add_task(
            _process_agent_message,
            conversation_id=conversation_id,
            message_id=str(user_msg.id),
            content=payload.content,
            agent=agent,
            backend=container.backend,
            session_manager=container.session_manager,
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
