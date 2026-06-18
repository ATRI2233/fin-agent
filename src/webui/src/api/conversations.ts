/**
 * Typed wrappers for the Conversation API.
 *
 * Source of truth: `project/main/framework/controllers/conversations.py`
 * (FastAPI router at `/api/v1/conversations`). Each function maps 1:1 to a
 * route handler and preserves the snake_case wire format — do NOT
 * auto-convert field names; the server speaks snake_case and the WebUI
 * must consume it as-is.
 *
 * The transport layer (`apiGet` / `apiPost` / `apiPut` / `apiDelete`) is
 * defined in `./client` and is responsible for base-URL resolution,
 * JSON encoding, error normalisation, and response unwrapping.
 *
 * Exported symbols (de-facto `__all__`):
 * - listConversations — GET /api/v1/conversations
 * - getConversation — GET /api/v1/conversations/{id}
 * - createConversation — POST /api/v1/conversations
 * - updateConversation — PUT /api/v1/conversations/{id}
 * - deleteConversation — DELETE /api/v1/conversations/{id}
 * - listMessages — GET /api/v1/conversations/{id}/messages
 * - createMessage — POST /api/v1/conversations/{id}/messages
 */

import { API_V1_BASE } from '../config/env'
import { apiDelete, apiGet, apiPost, apiPut } from './client'
import type {
  Conversation,
  ConversationCreate,
  ConversationUpdate,
  Message,
  MessageCreate,
  MessageResponse,
} from '../types/conversation'

/**
 * GET `/api/v1/conversations` — list all conversations in the system.
 *
 * Returns a summary view (id, title, current_agent, timestamps,
 * message_count) sorted by the server's default ordering
 * (most-recently-updated first).
 */
export async function listConversations(): Promise<Conversation[]> {
  return apiGet<Conversation[]>(`${API_V1_BASE}/conversations`)
}

/**
 * GET `/api/v1/conversations/{id}` — fetch a single conversation by ID.
 *
 * @param id Server-assigned conversation UUID.
 * @returns Full conversation row. Throws on 404 (not found) and 500.
 */
export async function getConversation(id: string): Promise<Conversation> {
  return apiGet<Conversation>(`${API_V1_BASE}/conversations/${id}`)
}

/**
 * POST `/api/v1/conversations` — create a new empty conversation.
 *
 * @param data Request body. `title` is optional; the server defaults to
 * 'New Conversation'. The active agent defaults to
 * 'fin-orchestrator' and the UUID is server-assigned.
 * @returns The newly-created conversation (201 Created).
 */
export async function createConversation(data: ConversationCreate): Promise<Conversation> {
  return apiPost<Conversation>(`${API_V1_BASE}/conversations`, data)
}

/**
 * PUT `/api/v1/conversations/{id}` — partial update of a conversation.
 *
 * Only fields present in `data` are written; the server bumps
 * `updated_at` automatically. Returns a minimal envelope rather than
 * the full row — call `getConversation` afterwards to read back the
 * new state.
 *
 * @param id Conversation UUID to update.
 * @param data Fields to modify (`title` and/or `current_agent`).
 * @returns `{ success: true }` on successful write. Throws on 404.
 */
export async function updateConversation(
  id: string,
  data: ConversationUpdate,
): Promise<{ success: boolean }> {
  return apiPut<{ success: boolean }>(`${API_V1_BASE}/conversations/${id}`, data)
}

/**
 * DELETE `/api/v1/conversations/{id}` — delete a conversation.
 *
 * The backend returns 204 No Content; the resolved Promise is
 * `void`. Associated session state is cleaned up server-side.
 *
 * @param id Conversation UUID to delete.
 */
export async function deleteConversation(id: string): Promise<void> {
  await apiDelete<void>(`${API_V1_BASE}/conversations/${id}`)
}

/**
 * GET `/api/v1/conversations/{id}/messages` — list all messages in a
 * conversation, oldest-first (chronological).
 *
 * @param conversationId Owning conversation UUID.
 * @returns Array of `Message` rows (user / assistant / system).
 * Throws on 404 (conversation not found).
 */
export async function listMessages(conversationId: string): Promise<Message[]> {
  return apiGet<Message[]>(`${API_V1_BASE}/conversations/${conversationId}/messages`)
}

/**
 * POST `/api/v1/conversations/{id}/messages` — send a user message
 * (202 Accepted, async processing).
 *
 * The server persists the user message immediately, then schedules a
 * background task to dispatch to the agent (or kick off a workflow
 * execution). The actual assistant reply is NOT part of this
 * response — it arrives later via WebSocket / SSE / polling on
 * `execution_id`.
 *
 * @param conversationId Owning conversation UUID.
 * @param data Message body (`content` required; `mode`,
 * `agent`, `workflow_id` optional — see
 * `MessageCreate`).
 * @returns Dispatch envelope containing the persisted user-message
 * echo, a status string, and an optional `execution_id`
 * for workflow dispatches.
 */
export async function createMessage(
  conversationId: string,
  data: MessageCreate,
): Promise<MessageResponse> {
  return apiPost<MessageResponse>(
    `${API_V1_BASE}/conversations/${conversationId}/messages`,
    data,
  )
}
