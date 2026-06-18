/**
 * TypeScript types for the Conversation API.
 *
 * Source of truth: `project/main/framework/schemas/conversation.py`
 * (Pydantic V2). Field names are kept in snake_case to match the wire
 * format — FastAPI + Pydantic v2 do NOT auto-convert to camelCase, so
 * what the server emits is exactly what the client must consume.
 *
 * Exported symbols (the de-facto `__all__` for this module):
 * - Conversation — single conversation row (GET / POST / list)
 * - Message — single message within a conversation
 * - ConversationCreate — POST /api/v1/conversations request body
 * - ConversationUpdate — PUT /api/v1/conversations/{id} request body
 * - MessageCreate — POST /api/v1/conversations/{id}/messages request body
 * - MessageResponse — POST /api/v1/conversations/{id}/messages response body
 */

/**
 * Conversation summary row returned by GET / POST / list endpoints.
 *
 * Mirrors the Pydantic `ConversationResponse` model.
 */
export interface Conversation {
  /** Server-assigned conversation UUID. */
  id: string;
  /** Human-readable title shown in the sidebar. */
  title: string;
  /**
   * Active agent name used for the next message when no explicit `agent`
   * is supplied. Defaults to 'fin-orchestrator' on creation.
   */
  current_agent: string;
  /** ISO-8601 UTC timestamp of conversation creation. */
  created_at: string;
  /** ISO-8601 UTC timestamp of the last message / metadata change. */
  updated_at: string;
  /** Number of messages in the conversation (counted at response time). */
  message_count: number;
}

/**
 * A single message in a conversation.
 *
 * Mirrors the Pydantic `MessageResponse` model. The backend also allows
 * role='workflow' for DAG-produced messages — not part of the public
 * ChatPage contract yet, so omitted here. Extend the union when 
 * wires workflow output back into the chat view.
 */
export interface Message {
  /** Server-assigned message ID (string, not necessarily UUID). */
  id: string;
  /** Message author. */
  role: 'user' | 'assistant' | 'system';
  /** Message body. May contain Markdown. */
  content: string;
  /** Agent that produced this message (assistant role only). */
  agent?: string;
  /** Owning workflow ID when role is 'workflow'. */
  workflow_id?: string;
  /** WorkflowExecution ID when role is 'workflow'. */
  execution_id?: string;
  /**
   * Free-form metadata bag — typically
   * `{"tools_used": string[], "tokens": number, ...}`.
   * Shape is not enforced by the server; consumers should treat unknown
   * keys as forward-compatible.
   */
  extra_data?: Record<string, unknown>;
  /** ISO-8601 UTC timestamp (e.g. '2026-06-10T08:32:15.123456+00:00'). */
  created_at: string;
}

/**
 * Request body for `POST /api/v1/conversations`.
 *
 * Mirrors the Pydantic `ConversationCreate` model. The server assigns
 * the UUID and the default agent — the client only chooses a title.
 */
export interface ConversationCreate {
  /**
   * Human-readable conversation title shown in the sidebar.
   * If omitted, the server uses the default 'New Conversation'.
   */
  title?: string;
}

/**
 * Request body for `PUT /api/v1/conversations/{id}`.
 *
 * Mirrors the Pydantic `ConversationUpdate` model. Partial update —
 * every field is optional; only fields present in the payload are
 * written. The server bumps `updated_at` automatically.
 */
export interface ConversationUpdate {
  /** New conversation title. Omit to leave unchanged. */
  title?: string;
  /**
   * Switch the active agent for future messages in this conversation.
   * Must be one of the registered agent names
   * (e.g. 'fin-orchestrator', 'fundamental-auditor', 'technical-chartist').
   */
  current_agent?: string;
}

/**
 * Request body for `POST /api/v1/conversations/{id}/messages`.
 *
 * Mirrors the Pydantic `MessageCreate` model. User-sent message that
 * kicks off an agent or workflow dispatch (202 Accepted — processing
 * is async). Exactly one of `agent` (mode='agent') or `workflow_id`
 * (mode='workflow') is used at runtime; both are optional in the
 * schema because the server falls back to the conversation's
 * `current_agent` when `agent` is absent.
 */
export interface MessageCreate {
  /**
   * Raw message text from the user. Maximum 10,000 characters.
   * Markdown is allowed and rendered in the WebUI.
   */
  content: string;
  /**
   * Dispatch mode. Must be one of: 'agent' (single-agent chat) or
   * 'workflow' (DAG execution). Defaults to 'agent'.
   */
  mode?: string;
  /**
   * Target agent name for `mode='agent'`. If omitted, the server uses
   * the conversation's `current_agent` (default: 'fin-orchestrator').
   * Ignored when `mode='workflow'`.
   */
  agent?: string;
  /**
   * Workflow UUID for `mode='workflow'`. Required when
   * `mode='workflow'`; ignored otherwise.
   */
  workflow_id?: string;
}

/**
 * Response body for `POST /api/v1/conversations/{id}/messages`.
 *
 * Wraps the persisted user message echo plus a dispatch status. The
 * actual assistant reply is delivered asynchronously (WebSocket / SSE /
 * poll on `execution_id`) and is NOT part of this response.
 */
export interface MessageResponse {
  /** The persisted user message echo (same shape as `Message`). */
  user_message: Message;
  /**
   * Dispatch status — typically 'accepted' or 'queued'. The exact
   * vocabulary is server-defined; treat unknown values as forward-
   * compatible.
   */
  status: string;
  /**
   * WorkflowExecution ID when the dispatch produced an async execution
   * (e.g. `mode='workflow'`). Use this to poll for the result.
   */
  execution_id?: string;
}
