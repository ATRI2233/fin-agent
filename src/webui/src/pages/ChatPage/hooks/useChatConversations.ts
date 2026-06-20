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
} from '../../../hooks/useConversations';
import { useConversationStore } from '../../../store/useConversationStore';
import type { Conversation } from '../../../domain/conversation';

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

  const currentConversation = useConversationStore((s) => s.currentConversation);
  const setCurrentConversation = useConversationStore((s) => s.setCurrentConversation);
  const setMessages = useConversationStore((s) => s.setMessages);

  const createConversation = useCallback(async (): Promise<void> => {
    try {
      const conv = await createMutation.mutate({ agent_name: 'fin-orchestrator', title: 'New Conversation' });
      setCurrentConversation(conv);
      setMessages([]);
      refetch();
    } catch (err) {
      message.error('Failed to create conversation');
    }
  }, [createMutation, setCurrentConversation, setMessages, refetch]);

  const deleteConversation = useCallback(
    async (_id: string): Promise<void> => {
      message.info('Conversation deletion is not available in this version.');
    },
    [],
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
