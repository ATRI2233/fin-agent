/**
 * `useConversations` — page-level wrapper around the Wave 5 conversation
 * hooks + the zustand `useConversationStore`.
 *
 * Extracted from `pages/ChatPage.tsx` (Wave 6.1b). Combines three
 * concerns into one hook so the page component stays declarative:
 *
 *   1. **List** — delegates to the Wave 5 `useConversations` list hook
 *      (auto-fetch on mount, `refetch` after create/delete).
 *   2. **Selection** — the `currentConversation` lives in zustand so
 *      the sidebar's selection survives route changes; we expose
 *      the value + setter for the page to read/write.
 *   3. **Mutations** — `createConversation` / `deleteConversation` are
 *      thin wrappers that fire the Wave 5 mutations, show a toast on
 *      failure, and clear the zustand `currentConversation` when the
 *      active row is deleted. They also `refetch` the list so the
 *      sidebar stays in sync.
 *
 * The hook is named `useConversations` (same as the Wave 5 list hook
 * it composes) but lives at `pages/ChatPage/hooks/useConversations.ts`
 * so the page imports it via a relative path and avoids the collision.
 */
import { useCallback } from 'react';
import { message } from 'antd';
import {
  useConversations as useConversationsList,
  useCreateConversation,
  useDeleteConversation,
} from '../../../hooks/useConversations';
import { useConversationStore } from '../../../store/useConversationStore';
import type { Conversation } from '../../../types/conversation';

export interface UseConversationsResult {
  conversations: Conversation[];
  loading: boolean;
  error: Error | null;
  currentConversation: Conversation | null;
  setCurrentConversation: (conv: Conversation | null) => void;
  createConversation: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  refetch: () => void;
}

export function useConversations(): UseConversationsResult {
  const { data, loading, error, refetch } = useConversationsList();
  const createMutation = useCreateConversation();
  const deleteMutation = useDeleteConversation();

  const currentConversation = useConversationStore((s) => s.currentConversation);
  const setCurrentConversation = useConversationStore((s) => s.setCurrentConversation);
  const clearCurrentConversation = useConversationStore((s) => s.clearCurrentConversation);
  const setMessages = useConversationStore((s) => s.setMessages);

  const createConversation = useCallback(async (): Promise<void> => {
    try {
      const conv = await createMutation.mutate({ title: 'New Conversation' });
      setCurrentConversation(conv);
      setMessages([]);
      refetch();
    } catch (err) {
      message.error('Failed to create conversation');
    }
  }, [createMutation, setCurrentConversation, setMessages, refetch]);

  const deleteConversation = useCallback(
    async (id: string): Promise<void> => {
      try {
        await deleteMutation.mutate(id);
        if (currentConversation?.id === id) {
          clearCurrentConversation();
        }
        refetch();
      } catch (err) {
        message.error('Failed to delete conversation');
      }
    },
    [deleteMutation, currentConversation, clearCurrentConversation, refetch],
  );

  return {
    conversations: data ?? [],
    loading,
    error,
    currentConversation,
    setCurrentConversation,
    createConversation,
    deleteConversation,
    refetch,
  };
}
