/**
 * `useMessages` — page-level wrapper for the active conversation's
 * message list + dispatch.
 *
 * Extracted from `pages/ChatPage.tsx` . Combines four
 * concerns so the page component stays declarative:
 *
 * 1. **Store** — `messages` lives in zustand; we read + write.
 * 2. **Load** — auto-loads messages when the active
 * conversation changes (mirrors the original
 * `useEffect(() => loadMessages(current.id), [current])`).
 * `loadMessages(id)` is also exposed for the
 * manual "Refresh" button.
 * 3. **Send** — `sendMessage` POSTs via the 
 * `useCreateMessage` mutation, appends the user
 * echo to the store, and kicks off polling
 * (see `useConversationPolling`).
 * 4. **Polling** — forwards `processingMessage` /
 * `pendingMessageId` / `stopPolling` from the
 * polling hook for the page to render the
 * "Processing" badge and cancel button.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { message as antdMessage } from 'antd';
import { useCreateMessage, useConversation } from '../../../hooks/useConversations';
import { useConversationStore } from '../../../store/useConversationStore';
import { useConversationPolling, type PollingMode } from './useConversationPolling';

export interface SendMessageParams {
  content: string;
  mode: PollingMode;
  agent?: string;
  workflow_id?: string | null;
}

export interface UseMessagesResult {
  messages: ReturnType<typeof useConversationStore.getState>['messages'];
  loadMessages: (conversationId: string) => Promise<void>;
  sendMessage: (params: SendMessageParams) => Promise<void>;
  processingMessage: boolean;
  pendingMessageId: string | null;
  sendingMessage: boolean;
  stopPolling: () => void;
}

export function useMessages(): UseMessagesResult {
  const currentConversation = useConversationStore((s) => s.currentConversation);
  const setMessages = useConversationStore((s) => s.setMessages);
  const messages = useConversationStore((s) => s.messages);
  const appendMessage = useConversationStore((s) => s.appendMessage);

  const [sendingMessage, setSendingMessage] = useState(false);
  // Track which conversation id we want messages for; null = idle.
  // The `useConversation` hook short-circuits on null and only fires when
  // we set an id, so this drives the load lifecycle declaratively.
  const [requestedConvId, setRequestedConvId] = useState<string | null>(
    currentConversation?.id ?? null,
  );
  const { data: convEnvelope, refetch: refetchConversation } = useConversation(requestedConvId);

  const createMessageMutation = useCreateMessage();
  const { startPolling, stopPolling, processingMessage, pendingMessageId } =
    useConversationPolling();

  // Keep latest stopPolling in a ref so the envelope-sync effect below
  // doesn't capture a stale closure (stopPolling is recreated by the
  // polling hook on every render that updates its internal state).
  const stopPollingRef = useRef(stopPolling);
  useEffect(() => {
    stopPollingRef.current = stopPolling;
  });

  // Whenever the envelope resolves with a fresh conversation, push its
  // messages into the zustand store. The hook also stops any in-flight
  // stream from the previous conversation so events don't cross-pollinate.
  useEffect(() => {
    stopPollingRef.current();
    if (convEnvelope?.messages) {
      setMessages(convEnvelope.messages);
    }
  }, [convEnvelope, setMessages]);

  // Sync the auto-load target with the active conversation.
  useEffect(() => {
    setRequestedConvId(currentConversation?.id ?? null);
  }, [currentConversation]);

  const loadMessages = useCallback(
    async (conversationId: string): Promise<void> => {
      setRequestedConvId(conversationId);
      refetchConversation();
    },
    [refetchConversation],
  );

  const sendMessage = useCallback(
    async (params: SendMessageParams): Promise<void> => {
      const { content, mode, agent, workflow_id } = params;
      if (!currentConversation || processingMessage) return;

      setSendingMessage(true);
      try {
        const result = await createMessageMutation.mutate({
          conversationId: currentConversation.id,
          data: {
            content,
            mode,
            agent: mode === 'agent' ? agent : undefined,
            workflow_id: mode === 'workflow' ? workflow_id || undefined : undefined,
          },
        });

        const userMessageId = result.id;
        if (userMessageId) {
          // Append the user message immediately for snappy UX.
          appendMessage({
            id: userMessageId,
            role: 'user',
            content,
            created_at: new Date().toISOString(),
          });

          // Start polling for the assistant / workflow response.
          startPolling(currentConversation.id, userMessageId, mode);
        }
      } catch (err) {
        antdMessage.error('Failed to send message');
      } finally {
        setSendingMessage(false);
      }
    },
    [
      currentConversation,
      processingMessage,
      createMessageMutation,
      appendMessage,
      startPolling,
    ],
  );

  return {
    messages,
    loadMessages,
    sendMessage,
    processingMessage,
    pendingMessageId,
    sendingMessage,
    stopPolling,
  };
}
