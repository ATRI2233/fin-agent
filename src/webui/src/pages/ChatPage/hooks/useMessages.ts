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
 * 4. **Streaming** — forwards `processingMessage` /
 * `pendingMessageId` / `stopStream` from the
 * SSE hook for the page to render the
 * "Processing" badge and cancel button.
 */
import { useCallback, useEffect, useState } from 'react';
import { message as antdMessage } from 'antd';
import { useCreateMessage } from '../../../hooks/useConversations';
import { listMessages } from '../../../api/conversations';
import { useConversationStore } from '../../../store/useConversationStore';
import { useConversationStream, type StreamMode } from './useConversationStream';

export interface SendMessageParams {
  content: string;
  mode: StreamMode;
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
  stopStream: () => void;
}

export function useMessages(): UseMessagesResult {
  const currentConversation = useConversationStore((s) => s.currentConversation);
  const setMessages = useConversationStore((s) => s.setMessages);
  const messages = useConversationStore((s) => s.messages);
  const appendMessage = useConversationStore((s) => s.appendMessage);

  const [sendingMessage, setSendingMessage] = useState(false);
  const createMessageMutation = useCreateMessage();
  const { startStream, stopStream, processingMessage, pendingMessageId } =
    useConversationStream();

  // Auto-load messages when the active conversation changes. Also stop any
  // in-flight SSE stream from the previous conversation so its events don't
  // overwrite the new conversation's messages.
  useEffect(() => {
    stopStream();
    if (currentConversation) {
      void (async (): Promise<void> => {
        try {
          const msgs = await listMessages(currentConversation.id);
          setMessages(msgs);
        } catch (err) {
          console.error('Failed to load messages:', err);
        }
      })();
    }
  }, [currentConversation, setMessages, stopStream]);

  const loadMessages = useCallback(
    async (conversationId: string): Promise<void> => {
      try {
        const msgs = await listMessages(conversationId);
        setMessages(msgs);
      } catch (err) {
        console.error('Failed to load messages:', err);
      }
    },
    [setMessages],
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

        const userMessageId = result.user_message?.id;
        if (userMessageId) {
          // Append the user message immediately for snappy UX.
          appendMessage({
            id: userMessageId,
            role: 'user',
            content,
            created_at: new Date().toISOString(),
          });

          // Start SSE stream for the assistant / workflow response.
          startStream(currentConversation.id, userMessageId, mode);
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
      startStream,
    ],
  );

  return {
    messages,
    loadMessages,
    sendMessage,
    processingMessage,
    pendingMessageId,
    sendingMessage,
    stopStream,
  };
}
