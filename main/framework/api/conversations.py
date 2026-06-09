"""Conversation API - CRUD + message handling."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status

from main.framework.models.conversation import Conversation, Message
from main.framework.models.database import get_db
from main.framework.models.workflow import Workflow
from main.framework.models.workflow_execution import WorkflowExecution
from main.framework.schemas.conversation import (
    ConversationCreate,
    ConversationResponse,
    ConversationUpdate,
    MessageCreate,
    MessageResponse,
)
from main.framework.services.message_processor import execute_workflow_async, process_agent_message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/conversations", tags=["conversations"])


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

    conversation.updated_at = datetime.now(UTC)
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
        raise HTTPException(status_code=500, detail=f"Failed to delete: {str(e)}") from e


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
    conversation.updated_at = datetime.now(UTC)
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
            execute_workflow_async,
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
            process_agent_message,
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
