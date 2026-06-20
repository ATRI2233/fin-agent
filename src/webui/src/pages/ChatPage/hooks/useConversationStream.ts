/**
 * `useConversationStream` — EventSource-based real-time updates.
 *
 * Same contract as `useConversationPolling` so `useMessages.ts` can swap
 * the import with a one-line change.
 *
 * Stop conditions:
 * - workflow mode: workflow_result / workflow_error after userMessageId
 * - agent mode: any assistant message OR a non-workflow system message
 * after userMessageId
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConversationStore } from '../../../store/useConversationStore';
import { API_V1_BASE } from '../../../config/env';
import { getConversation } from '../../../api/conversations';
import type { Message } from '../../../domain/conversation';

export type StreamMode = 'agent' | 'workflow';

export interface UseConversationStreamResult {
  startStream: (conversationId: string, userMessageId: string, mode: StreamMode) => void;
  stopStream: () => void;
  processingMessage: boolean;
  pendingMessageId: string | null;
}

interface SSEEvent {
  type: string;
  message?: Message;
  execution_id?: string;
  status?: string;
  agent?: string;
  content?: string;
  nodes?: Array<{ agent: string; status: string }>;
  error?: string;
  conversation_id?: string;
}

export function useConversationStream(): UseConversationStreamResult {
  const setMessages = useConversationStore((s) => s.setMessages);
  const appendMessage = useConversationStore((s) => s.appendMessage);
  const eventSourceRef = useRef<EventSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [processingMessage, setProcessingMessage] = useState(false);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);

  const stopStream = useCallback((): void => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setProcessingMessage(false);
    setPendingMessageId(null);
  }, []);

  const startStream = useCallback(
    (conversationId: string, userMessageId: string, mode: StreamMode): void => {
      // Close any existing connection before opening a new one
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      setProcessingMessage(true);
      setPendingMessageId(userMessageId);

      const url = `${API_V1_BASE}/events/conversations/${encodeURIComponent(conversationId)}`;
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onmessage = (event: MessageEvent) => {
        // Ignore empty events (SSE comment lines)
        if (!event.data) return;

        let parsed: SSEEvent;
        try {
          parsed = JSON.parse(event.data) as SSEEvent;
        } catch {
          console.warn('[SSE] Failed to parse event:', event.data);
          return;
        }

        switch (parsed.type) {
          case 'connected':
            // Stream is live — no-op
            break;

          case 'heartbeat':
            // Keepalive — ignore
            break;

          case 'message':
            if (parsed.message) {
              appendMessage(parsed.message);
              // Agent mode: stop on first assistant reply
              if (mode === 'agent' && parsed.message.role === 'assistant') {
                stopStream();
              }
            }
            break;

          case 'workflow_status':
          case 'workflow_result':
          case 'workflow_error': {
            // Reload full message list to get updated state + strike-through logic
            void (async (): Promise<void> => {
              try {
                const envelope = await getConversation(conversationId);
                setMessages(envelope.messages);
              } catch (err) {
                console.error('[SSE] Failed to reload messages:', err);
              }
            })();
            // Workflow mode: stop on terminal events
            if (mode === 'workflow' && (parsed.type === 'workflow_result' || parsed.type === 'workflow_error')) {
              // Delay stop so the message list fully updates first
              timerRef.current = setTimeout(() => stopStream(), 500);
            }
            break;
          }

          default:
            console.warn('[SSE] Unknown event type:', parsed.type);
        }
      };

      es.onerror = (err: Event) => {
        console.error('[SSE] EventSource error:', err);
        // EventSource auto-reconnects by default; we let it.
      };
    },
    [appendMessage, setMessages, stopStream],
  );

  // Cleanup on unmount
  useEffect(() => {
    return (): void => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return { startStream, stopStream, processingMessage, pendingMessageId };
}
