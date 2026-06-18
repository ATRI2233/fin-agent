/**
 * `MessageThread` — scrollable message list with auto-scroll support.
 *
 * Extracted from `pages/ChatPage/index.tsx` . Owns the
 * `messagesEndRef` and `shouldAutoScroll` refs internally — the
 * orchestrator never touches the DOM directly. The parent triggers a
 * scroll via the imperative `requestScroll()` handle, typically right
 * before sending a user message; the scroll then fires the next time
 * `messages` updates (which the orchestrator already drives via
 * polling).
 *
 * Rendering rules (preserved verbatim from `pages/ChatPage.tsx`):
 * - Empty list → centered placeholder ("Start a conversation").
 * - `workflow_status` row whose agent has a later status → strike
 * through with the latest status baked in (`_struck` UI flag).
 * - `workflow_start` row when every agent is `completed`/`failed`
 * → strike through.
 * - `showWorkflowIndicator` → render a separate compact status
 * indicator under the message list while the workflow is running.
 *
 * The local `ChatMessage` type extends the canonical `Message` with the
 * UI-only `_struck?: boolean` field consumed by `MessageBubble`.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { Tag, Typography } from 'antd';
import { CloseCircleOutlined, RobotOutlined, SyncOutlined } from '@ant-design/icons';

import MessageBubble from './MessageBubble';
import type { Message } from '../../types/conversation';

const { Text } = Typography;

/** UI-only flags set by the renderer. */
type ChatMessage = Message & {
  /** Row has been superseded by a later status for the same agent. */
  _struck?: boolean;
  /** This is the latest workflow_status message for its execution (should render node list). */
  _latestWorkflow?: boolean;
};

/** Narrow the untyped `extra_data` bag to a typed view of the `type` field. */
function getExtraType(msg: Message): string | undefined {
  const extra = msg.extra_data as Record<string, unknown> | undefined;
  return typeof extra?.type === 'string' ? extra.type : undefined;
}

export interface MessageThreadProps {
  messages: Message[];
  /**
   * Show the workflow status indicator (latest `workflow_status` /
   * `workflow_start` content + agent tag). The parent should pass
   * `processingMessage && mode === 'workflow'`.
   */
  showWorkflowIndicator?: boolean;
  /**
   * Optional callback for future "load older messages" support.
   * Currently unused; kept on the contract so callers can wire
   * pagination without changing the component API.
   */
  onLoadMore?: () => void;
}

export interface MessageThreadHandle {
  /**
   * Mark the next `messages` update as a user-initiated scroll target.
   * Mirrors the original `shouldAutoScroll.current = true` flip — the
   * scroll itself happens inside the `useEffect([messages])` hook so
   * it lands after the new row is rendered.
   */
  requestScroll: () => void;
}

