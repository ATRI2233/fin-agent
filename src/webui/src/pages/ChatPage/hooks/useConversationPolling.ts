/**
 * `useConversationPolling` — poll a conversation for new messages after a
 * user message is sent, and stop when the agent/workflow responds.
 *
 * Extracted from `pages/ChatPage.tsx` . The hook owns the
 * `setInterval` handle and the `processingMessage` / `pendingMessageId`
 * state; the parent component only needs to call `startPolling` after
 * dispatching the user message and `stopPolling` from the cancel
 * button.
 *
 * Stop conditions (preserved verbatim from the original implementation):
 * - poll count > MAX_POLLS (600 = 20 minutes at 2s interval) — bail out
 * - workflow mode: a `workflow_result` or `workflow_error` message
 * appears AFTER the user message
 * - agent mode: any `assistant` message OR a non-workflow `system`
 * message appears AFTER the user message
 *
 * Returned state is `processingMessage` (true while polling) and
 * `pendingMessageId` (the user message we are waiting on).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getConversation } from '../../../api/conversations';
import { useConversationStore } from '../../../store/useConversationStore';
import type { Message } from '../../../domain/conversation';

/** Poll cadence — must match the original `setInterval(…, 2000)`. */
const POLL_INTERVAL_MS = 2000;
/** Max polls — 20 minutes total (workflows with multiple agents can take 10+ min). */
const MAX_POLLS = 600;

export type PollingMode = 'agent' | 'workflow';

function getExtraType(msg: Message): string | undefined {
  const extra = msg.extra_data as Record<string, unknown> | undefined;
  return typeof extra?.type === 'string' ? extra.type : undefined;
}

export interface UseConversationPollingResult {
  /** Begin polling. Resets the counter; safe to call when already running. */
  startPolling: (conversationId: string, userMessageId: string, mode: PollingMode) => void;
  /** Cancel the in-flight poll. Resets `processingMessage` and `pendingMessageId`. */
  stopPolling: () => void;
  /** `true` while polling is active. */
  processingMessage: boolean;
  /** The user message id we are waiting on, or `null` when idle. */
  pendingMessageId: string | null;
}

export function useConversationPolling(): UseConversationPollingResult {
  const setMessages = useConversationStore((s) => s.setMessages);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [processingMessage, setProcessingMessage] = useState(false);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);

  const stopPolling = useCallback((): void => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setProcessingMessage(false);
    setPendingMessageId(null);
  }, []);

  const startPolling = useCallback(
    (conversationId: string, userMessageId: string, mode: PollingMode): void => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }

      let pollCount = 0;
      setProcessingMessage(true);
      setPendingMessageId(userMessageId);

      pollingRef.current = setInterval(async () => {
        pollCount++;
        if (pollCount > MAX_POLLS) {
          stopPolling();
          return;
        }

        try {
          const envelope = await getConversation(conversationId);
          const msgs = envelope.messages;
          setMessages(msgs);

          // Only look at messages AFTER the user message — anything
          // before is stale and could falsely satisfy the stop check.
          const userIdx = msgs.findIndex((m) => m.id === userMessageId);
          const afterUser = userIdx >= 0 ? msgs.slice(userIdx + 1) : msgs;

          if (mode === 'workflow') {
            const hasTerminal = afterUser.some(
              (m) =>
                getExtraType(m) === 'workflow_result' ||
                getExtraType(m) === 'workflow_error' ||
                (getExtraType(m) === 'workflow_status' &&
                  (m.extra_data as Record<string, unknown>)?.status === 'failed'),
            );
            if (hasTerminal) stopPolling();
          } else {
            const hasResponse = afterUser.some(
              (m) =>
                m.role === 'assistant' ||
                (m.role === 'system' &&
                  getExtraType(m) !== 'workflow_status' &&
                  getExtraType(m) !== 'workflow_start'),
            );
            if (hasResponse) stopPolling();
          }
        } catch (err) {
          console.error('Polling error:', err);
        }
      }, POLL_INTERVAL_MS);
    },
    [setMessages, stopPolling],
  );

  // Cleanup polling on unmount — matches the original `useEffect` cleanup.
  useEffect(() => {
    return (): void => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  return { startPolling, stopPolling, processingMessage, pendingMessageId };
}
