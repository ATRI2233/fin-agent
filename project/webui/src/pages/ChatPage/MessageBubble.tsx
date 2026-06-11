/**
 * MessageBubble — single chat message rendered in the message list.
 *
 * Extracted from `pages/ChatPage.tsx` (Wave 6.1b) so the bubble can be
 * reused and independently tested. The component is purely
 * presentational; all data lives in the zustand conversation store
 * (`../store/useConversationStore`).
 *
 * Rendering rules:
 *   - role='user'               — right-aligned, blue accent, user icon
 *   - role='assistant'          — left-aligned, robot icon, neutral bg
 *   - role='system'             — left-aligned, thunderbolt icon, dark bg
 *   - extra_data.type IN
 *     {'workflow_status',
 *      'workflow_start'}        — compact inline row with status icon
 *                                 and a single agent tag; no avatar/bubble
 *   - _struck=true              — UI-only flag set by the renderer in
 *                                 `index.tsx` when a later status
 *                                 supersedes an earlier one — strikes
 *                                 through the row at 50% opacity
 *
 * The local `ChatMessage` type extends the canonical `Message` with the
 * UI-only `_struck?: boolean` field. The `extra_data` bag is treated as
 * `Record<string, unknown>` and narrowed per call site — never typed as
 * `any`.
 */
import { Tag, Typography } from 'antd';
import {
  BranchesOutlined,
  RobotOutlined,
  SyncOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { Message } from '../../types/conversation';

const { Text } = Typography;

/** UI-only flag set by the renderer when a later status supersedes this row. */
type ChatMessage = Message & { _struck?: boolean };

export interface MessageBubbleProps {
  message: ChatMessage;
}

/** Narrow the untyped `extra_data` bag to a typed view of the `type` field. */
function getExtraType(msg: Message): string | undefined {
  const extra = msg.extra_data as Record<string, unknown> | undefined;
  return typeof extra?.type === 'string' ? extra.type : undefined;
}

export default function MessageBubble({ message: msg }: MessageBubbleProps) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';
  const msgType = getExtraType(msg);
  const isWorkflowStart = msgType === 'workflow_start';
  const isWorkflowStatus = msgType === 'workflow_status';
  const isWorkflowResult = msgType === 'workflow_result';
  const isWorkflowError = msgType === 'workflow_error';
  const isStruck = msg._struck;

  // Compact inline row for workflow status / start — no avatar/bubble chrome.
  if (isWorkflowStatus || isWorkflowStart) {
    const extra = (msg.extra_data ?? {}) as Record<string, unknown>;
    const statusText = typeof extra.status === 'string' ? extra.status : '';
    const isCompleted = statusText === 'completed';
    const isFailed = statusText === 'failed';
    const iconColor = isFailed ? '#ff4d4f' : isCompleted ? '#52c41a' : '#6B8EC4';

    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-start',
          marginBottom: 6,
          opacity: isStruck ? 0.5 : 1,
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 12px' }}>
          {isStruck ? (
            <span style={{ position: 'relative', display: 'inline-flex', width: 12, height: 12 }}>
              <SyncOutlined style={{ color: '#555', fontSize: 12 }} />
              <span
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: -1,
                  right: -1,
                  height: 1,
                  background: '#555',
                }}
              />
            </span>
          ) : isFailed ? (
            <ThunderboltOutlined style={{ color: iconColor, fontSize: 12 }} />
          ) : isCompleted ? (
            <BranchesOutlined style={{ color: iconColor, fontSize: 12 }} />
          ) : (
            <SyncOutlined spin style={{ color: iconColor, fontSize: 12 }} />
          )}
          {msg.agent && (
            <Tag
              color={
                isStruck ? 'default' : isFailed ? 'error' : isCompleted ? 'success' : 'blue'
              }
              style={{
                fontSize: 10,
                margin: 0,
                textDecoration: isStruck ? 'line-through' : 'none',
              }}
            >
              {msg.agent}
            </Tag>
          )}
          <Text
            style={{
              color: isStruck ? '#555' : isFailed ? '#ff7875' : '#888',
              fontSize: 12,
              textDecoration: isStruck ? 'line-through' : 'none',
            }}
          >
            {msg.content}
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 16,
      }}
    >
      <div
        style={{
          maxWidth: '80%',
          display: 'flex',
          gap: 8,
          flexDirection: isUser ? 'row-reverse' : 'row',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: isUser
              ? '#6B8EC4'
              : isWorkflowError
                ? '#ff4d4f'
                : isSystem
                  ? '#525252'
                  : isWorkflowResult
                    ? '#52c41a'
                    : '#1890ff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {isUser ? (
            <UserOutlined style={{ color: '#fff', fontSize: 14 }} />
          ) : isWorkflowError ? (
            <ThunderboltOutlined style={{ color: '#fff', fontSize: 14 }} />
          ) : isSystem ? (
            <ThunderboltOutlined style={{ color: '#fff', fontSize: 14 }} />
          ) : isWorkflowResult ? (
            <BranchesOutlined style={{ color: '#fff', fontSize: 14 }} />
          ) : (
            <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
          )}
        </div>

        <div
          style={{
            padding: '12px 16px',
            borderRadius: 12,
            background: isUser
              ? '#1a3a5c'
              : isWorkflowError
                ? '#2a1a1a'
                : isSystem
                  ? '#2a2a2a'
                  : isWorkflowResult
                    ? '#1a2e1a'
                    : '#1e1e1e',
            border: '1px solid',
            borderColor: isUser
              ? '#2a4a6c'
              : isWorkflowError
                ? '#4a2a2a'
                : isSystem
                  ? '#3a3a3a'
                  : isWorkflowResult
                    ? '#2a4a2a'
                    : '#2e2e2e',
          }}
        >
          {(msg.agent || msg.workflow_id) && (
            <div style={{ marginBottom: 8, display: 'flex', gap: 4 }}>
              {msg.agent && (
                <Tag color="blue" style={{ fontSize: 11 }}>
                  {msg.agent}
                </Tag>
              )}
              {msg.workflow_id && (
                <Tag color={isWorkflowError ? 'error' : 'purple'} style={{ fontSize: 11 }}>
                  {isWorkflowError ? 'workflow error' : 'workflow'}
                </Tag>
              )}
            </div>
          )}

          <div
            style={{
              color: '#E0E0E0',
              fontSize: 14,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}
          >
            {msg.content}
          </div>

          {isWorkflowResult && (
            (() => {
              const extra = msg.extra_data as { nodes?: Array<{ agent: string; status: string }> } | undefined;
              const nodes = extra?.nodes;
              if (!nodes || nodes.length === 0) return null;
              return (
                <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid #2a4a2a' }}>
                  <Text style={{ color: '#888', fontSize: 11, display: 'block', marginBottom: 4 }}>
                    Nodes:
                  </Text>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {nodes.map((n, i) => (
                      <Tag
                        key={i}
                        color={
                          n.status === 'completed'
                            ? 'green'
                            : n.status === 'failed'
                              ? 'red'
                              : 'default'
                        }
                        style={{ fontSize: 10 }}
                      >
                        {n.agent} ({n.status})
                      </Tag>
                    ))}
                  </div>
                </div>
              );
            })()
          )}

          <div style={{ marginTop: 8, fontSize: 11, color: '#666' }}>
            {new Date(msg.created_at).toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  );
}
