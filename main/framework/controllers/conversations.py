"""Conversation HTTP routes — thin handlers that delegate to ConversationService.

Each endpoint is a thin shell:
  1. Validate the request via Pydantic schemas.
  2. Call one (or a few) ``ConversationService`` methods.
  3. Translate ``NotFoundError`` → 404.
  4. Schedule async work via ``BackgroundTasks`` for the message endpoints.

Business logic lives in:
  - ``ConversationService`` — CRUD, user-message persistence, workflow-execution creation
  - ``message_processor``    — async ``process_agent_message`` + ``execute_workflow_async`` tasks

DI strategy
-----------
Per Wave 4.3 the controllers use ``Depends(get_service(...))`` exclusively.
The DB session is sourced from the injected ``ConversationRepository`` via
its ``_session()`` context manager (the same pattern that
``SessionService`` uses internally for per-call db access). This keeps the
legacy db-session hook and the global-state container access out of the
controllers — the container is now reached via ``get_container()`` for
async-workflow dispatch.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from main.framework.api.problems import ProblemDetail
from main.framework.core.container import get_container, get_service
from main.framework.repositories.conversation_repo import ConversationRepository
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

# Reusable error response definitions for OpenAPI documentation.
# FastAPI merges these into the generated schema under ``components.responses``.
_PROBLEM_MEDIA = "application/problem+json"
_PROBLEM_SCHEMA = ProblemDetail.model_json_schema()

_ERROR_404: dict[int | str, Any] = {
    "description": "Resource not found",
    "content": {_PROBLEM_MEDIA: {"schema": _PROBLEM_SCHEMA}},
}
_ERROR_422: dict[int | str, Any] = {
    "description": "Validation error",
    "content": {_PROBLEM_MEDIA: {"schema": _PROBLEM_SCHEMA}},
}
_ERROR_500: dict[int | str, Any] = {
    "description": "Internal server error",
    "content": {_PROBLEM_MEDIA: {"schema": _PROBLEM_SCHEMA}},
}

# Compound dicts composed per-endpoint to keep decorator lines short.
_RESP_GET: dict[int | str, Any] = {404: _ERROR_404, 500: _ERROR_500}
_RESP_POST: dict[int | str, Any] = {422: _ERROR_422, 500: _ERROR_500}
_RESP_DELETE: dict[int | str, Any] = {404: _ERROR_404, 500: _ERROR_500}


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


@router.post("", status_code=status.HTTP_201_CREATED, responses=_RESP_POST)
async def create_conversation(
    payload: ConversationCreate,
    conv_repo: ConversationRepository = Depends(get_service(ConversationRepository)),
    service: ConversationService = Depends(get_service(ConversationService)),
):
    """Create a new conversation."""
    with conv_repo._session() as db:
        return service.create(payload, db)


@router.get("")
async def list_conversations(
    conv_repo: ConversationRepository = Depends(get_service(ConversationRepository)),
    service: ConversationService = Depends(get_service(ConversationService)),
):
    """List all conversations."""
    with conv_repo._session() as db:
        return service.list(db)


@router.get("/{conversation_id}", responses=_RESP_GET)
async def get_conversation(
    conversation_id: str,
    conv_repo: ConversationRepository = Depends(get_service(ConversationRepository)),
    service: ConversationService = Depends(get_service(ConversationService)),
):
    """Get a conversation by ID."""
    try:
        with conv_repo._session() as db:
            return service.get(conversation_id, db)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Conversation not found") from err


@router.put("/{conversation_id}")
async def update_conversation(
    conversation_id: str,
    payload: ConversationUpdate,
    conv_repo: ConversationRepository = Depends(get_service(ConversationRepository)),
    service: ConversationService = Depends(get_service(ConversationService)),
):
    """Update a conversation."""
    try:
        with conv_repo._session() as db:
            return {"success": service.update(conversation_id, payload, db)}
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Conversation not found") from err


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: str,
    conv_repo: ConversationRepository = Depends(get_service(ConversationRepository)),
    service: ConversationService = Depends(get_service(ConversationService)),
):
    """Delete a conversation and cleanup session."""
    try:
        with conv_repo._session() as db:
            service.delete(conversation_id, db)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Conversation not found") from err


@router.get("/{conversation_id}/messages")
async def list_messages(
    conversation_id: str,
    conv_repo: ConversationRepository = Depends(get_service(ConversationRepository)),
    service: ConversationService = Depends(get_service(ConversationService)),
):
    """List all messages in a conversation."""
    try:
        with conv_repo._session() as db:
            return service.list_messages(conversation_id, db)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Conversation not found") from err


@router.post("/{conversation_id}/messages", status_code=status.HTTP_202_ACCEPTED)
async def send_message(
    conversation_id: str,
    payload: MessageCreate,
    background_tasks: BackgroundTasks,
    conv_repo: ConversationRepository = Depends(get_service(ConversationRepository)),
    service: ConversationService = Depends(get_service(ConversationService)),
):
    """Send a message (async processing)."""
    container = get_container()
    try:
        with conv_repo._session() as db:
            conv_resp = service.get(conversation_id, db)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Conversation not found") from err
    with conv_repo._session() as db:
        user_msg = service.save_user_message(conversation_id, payload.content, db)
    if payload.mode == "workflow" and payload.workflow_id:
        return await _dispatch_workflow(
            background_tasks, container, service, conversation_id, payload, user_msg, conv_repo
        )
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
    conv_repo: ConversationRepository,
):
    """Workflow branch: create execution record, then schedule background task."""
    # Caller guarantees workflow_id is non-None via the `payload.mode == "workflow" and payload.workflow_id` check.
    workflow_id = payload.workflow_id
    assert workflow_id is not None
    try:
        with conv_repo._session() as db:
            execution = service.start_workflow_execution(conversation_id, workflow_id, db)
    except NotFoundError as err:
        raise HTTPException(status_code=404, detail="Workflow not found") from err
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
