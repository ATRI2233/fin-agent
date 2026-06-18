/**
 * `useChatConversations` — page-level wrapper for the ChatPage.
 *
 * Combines the framework-level conversation hooks with zustand store
 * for selection state and mutation helpers.
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

export function useChatConversations(): UseConversationsResult {
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
