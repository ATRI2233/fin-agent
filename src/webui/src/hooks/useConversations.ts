/**
 * React hooks wrapping `api/conversations.ts` — the conversation CRUD and
 * message dispatch surface. Every hook uses `useQuery` / `useMutation`
 * from @tanstack/react-query so loading / error / cache semantics stay
 * uniform across the app.
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
 * short-circuit when the id is `null` — the query is disabled so
 * `data` remains `null`; callers should gate on the id before
 * consuming `data`.
 * - Mutation hooks return `{ mutate, loading, error }`; callers
 * `await mutate(...)` to chain post-mutation navigation or toasts.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import {
  createConversation,
  createMessage,
  getConversation,
  listConversations,
} from '../api/conversations';
import type {
  Conversation,
  ConversationCreate,
  Message,
  MessageCreate,
} from '../domain/conversation';

/* ─── Query keys ─────────────────────────────────────────────────────── */

export const conversationKeys = {
  all: ['conversations'] as const,
  list: () => [...conversationKeys.all, 'list'] as const,
  detail: (id: string) => [...conversationKeys.all, 'detail', id] as const,
};

/* ─── Read hooks (2) ───────────────────────────────────────────────── */

/**
 * List every conversation in the system (summary view, newest first).
 * Auto-refreshes on mount only; pair with `refetch` after create
 * to keep the sidebar in sync.
 */
export function useConversations() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: conversationKeys.list(),
    queryFn: () => listConversations(),
  });
  return {
    data: data ?? null,
    loading: isLoading,
    error: error as Error | null,
    refetch,
  };
}

/**
 * Fetch a single conversation by id (includes its messages envelope).
 *
 * Short-circuits when `id` is `null` (e.g. nothing is selected): the
 * query is disabled so `data` remains `null`.
 *
 * @param id Conversation UUID, or `null` to skip the request.
 */
export function useConversation(id: string | null) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: conversationKeys.detail(id ?? ''),
    queryFn: () => {
      if (!id) return Promise.resolve<{ conversation: Conversation; messages: Message[] } | null>(null);
      return getConversation(id);
    },
    enabled: !!id,
  });
  return {
    data: data ?? null,
    loading: isLoading,
    error: error as Error | null,
    refetch,
  };
}

/* ─── Write hooks (2) ──────────────────────────────────────────────── */

/**
 * Create a new empty conversation.
 *
 * Backend assigns the UUID and defaults `current_agent` to
 * 'fin-orchestrator'; the client only chooses a title.
 */
export function useCreateConversation() {
  const queryClient = useQueryClient();
  const { mutateAsync, isPending, error } = useMutation<
    Conversation,
    Error,
    ConversationCreate
  >({
    mutationFn: (data: ConversationCreate) => createConversation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: conversationKeys.all });
    },
  });
  return {
    mutate: mutateAsync,
    loading: isPending,
    error: error ?? null,
  };
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
 * {@link Message} carries the persisted user-message echo and an
 * optional `execution_id` for workflow dispatches.
 */
export function useCreateMessage() {
  const { mutateAsync, isPending, error } = useMutation<
    Message,
    Error,
    { conversationId: string; data: MessageCreate }
  >({
    mutationFn: ({ conversationId, data }) => createMessage(conversationId, data),
  });
  return {
    mutate: mutateAsync,
    loading: isPending,
    error: error ?? null,
  };
}
