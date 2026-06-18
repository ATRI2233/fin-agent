"""Conversation API schemas — request/response models.

All Pydantic V2 models (Pydantic 2.10+ in this repo). Each model carries:

* A short class docstring describing the contract.
* ``model_config = ConfigDict(json_schema_extra=...)`` with a realistic example
  so the auto-generated ``/openapi.json`` is documentation-grade and Swagger UI
  / ReDoc display a meaningful payload for "Try it out".
* ``Field(..., description=...)`` on ambiguous fields (enums, free-form dicts,
  timestamp strings) so each property is self-describing in the schema.

Field names, types, defaults, and validators are unchanged — this module
only adds metadata. ORM defaults (e.g. ``current_agent="fin-orchestrator"``)
are referenced in examples but do NOT alter the schema's required-field set.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class ConversationCreate(BaseModel):
    """Request body for ``POST /api/v1/conversations``.

    Creates a new (empty) conversation row. The server assigns the UUID and
    the default agent (``fin-orchestrator``) — the client only chooses a title.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "Payload to create a new conversation. "
                "All fields are optional; omitting `title` yields the default "
                "'New Conversation' label."
            ),
            "example": {
                "title": "A 股周度复盘 - 2026-06-10",
            },
        }
    )

    title: str | None = Field(
        default="New Conversation",
        description=(
            "Human-readable conversation title shown in the sidebar. "
            "If omitted, the server uses the default 'New Conversation'."
        ),
    )


class ConversationUpdate(BaseModel):
    """Request body for ``PUT /api/v1/conversations/{id}``.

    Partial update — every field is optional. Only fields present in the
    payload are written. The server bumps ``updated_at`` automatically.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "Partial update payload. At least one of `title` or "
                "`current_agent` should be provided; both are optional."
            ),
            "example": {
                "title": "A 股周度复盘 - 重命名为'白酒板块跟踪'",
                "current_agent": "fundamental-auditor",
            },
        }
    )

    title: str | None = Field(
        default=None,
        description="New conversation title. ``null`` or omitted leaves it unchanged.",
    )
    current_agent: str | None = Field(
        default=None,
        description=(
            "Switch the active agent for future messages in this conversation. "
            "Must be one of the registered agent names (e.g. "
            "'fin-orchestrator', 'fundamental-auditor', 'technical-chartist')."
        ),
    )


class MessageCreate(BaseModel):
    """Request body for ``POST /api/v1/conversations/{id}/messages``.

    User-sent message that kicks off an agent or workflow dispatch (202
    Accepted — processing is async). Exactly one of ``agent`` (when
    ``mode='agent'``) or ``workflow_id`` (when ``mode='workflow'``) is used;
    both are optional in the schema because the server falls back to the
    conversation's ``current_agent`` when ``agent`` is absent.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "Outbound user message. The content is dispatched to an agent "
                "or workflow asynchronously; the response is 202 Accepted with "
                "the persisted user message echo."
            ),
            "example": {
                "content": "请分析一下贵州茅台近 5 个季度的毛利率变化趋势，并给出风险提示。",
                "mode": "agent",
                "agent": "fundamental-auditor",
                "workflow_id": None,
            },
        }
    )

    content: str = Field(
        ...,
        max_length=10000,
        description=(
            "Raw message text from the user. Maximum 10,000 characters. Markdown is allowed and rendered in the WebUI."
        ),
    )
    mode: str = Field(
        default="agent",
        description=(
            "Dispatch mode. Must be one of: 'agent' (single-agent chat) or "
            "'workflow' (DAG execution). Defaults to 'agent'."
        ),
    )
    agent: str | None = Field(
        default=None,
        description=(
            "Target agent name for ``mode='agent'``. If omitted, the server "
            "uses the conversation's ``current_agent`` (default: "
            "'fin-orchestrator'). Ignored when ``mode='workflow'``."
        ),
    )
    workflow_id: str | None = Field(
        default=None,
        description=("Workflow UUID for ``mode='workflow'``. Required when ``mode='workflow'``; ignored otherwise."),
    )


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class MessageResponse(BaseModel):
    """A single message in a conversation (user / assistant / system / workflow)."""

    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "Persisted message — either written by the user, returned by an "
                "agent, emitted by the system, or produced by a workflow node."
            ),
            "example": {
                "id": "msg_8f14e45fceea167a5a36dedd4bea2543",
                "role": "assistant",
                "content": "贵州茅台 2026 Q1 毛利率为 92.1%，环比 +0.3pp……",
                "agent": "fundamental-auditor",
                "workflow_id": None,
                "execution_id": None,
                "extra_data": {
                    "tools_used": ["ashare_financial_report", "risk_metrics"],
                    "tokens": 1247,
                },
                "created_at": "2026-06-10T08:32:15.123456+00:00",
            },
        }
    )

    id: str = Field(description="Server-assigned message ID (string, not necessarily UUID).")
    role: str = Field(
        description=("Message author. One of: 'user', 'assistant', 'system', 'workflow'."),
    )
    content: str = Field(description="Message body. May contain Markdown.")
    agent: str | None = Field(
        default=None,
        description="Agent that produced this message (assistant / workflow roles only).",
    )
    workflow_id: str | None = Field(
        default=None,
        description="Owning workflow ID when ``role='workflow'``.",
    )
    execution_id: str | None = Field(
        default=None,
        description="WorkflowExecution ID when ``role='workflow'``.",
    )
    extra_data: dict | None = Field(
        default=None,
        description=(
            'Free-form metadata bag — typically ``{"tools_used": [...], '
            '"tokens": int, ...}``. Shape is not enforced; consumers should '
            "treat unknown keys as forward-compatible."
        ),
    )
    created_at: str = Field(
        description="ISO-8601 UTC timestamp (e.g. '2026-06-10T08:32:15.123456+00:00').",
    )


class ConversationResponse(BaseModel):
    """Conversation metadata returned by GET / POST / list endpoints."""

    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "Conversation summary. The list endpoint returns an array of these; GET / POST return a single object."
            ),
            "example": {
                "id": "conv_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                "title": "A 股周度复盘 - 2026-06-10",
                "current_agent": "fin-orchestrator",
                "created_at": "2026-06-10T08:00:00.000000+00:00",
                "updated_at": "2026-06-10T08:32:15.123456+00:00",
                "message_count": 4,
            },
        }
    )

    id: str = Field(description="Server-assigned conversation UUID.")
    title: str = Field(description="Human-readable title shown in the sidebar.")
    current_agent: str = Field(
        description=(
            "Active agent name used for the next message when no explicit "
            "``agent`` is supplied. Defaults to 'fin-orchestrator' on creation."
        ),
    )
    created_at: str = Field(
        description="ISO-8601 UTC timestamp of conversation creation.",
    )
    updated_at: str = Field(
        description="ISO-8601 UTC timestamp of the last message / metadata change.",
    )
    message_count: int = Field(
        default=0,
        description="Number of messages in the conversation (counted at response time).",
    )
