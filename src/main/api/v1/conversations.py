"""API v1 conversations router — conversation + message endpoints.

TASK-408 §3.3.6 端点定义:
    - GET  /api/v1/conversations (list)
    - POST /api/v1/conversations (create)
    - GET  /api/v1/conversations/{id} (detail + messages)
    - POST /api/v1/conversations/{id}/messages (append)

底层服务: ``ConversationService`` Protocol,实现为
``DefaultConversationService``(``modules/conversation/service``)。
所有方法 ``async``(Protocol 强制)。

约定:
- ``trace_id`` 取自 ``current_trace_id()``,不依赖入参(Do Not #18)。
- ``MessageRole`` 通过 ``conversation_service.py`` 的 forward ref
  在 API 层显式 import,避免 Protocol/dict 循环。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from src.main.api.deps import service_dep
from src.main.infra.api_envelope import ApiResponse
from src.main.infra.domain import AgentReference, ConversationId
from src.main.infra.tracing import current_trace_id
from src.main.modules.conversation.domain.message import MessageRole
from src.main.modules.conversation.protocol import ConversationService

router = APIRouter(prefix="/api/v1/conversations", tags=["conversations"])


# ── Pydantic 请求模型 ──


class ConversationCreate(BaseModel):
    """创建会话请求体。

    Attributes:
        agent_name: Agent 名称。
        title: 可选标题。
    """

    agent_name: str
    title: str | None = None


class MessageAppend(BaseModel):
    """追加消息请求体。

    Attributes:
        role: 消息角色(``"user"`` / ``"assistant"`` / ``"system"``)。
        content: 消息内容。
    """

    role: str = Field(default="user")
    content: str


# ── Helpers ──


def _conversation_to_dict(conv: Any) -> dict:
    """``Conversation`` -> dict。"""
    if conv is None:
        return {}
    agent = getattr(conv, "agent", None)
    return {
        "id": str(getattr(conv, "id", "")),
        "agent": {
            "name": getattr(agent, "name", ""),
            "definition_path": str(getattr(agent, "definition_path", ""))
            if getattr(agent, "definition_path", None) is not None
            else None,
        },
        "title": getattr(conv, "title", None),
        "created_at": _iso(getattr(conv, "created_at", None)),
        "updated_at": _iso(getattr(conv, "updated_at", None)),
    }


def _message_to_dict(msg: Any) -> dict:
    """``Message`` -> dict。"""
    if msg is None:
        return {}
    return {
        "id": str(getattr(msg, "id", "")),
        "conversation_id": str(getattr(msg, "conversation_id", "")),
        "role": str(getattr(msg, "role", "")),
        "content": getattr(msg, "content", ""),
        "created_at": _iso(getattr(msg, "created_at", None)),
    }


def _iso(value: Any) -> str | None:
    """``datetime`` -> ISO 字符串(否则原样 str / None)。"""
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _parse_role(raw: str) -> MessageRole:
    """字符串 -> ``MessageRole`` 枚举。

    Raises:
        ValueError: 角色字符串不在枚举内。
    """
    try:
        return MessageRole(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"invalid role: {raw!r} (must be one of {[r.value for r in MessageRole]})",
        ) from exc


# ── Endpoints ──


@router.get("")
async def list_conversations(
    limit: int = Query(default=20),
    offset: int = Query(default=0),
    svc: ConversationService = Depends(service_dep(ConversationService)),
) -> dict:
    """分页列出会话。

    Args:
        limit: 返回条数上限。
        offset: 分页偏移。
        svc: ``ConversationService`` 注入。

    Returns:
        ``ApiResponse`` 信封,``data`` 为会话字典列表。
    """
    items = await svc.list(limit=limit, offset=offset)
    payload = [_conversation_to_dict(c) for c in items]
    return ApiResponse.success(payload, current_trace_id()).to_dict()


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_conversation(
    body: ConversationCreate,
    svc: ConversationService = Depends(service_dep(ConversationService)),
) -> dict:
    """创建新会话。

    Args:
        body: 包含 ``agent_name`` 和可选 ``title``。
        svc: ``ConversationService`` 注入。

    Returns:
        ``ApiResponse`` 信封,``data`` 为新建会话字典。
    """
    agent = AgentReference(name=body.agent_name, definition_path=None)
    conv = await svc.create(agent, body.title)
    return ApiResponse.success(
        _conversation_to_dict(conv), current_trace_id()
    ).to_dict()


@router.get("/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    limit: int = Query(default=100),
    offset: int = Query(default=0),
    svc: ConversationService = Depends(service_dep(ConversationService)),
) -> dict:
    """获取会话详情(含消息列表)。

    Args:
        conversation_id: 会话 ID。
        limit: 消息分页上限。
        offset: 消息分页偏移。
        svc: ``ConversationService`` 注入。

    Returns:
        ``ApiResponse`` 信封,``data`` 为
        ``{"conversation": ..., "messages": [...]}``。
    """
    conv = await svc.get(ConversationId(conversation_id))
    if conv is None:
        raise HTTPException(
            status_code=404,
            detail=f"Conversation {conversation_id} not found",
        )
    messages = await svc.get_messages(
        ConversationId(conversation_id), limit=limit, offset=offset
    )
    payload = {
        "conversation": _conversation_to_dict(conv),
        "messages": [_message_to_dict(m) for m in messages],
    }
    return ApiResponse.success(payload, current_trace_id()).to_dict()


@router.post("/{conversation_id}/messages", status_code=status.HTTP_201_CREATED)
async def append_message(
    conversation_id: str,
    body: MessageAppend,
    svc: ConversationService = Depends(service_dep(ConversationService)),
) -> dict:
    """向会话追加一条消息。

    Args:
        conversation_id: 会话 ID。
        body: ``{role, content}``。
        svc: ``ConversationService`` 注入。

    Returns:
        ``ApiResponse`` 信封,``data`` 为追加的消息字典。
    """
    role = _parse_role(body.role)
    msg = await svc.append_message(
        ConversationId(conversation_id), role, body.content
    )
    return ApiResponse.success(_message_to_dict(msg), current_trace_id()).to_dict()
