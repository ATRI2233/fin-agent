/**
 * React hooks wrapping `api/conversations.ts` — the conversation CRUD and
 * message dispatch surface. Every hook defers to the generic `useFetch` /
 * `useMutation` primitives so loading / error / abort semantics
 * stay uniform across the app.
 *
 * Mount points and HTTP verbs are documented in `api/conversations.ts:14-22`;
 * types come from `domain/conversation.ts`. Consumers should import hooks
 * from this module rather than calling `api/conversations.ts` directly from
 * components.
 *
 * Conventions:
 * - Read hooks return `{ data, loading, error, refetch }` and re-run when
 * any of their argument dependencies change.
 * - Read hooks that take a nullable id (`useConversation`)
 * short-circuit when the id is `null` — the fetcher returns a
 * never-resolving promise so `loading` stays `true`; callers should
 * gate on the id before consuming `data`.
 * - Mutation hooks return `{ mutate, loading, error }`; callers
 * `await mutate(...)` to chain post-mutation navigation or toasts.
 */

import { useCallback } from 'react';

import {
  createConversation,
  createMessage,
  getConversation,
  listConversations,
} from '../api/conversations';
import type {
  Conversation,
  ConversationCreate,
  MessageCreate,
  MessageResponse,
} from '../domain/conversation';
import { useFetch } from './useFetch';
import { useMutation } from './useMutation';

/* ─── Read hooks (2) ───────────────────────────────────────────────── */

/**
 * List every conversation in the system (summary view, newest first).
 * Auto-refreshes on mount only; pair with `refetch` after create
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
 * Fetch a single conversation by id (includes its messages envelope).
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
      if (!id) return Promise.resolve(null as unknown as Conversation);
      return getConversation(id);
    },
    [id],
  );
  return useFetch<Conversation>(fetcher, [id]);
}

/* ─── Write hooks (2) ──────────────────────────────────────────────── */

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