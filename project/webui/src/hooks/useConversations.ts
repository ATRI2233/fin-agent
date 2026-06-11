/**
 * React hooks wrapping `api/conversations.ts` — the conversation CRUD and
 * message dispatch surface. Every hook defers to the generic `useFetch` /
 * `useMutation` primitives (Wave 5.1) so loading / error / abort semantics
 * stay uniform across the app.
 *
 * Mount points and HTTP verbs are documented in `api/conversations.ts:14-22`;
 * types come from `types/conversation.ts`. Consumers should import hooks
 * from this module rather than calling `api/conversations.ts` directly from
 * components.
 *
 * Conventions:
 *   - Read hooks return `{ data, loading, error, refetch }` and re-run when
 *     any of their argument dependencies change.
 *   - Read hooks that take a nullable id (`useConversation`, `useMessages`)
 *     short-circuit when the id is `null` — the fetcher returns a
 *     never-resolving promise so `loading` stays `true`; callers should
 *     gate on the id before consuming `data`.
 *   - Mutation hooks return `{ mutate, loading, error }`; callers
 *     `await mutate(...)` to chain post-mutation navigation or toasts.
 */

import { useCallback } from 'react';

import {
  createConversation,
  createMessage,
  deleteConversation,
  getConversation,
  listConversations,
  listMessages,
  updateConversation,
} from '../api/conversations';
import type {
  Conversation,
  ConversationCreate,
  ConversationUpdate,
  Message,
  MessageCreate,
  MessageResponse,
} from '../types/conversation';
import { useFetch } from './useFetch';
import { useMutation } from './useMutation';

/* ─── Read hooks (3) ───────────────────────────────────────────────── */

/**
 * List every conversation in the system (summary view, newest first).
 * Auto-refreshes on mount only; pair with `refetch` after create / delete
 * to keep the sidebar in sync.
 */
export function useConversations() {
  const fetcher = useCallback(
    (_signal: AbortSignal) => listConversations(),
    [],
  );
  return useFetch<Conversation[]>(fetcher, []);
}

/**
 * Fetch a single conversation by id.
 *
 * Short-circuits when `id` is `null` (e.g. nothing is selected): the
 * fetcher returns a never-resolving promise so `loading` stays `true`,
 * signalling "still waiting for input". Callers should gate on the id
 * before consuming `data`.
 *
 * @param id Conversation UUID, or `null` to skip the request.
 */
export function useConversation(id: string | null) {
  const fetcher = useCallback(
    (_signal: AbortSignal) => {
      if (!id) {
        // Suspended — never resolves so `loading` stays true and the
        // consumer can distinguish "no selection" via the id check.
        return new Promise<Conversation>(() => undefined);
      }
      return getConversation(id);
    },
    [id],
  );
  return useFetch<Conversation>(fetcher, [id]);
}

/**
 * List every message in a conversation, oldest-first (chronological).
 *
 * Short-circuits when `conversationId` is `null` — same convention as
 * {@link useConversation}.
 *
 * @param conversationId Owning conversation UUID, or `null` to skip.
 */
export function useMessages(conversationId: string | null) {
  const fetcher = useCallback(
    (_signal: AbortSignal) => {
      if (!conversationId) {
        return new Promise<Message[]>(() => undefined);
      }
      return listMessages(conversationId);
    },
    [conversationId],
  );
  return useFetch<Message[]>(fetcher, [conversationId]);
}

/* ─── Write hooks (4) ──────────────────────────────────────────────── */

/**
 * Create a new empty conversation.
 *
 * Backend assigns the UUID and defaults `current_agent` to
 * 'fin-orchestrator'; the client only chooses a title.
 */
export function useCreateConversation() {
  return useMutation<ConversationCreate, Conversation>(
    (data) => createConversation(data),
  );
}

/**
 * Partial update of a conversation (title and/or `current_agent`).
 *
 * Backend bumps `updated_at` automatically and returns the minimal
 * `{ success: true }` envelope. Call `refetch` on the corresponding
 * read hook afterwards to see the new state.
 */
export function useUpdateConversation() {
  return useMutation<
    { id: string; data: ConversationUpdate },
    { success: boolean }
  >(({ id, data }) => updateConversation(id, data));
}

/**
 * Delete a conversation (backend returns 204 No Content). Pass the id
 * directly to `mutate(id)`. Associated session state is cleaned up
 * server-side.
 */
export function useDeleteConversation() {
  return useMutation<string, void>((id) => deleteConversation(id));
}

/**
 * Send a user message and dispatch to the active agent or a workflow
 * (202 Accepted — processing is async).
 *
 * The server persists the user message immediately and schedules a
 * background task. The actual assistant reply is NOT part of the
 * response — it arrives later via WebSocket / SSE / polling on
 * `execution_id`.
 *
 * Pass `{ conversationId, data }` to `mutate`; the resolved
 * {@link MessageResponse} carries the persisted user-message echo and an
 * optional `execution_id` for workflow dispatches.
 */
export function useCreateMessage() {
  return useMutation<
    { conversationId: string; data: MessageCreate },
    MessageResponse
  >(({ conversationId, data }) => createMessage(conversationId, data));
}