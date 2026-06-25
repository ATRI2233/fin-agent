/**
 * Typed wrappers for the Conversation API.
 *
 * Source of truth: `src/main/api/v1/conversations.py`
 * (FastAPI router at `/api/v1/conversations`). Each function maps 1:1 to a
 * route handler and preserves the snake_case wire format — do NOT
 * auto-convert field names; the server speaks snake_case and the WebUI
 * must consume it as-is.
 *
 * The transport layer (`apiGet` / `apiPost`) is defined in `./http` and
 * is responsible for base-URL resolution, JSON encoding, error
 * normalisation, and response unwrapping.
 *
 * Exported symbols (de-facto `__all__`):
 * - listConversations — GET /api/v1/conversations
 * - createConversation — POST /api/v1/conversations
 * - getConversation — GET /api/v1/conversations/{id} (response includes messages)
 * - createMessage — POST /api/v1/conversations/{id}/messages
 */

import { apiDelete, apiGet, apiPost } from './http'
import type {
  Conversation,
  Message,
  MessageCreate,
} from '../domain/conversation'
import { ROUTES } from './contract'

/**
 * GET `/api/v1/conversations` — list all conversations in the system.
 *
 * Returns a summary view (id, title, current_agent, timestamps,
 * message_count) sorted by the server's default ordering
 * (most-recently-updated first).
 */
export async function listConversations(): Promise<Conversation[]> {
  return apiGet<Conversation[]>(ROUTES.conversations.list)
}

/**
 * POST `/api/v1/conversations` — create a new empty conversation.
 *
 * @param data Request body. `agent_name` is REQUIRED
 * (see `ConversationCreate` in `src/main/api/v1/conversations.py:39`).
 * `title` is optional; the server defaults to 'New Conversation'.
 * The conversation UUID is server-assigned.
 * @returns The newly-created conversation (201 Created).
 */
export async function createConversation(data: {
  agent_name: string
  title?: string
}): Promise<Conversation> {
  return apiPost<Conversation>(ROUTES.conversations.create, data)
}

/**
 * GET `/api/v1/conversations/{id}` — fetch a single conversation by ID.
 *
 * The response payload includes the conversation row AND its
 * messages array (see `src/main/api/v1/conversations.py:166`), so
 * callers do not need a separate `listMessages` round-trip.
 *
 * Note: the returned shape is `{ conversation, messages }` — the
 * frontend hooks/page layer is responsible for unwrapping the
 * envelope. The TypeScript return type reflects the raw envelope so
 * the contract stays explicit.
 *
 * @param id Server-assigned conversation UUID.
 * @returns Full conversation row plus its messages. Throws on 404.
 */
export async function getConversation(id: string): Promise<{
  conversation: Conversation
  messages: Message[]
}> {
  const payload = await apiGet<{
    conversation: Conversation
    messages: Message[]
  }>(ROUTES.conversations.get(id))
  return payload
}

/**
 * POST `/api/v1/conversations/{id}/messages` — append a message to a
 * conversation.
 *
 * The server persists the message immediately (201 Created). For
 * `role='user'` dispatches the agent / workflow kickoff happens
 * asynchronously — the assistant reply arrives later via the
 * conversation polling or future streaming channel.
 *
 * @param conversationId Owning conversation UUID.
 * @param data Message body — see {@link MessageCreate}.
 *   The backend (`src/main/api/v1/conversations.py:51`) currently
 *   accepts `{ role?, content }`; the richer frontend shape
 *   (`mode`, `agent`, `workflow_id`) is preserved for forward
 *   compatibility and will be ignored by the server when absent.
 * @returns The persisted message dict.
 */
export async function createMessage(
  conversationId: string,
  data: MessageCreate,
): Promise<Message> {
  return apiPost<Message>(ROUTES.conversations.messages(conversationId), { ...data, role: 'user' })
}

/**
 * DELETE `/api/v1/conversations/{id}` — delete a conversation.
 *
 * Removes the conversation and all its messages from the server.
 * Returns 204 No Content on success.
 *
 * @param id Server-assigned conversation UUID.
 */
export async function deleteConversation(id: string): Promise<void> {
  await apiDelete(ROUTES.conversations.delete(id));
}