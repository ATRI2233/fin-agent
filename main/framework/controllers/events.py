"""SSE endpoint for real-time conversation updates."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from main.framework.core.infrastructure.container import get_container
from main.framework.models.conversation import Conversation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/events", tags=["events"])

STREAM_MEDIA = "text/event-stream"
CACHE_CTRL = "no-cache, no-store, must-revalidate"
HEARTBEAT_INTERVAL_SECONDS = 30


def _sse_format(event: dict[str, Any]) -> bytes:
    """Encode a dict as a SSE ``data:`` block."""
    payload = json.dumps(event, ensure_ascii=False)
    return b"data: " + payload.encode("utf-8") + b"\n\n"


async def _event_generator(
    conversation_id: str,
    queue: asyncio.Queue[dict[str, Any]],
) -> asyncio.Generator[bytes, None, None]:
    """Yield SSE-formatted bytes from *queue* until the queue is closed."""
    try:
        # Initial connected confirmation
        yield _sse_format({"type": "connected", "conversation_id": conversation_id})

        # Heartbeat task to keep connection alive and prevent proxy timeouts
        async def heartbeat() -> None:
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
                try:
                    yield _sse_format({"type": "heartbeat"})
                except Exception:
                    break

        heartbeat_task = asyncio.create_task(heartbeat())
        try:
            while True:
                event = await queue.get()
                yield _sse_format(event)
        except asyncio.CancelledError:
            logger.debug("SSE stream cancelled for conversation %s", conversation_id)
            raise
        finally:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
    except GeneratorExit:
        pass  # Client disconnected


@router.get(
    "/conversations/{conversation_id}",
    summary="SSE stream for a conversation",
    responses={
        200: {"description": "SSE stream", "content": {"text/event-stream": {}}},
        401: {"description": "Invalid API Key"},
        404: {"description": "Conversation not found"},
    },
)
async def events_endpoint(conversation_id: str, request: Request):
    """
    GET /api/v1/events/conversations/{conversation_id}

    Opens a StreamingResponse with text/event-stream.
    Auth: APIKeyMiddleware handles X-API-Key header; for EventSource
    (which cannot send custom headers) the key may also be passed as
    ?api_key=... query parameter.
    Disconnect: asyncio.CancelledError in the generator triggers cleanup.
    """
    container = get_container()

    # Verify conversation exists before subscribing
    try:
        with container.conversation_repo._session() as db:
            exists = db.query(Conversation).filter(Conversation.id == conversation_id).first()
        if not exists:
            raise HTTPException(status_code=404, detail="Conversation not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Failed to verify conversation %s: %s", conversation_id, e)
        raise HTTPException(status_code=404, detail="Conversation not found")

    event_bus = container.event_bus
    queue = await event_bus.subscribe(conversation_id)
    logger.info("SSE subscribed to conversation %s", conversation_id)

    try:
        return StreamingResponse(
            _event_generator(conversation_id, queue),
            media_type=STREAM_MEDIA,
            headers={
                "Cache-Control": CACHE_CTRL,
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",  # Disable nginx buffering
            },
        )
    except Exception:
        await event_bus.unsubscribe(conversation_id, queue)
        raise
