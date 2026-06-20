/**
 * Zustand store for the currently active conversation and its message list.
 *
 * — replaces cross-page prop drilling of `currentConversation`
 * and `messages` between `ChatPage` and `SessionsPage`. The store is
 * session-scoped (no `persist` middleware) because the server is the source of
 * truth: reloading the app re-fetches from `GET /api/v1/conversations`.
 *
 * Consumed by:
 * - `pages/ChatPage.tsx` — reads/writes current conversation & messages
 * - `pages/SessionsPage.tsx` — reads current conversation to highlight it
 *
 * Zustand v4 typing pattern: `create<State>()((set) => ({...}))`. The trailing
 * `()` is required so TypeScript can infer the state shape from the curried
 * factory form. See https://zustand.docs.pmnd.rs/typescript for details.
 */

import { create } from 'zustand';
import type { Conversation, Message } from '../domain/conversation';

/**
 * Shape of the conversation store.
 *
 * Kept intentionally minimal — only state that is genuinely shared across
 * pages. Per-conversation UI flags (input value, polling state, pending
 * message id, etc.) stay local to `ChatPage` and MUST NOT be added here.
 */
export interface ConversationState {
  /** The conversation currently open in the chat view, or `null` if none. */
  currentConversation: Conversation | null;
  /** Messages of `currentConversation`, ordered oldest → newest. */
  messages: Message[];

  /**
   * Set the active conversation. Does NOT clear `messages` — callers should
   * chain `setMessages([])` (or `setMessages(loadedMsgs)`) when switching
   * to avoid briefly showing stale messages from a previous conversation.
   */
  setCurrentConversation: (conv: Conversation | null) => void;
  /** Convenience: clear the active conversation and its messages in one call. */
  clearCurrentConversation: () => void;
  /** Replace the message list wholesale (e.g. after `GET /messages`). */
  setMessages: (msgs: Message[]) => void;
  /** Append a single message — typically a streaming assistant delta. */
  appendMessage: (msg: Message) => void;
}

/**
 * Conversation store hook. Import as either:
 * - default: `import useConversationStore from '.../useConversationStore'`
 * - named: `import { useConversationStore } from '.../useConversationStore'`
 *
 * Usage:
 * ```tsx
 * const currentConversation = useConversationStore((s) => s.currentConversation);
 * const setMessages = useConversationStore((s) => s.setMessages);
 * ```
 */
export const useConversationStore = create<ConversationState>()((set) => ({
  currentConversation: null,
  messages: [],

  setCurrentConversation: (conv) => set({ currentConversation: conv }),

  clearCurrentConversation: () => set({ currentConversation: null, messages: [] }),

  setMessages: (msgs) => set({ messages: msgs }),

  appendMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
}));

export default useConversationStore;