export const MessageThread = forwardRef<MessageThreadHandle, MessageThreadProps>(
  function MessageThread({ messages, showWorkflowIndicator = false }, ref) {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const shouldAutoScroll = useRef(false);

    useImperativeHandle(
      ref,
      () => ({
        requestScroll: () => {
          shouldAutoScroll.current = true;
        },
      }),
      [],
    );

    // Only auto-scroll when the user (or first load) requested it.
    useEffect(() => {
      if (shouldAutoScroll.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        shouldAutoScroll.current = false;
      }
    }, [messages]);

    // Build agent -> latest status map (for strike-through supersession).
    const agentLatestStatus: Record<string, string> = {};
    for (const m of messages) {
      const extra = m.extra_data as
        | { type?: string; status?: string }
        | undefined;
      if (extra?.type === 'workflow_status' && m.agent) {
        agentLatestStatus[m.agent] = extra.status || '';
      }
    }
    const allAgents = Object.keys(agentLatestStatus);

    // Check if the latest overall workflow_status is failed (handles edge case
    // where no per-agent statuses exist yet but the workflow has failed).
    const latestWorkflowStatusMsg = messages
      .filter((m) => getExtraType(m) === 'workflow_status' && !m.agent)
      .pop();
    const latestWorkflowStatusVal = (
      latestWorkflowStatusMsg?.extra_data as { status?: string } | undefined
    )?.status;

    // Track the latest workflow_status message per execution_id so only
    // one MessageBubble renders the shared node list (avoids duplication).
    const latestWorkflowMsgId: Record<string, string> = {};
    for (const m of messages) {
      const extra = m.extra_data as { type?: string } | undefined;
      if (extra?.type === 'workflow_status') {
        const eid = m.execution_id ?? m.id; // fallback to msg id if no exec id
        latestWorkflowMsgId[eid] = m.id;
      }
    }

    // Identify the execution_id of the latest in-flight workflow so we can
    // scope workflow_result lookups to the correct execution (prevents stale
    // results from previous executions in the same conversation).
    // Always scan all messages — `showWorkflowIndicator` only controls the
    // status banner rendering, not the completion-detection logic.
    const latestWorkflowExecutionId = (() => {
      const msgs = messages.filter((m) => {
        const t = getExtraType(m);
        return t === 'workflow_status' || t === 'workflow_start';
      });
      const latest = msgs[msgs.length - 1];
      return latest?.execution_id ?? null;
    })();

    // Also check for workflow_result messages — they are terminal even if the
    // workflow_status/failed callback message was never saved (e.g. due to a
    // DB write failure in the status_callback closure).
    // CRITICAL: scope to the latest execution_id so old results don't
    // incorrectly mark a new running workflow as failed.
    const workflowResultMsg = messages
      .filter((m) => {
        if (getExtraType(m) !== 'workflow_result') return false;
        if (latestWorkflowExecutionId) {
          return m.execution_id === latestWorkflowExecutionId;
        }
        // No execution_id on the message — be conservative and skip
        return false;
      })
      .pop();
    const hasWorkflowResult = !!workflowResultMsg;

    const allDone =
      (allAgents.length > 0 &&
        allAgents.every(
          (a) =>
            agentLatestStatus[a] === 'completed' ||
            agentLatestStatus[a] === 'failed',
        )) ||
      (allAgents.length === 0 && latestWorkflowStatusVal === 'failed') ||
      hasWorkflowResult;

    // Determine the final workflow status from either the workflow_result message
    // (most authoritative, scoped to current execution) or the latest
    // workflow_status message.
    const finalWorkflowStatus =
      (workflowResultMsg?.extra_data as { status?: string } | undefined)?.status
      ?? latestWorkflowStatusVal
      ?? 'running';

    // Latest workflow message (status or start) for the status indicator.
    const workflowMsgs = showWorkflowIndicator
      ? messages.filter((m) => {
          const t = getExtraType(m);
          return t === 'workflow_status' || t === 'workflow_start';
        })
      : [];
    const latestWorkflowMsg = workflowMsgs[workflowMsgs.length - 1];
    const latestWorkflowExtra = latestWorkflowMsg?.extra_data as { status?: string } | undefined;
    const isWorkflowFailed = finalWorkflowStatus === 'failed';

    return (
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={{
                ...applyStrikethrough(msg, agentLatestStatus, allDone, finalWorkflowStatus),
                _latestWorkflow: latestWorkflowMsgId[msg.execution_id ?? ''] === msg.id,
              }}
            />
          ))
        )}

        {showWorkflowIndicator && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-start',
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: '8px 16px',
                background: isWorkflowFailed ? '#2a1a1a' : '#1a1a2a',
                borderRadius: 8,
                border: `1px solid ${isWorkflowFailed ? '#4a2a2a' : '#2a2a4a'}`,
              }}
            >
              {isWorkflowFailed ? (
                <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
              ) : (
                <SyncOutlined spin style={{ color: '#6B8EC4' }} />
              )}
              <Text style={{ color: isWorkflowFailed ? '#ff7875' : '#E0E0E0', fontSize: 13 }}>
                {latestWorkflowMsg?.content || (isWorkflowFailed ? 'Workflow failed' : 'Workflow executing...')}
              </Text>
              {latestWorkflowMsg?.agent && (
                <Tag color={isWorkflowFailed ? 'error' : 'blue'} style={{ fontSize: 10 }}>
                  {latestWorkflowMsg.agent}
                </Tag>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    );
  },
);

/** Centered placeholder shown when the conversation has no messages yet. */
function EmptyState() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 16,
      }}
    >
      <RobotOutlined style={{ fontSize: 48, color: '#3A3A3A' }} />
      <Text style={{ color: '#6B6B6B', fontSize: 16 }}>
        Start a conversation
      </Text>
      <Text style={{ color: '#525252', fontSize: 14 }}>
        Select an agent or workflow and type your message
      </Text>
    </div>
  );
}

/**
 * Compute the per-row view used by `MessageBubble`. Three cases:
 * 1. `workflow_status` whose agent has a later status → strike
 * through with the latest status baked in.
 * 2. `workflow_start` when every agent is `completed`/`failed` →
 * strike through (workflow is done).
 * 3. Otherwise → return the message unchanged.
 */
function applyStrikethrough(
  msg: Message,
  agentLatestStatus: Record<string, string>,
  allDone: boolean,
  finalWorkflowStatus?: string,
): ChatMessage {
  const extra = msg.extra_data as
    | { type?: string; status?: string }
    | undefined;
  if (extra?.type === 'workflow_status' && msg.agent) {
    const latest = agentLatestStatus[msg.agent];
    if (latest && latest !== extra.status) {
      return {
        ...msg,
        _struck: true,
        extra_data: { ...extra, status: latest },
      };
    }
  }
  // Strike the initial "Workflow started…" message (agent is empty) when all agents are done.
  // Also update its status to reflect the actual final state.
  if (extra?.type === 'workflow_status' && !msg.agent && allDone) {
    return {
      ...msg,
      _struck: true,
      extra_data: { ...extra, status: finalWorkflowStatus ?? extra.status },
    };
  }
  if (extra?.type === 'workflow_start' && allDone) {
    return { ...msg, _struck: true };
  }
  return msg;
}