"""Conversation API schemas — request/response models."""

from pydantic import BaseModel, Field


class ConversationCreate(BaseModel):
    title: str | None = "New Conversation"


class ConversationUpdate(BaseModel):
    title: str | None = None
    current_agent: str | None = None


class MessageCreate(BaseModel):
    content: str = Field(..., max_length=10000)
    mode: str = "agent"  # "agent" or "workflow"
    agent: str | None = None  # For agent mode
    workflow_id: str | None = None  # For workflow mode


class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    agent: str | None = None
    workflow_id: str | None = None
    execution_id: str | None = None
    extra_data: dict | None = None
    created_at: str


class ConversationResponse(BaseModel):
    id: str
    title: str
    current_agent: str
    created_at: str
    updated_at: str
    message_count: int = 0
