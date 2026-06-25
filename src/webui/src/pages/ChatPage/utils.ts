/**
 * Shared utilities and types for ChatPage components.
 *
 * Extracted from duplicated definitions across MessageBubble, MessageThread,
 * and useConversationPolling to eliminate code duplication (audit R2/R3).
 */

import type { Message } from '../../domain/conversation';

/** UI-only flags set by the renderer, extending the canonical Message type. */
export type ChatMessage = Message & {
  _struck?: boolean;
  /** True if this is the latest workflow_status for its execution (render node list). */
  _latestWorkflow?: boolean;
};

/** Narrow the untyped `extra_data` bag to a typed view of the `type` field. */
export function getExtraType(msg: Message): string | undefined {
  const extra = msg.extra_data as Record<string, unknown> | undefined;
  return typeof extra?.type === 'string' ? extra.type : undefined;
}
