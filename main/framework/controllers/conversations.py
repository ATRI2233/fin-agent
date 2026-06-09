"""Conversation HTTP routes — thin handlers that delegate to ConversationService.

Each endpoint is a thin shell:
  1. Validate the request via Pydantic schemas.
  2. Call one (or a few) ``ConversationService`` methods.
  3. Translate ``NotFoundError`` → 404.
  4. Schedule async work via ``BackgroundTasks`` for the message endpoints.

Business logic lives in:
  - ``ConversationService`` — CRUD, user-message persistence, workflow-execution creation
  - ``message_processor``    — async ``process_agent_message`` + ``execute_workflow_async`` tasks
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from main.framework.core.container import get_service
from main.framework.models.database import get_db
from main.framework.schemas.conversation import (
    ConversationCreate,
    ConversationResponse,
    ConversationUpdate,
    MessageCreate,
    MessageResponse,
)
from main.framework.services.conversation_service import ConversationService
from main.framework.services.exceptions import NotFoundError
from main.framework.services.message_processor import (
    execute_workflow_async,
    process_agent_message,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/conversations", tags=["conversations"])


# ---------------------------------------------------------------------------
# Small response-builder helper — keeps the send_message endpoint readable.
# ---------------------------------------------------------------------------


def _user_message_response(user_msg) -> MessageResponse:
    """Build a MessageResponse for a persisted user message."""
    return MessageResponse(
        id=user_msg.id,
        role=user_msg.role,
        content=user_msg.content,
        created_at=user_msg.created_at.isoformat(),
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_conversation(
    payload: ConversationCreate,
    db: Session = Depends(get_db),
    service: ConversationService = Depends(get_service(ConversationService)),
):
    """Create a new conversation."""
    return service.create(payload, db)


@router.get("")
async def list_conversations(
    db: Session = Depends(get_db),
    service: ConversationService = Depends(get_service(ConversationService)),
):
    """List all conversations."""
    return service.list(db)


@router.get("/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    service: ConversationService = Depends(get_service(ConversationService)),
):
    """Get a conversation by ID."""
    try:
        return service.get(conversation_id, db)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")


@router.put("/{conversation_id}")
async def update_conversation(
    conversation_id: str,
    payload: ConversationUpdate,
    db: Session = Depends(get_db),
    service: ConversationService = Depends(get_service(ConversationService)),
):
    """Update a conversation."""
    try:
        return {"success": service.update(conversation_id, payload, db)}
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    service: ConversationService = Depends(get_service(ConversationService)),
):
    """Delete a conversation and cleanup session."""
    try:
        service.delete(conversation_id, db)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")


@router.get("/{conversation_id}/messages")
async def list_messages(
    conversation_id: str,
    db: Session = Depends(get_db),
    service: ConversationService = Depends(get_service(ConversationService)),
):
    """List all messages in a conversation."""
    try:
        return service.list_messages(conversation_id, db)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")


@router.post("/{conversation_id}/messages", status_code=status.HTTP_202_ACCEPTED)
async def send_message(
    conversation_id: str,
    payload: MessageCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    service: ConversationService = Depends(get_service(ConversationService)),
):
    """Send a message (async processing)."""
    container = request.app.state.container
    try:
        conv_resp = service.get(conversation_id, db)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")
    user_msg = service.save_user_message(conversation_id, payload.content, db)
    if payload.mode == "workflow" and payload.workflow_id:
        return await _dispatch_workflow(background_tasks, container, service, conversation_id, payload, user_msg, db)
    return await _dispatch_agent(background_tasks, container, conversation_id, payload, user_msg, conv_resp)


# ---------------------------------------------------------------------------
# send_message sub-helpers — split the two dispatch branches out of the
# endpoint body so the route handler stays ≤15 lines.
# ---------------------------------------------------------------------------


async def _dispatch_workflow(
    background_tasks: BackgroundTasks,
    container,
    service: ConversationService,
    conversation_id: str,
    payload: MessageCreate,
    user_msg,
    db: Session,
):
    """Workflow branch: create execution record, then schedule background task."""
    # Caller guarantees workflow_id is non-None via the `payload.mode == "workflow" and payload.workflow_id` check.
    workflow_id = payload.workflow_id
    assert workflow_id is not None
    try:
        execution = service.start_workflow_execution(conversation_id, workflow_id, db)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Workflow not found")
    background_tasks.add_task(
        execute_workflow_async,
        conversation_id=conversation_id,
        execution_id=str(execution.id),
        workflow_id=workflow_id,
        params={"question": payload.content},
        container=container,
    )
    return {
        "user_message": _user_message_response(user_msg),
        "status": "workflow_started",
        "execution_id": str(execution.id),
    }


async def _dispatch_agent(
    background_tasks: BackgroundTasks,
    container,
    conversation_id: str,
    payload: MessageCreate,
    user_msg,
    conv_resp: ConversationResponse,
):
    """Agent branch: resolve target agent, then schedule background task."""
    agent = payload.agent or conv_resp.current_agent or "fin-orchestrator"
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
        "user_message": _user_message_response(user_msg),
        "status": "processing",
    }
