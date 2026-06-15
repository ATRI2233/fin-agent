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
import { useEffect, useState } from 'react';
import { Tag, Tooltip, Typography } from 'antd';
import {
  BranchesOutlined,
  ExclamationCircleOutlined,
  RobotOutlined,
  SyncOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../../types/conversation';
import { NODE_STATUS_CONFIG, type NodeStatusKey } from '../../utils/statusConfig';
import { formatTime } from '../../utils/time';
import { getExecutionStatus } from '../../api/executions';

const { Text } = Typography;

/** UI-only flags set by the renderer. */
type ChatMessage = Message & {
  _struck?: boolean;
  /** True if this is the latest workflow_status for its execution (render node list). */
  _latestWorkflow?: boolean;
};

export interface MessageBubbleProps {
  message: ChatMessage;
}

/** Narrow the untyped `extra_data` bag to a typed view of the `type` field. */
function getExtraType(msg: Message): string | undefined {
  const extra = msg.extra_data as Record<string, unknown> | undefined;
  return typeof extra?.type === 'string' ? extra.type : undefined;
}

// ── Node status for workflow display ─────────────────────────────────────────
interface NodeStatus {
  node_id: string;
  agent: string;
  status: NodeStatusKey;
  error?: string | null;
}

/** Fetch node statuses for a given execution_id. Returns null while loading. */
function useNodeStatuses(executionId: string | undefined): NodeStatus[] | null {
  const [nodes, setNodes] = useState<NodeStatus[] | null>(null);

  useEffect(() => {
    if (!executionId) { setNodes([]); return; }
    let cancelled = false;
    const poll = async () => {
      // Skip requests when the tab is not visible to reduce network overhead.
      if (document.hidden) return;
      try {
        const data = await getExecutionStatus(executionId);
        if (!cancelled && Array.isArray(data.nodes)) {
          setNodes(data.nodes.map((n: Record<string, unknown>) => ({
            node_id: String(n.node_id ?? ''),
            agent: String(n.agent ?? ''),
            status: String(n.status ?? 'pending') as NodeStatus['status'],
            error: n.error != null ? String(n.error) : null,
          })));
        }
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [executionId]);

  return nodes;
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

  // Poll node statuses for workflow messages (hook must be called unconditionally)
  const executionId = (msg.extra_data as Record<string, unknown>)?.execution_id as string | undefined
    ?? msg.execution_id ?? undefined;
  const nodeStatuses = useNodeStatuses(isWorkflowStart || isWorkflowStatus || isWorkflowError ? executionId : undefined);

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 12px' }}>
          {/* Header: icon + workflow name + status */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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

          {/* Node-level status — one line per step (only on the latest workflow_status for this execution) */}
          {msg._latestWorkflow && nodeStatuses && nodeStatuses.length > 0 && (
            <div style={{ marginLeft: 20, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {nodeStatuses.map((n) => {
                const cfg = NODE_STATUS_CONFIG[n.status] ?? NODE_STATUS_CONFIG.pending;
                const IconComp = cfg.icon;
                const isNodeDone = n.status === 'completed';
                const isNodeFailed = n.status === 'failed';
                const isNodeStruck = isNodeDone || isNodeFailed;

                const line = (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      lineHeight: '20px',
                      cursor: isNodeFailed && n.error ? 'help' : 'default',
                    }}
                  >
                    <IconComp
                      spin={n.status === 'running'}
                      style={{ color: cfg.color, fontSize: 11, flexShrink: 0 }}
                    />
                    <span
                      style={{
                        color: isNodeFailed ? '#C47C7C' : isNodeDone ? '#6B8E7B' : '#aaa',
                        textDecoration: isNodeStruck ? 'line-through' : 'none',
                        fontWeight: n.status === 'running' ? 600 : 400,
                      }}
                    >
                      {n.agent || n.node_id}
                    </span>
                    {isNodeFailed && n.error && (
                      <ExclamationCircleOutlined style={{ color: '#C47C7C', fontSize: 10, flexShrink: 0 }} />
                    )}
                  </div>
                );

                if (isNodeFailed && n.error) {
                  return (
                    <Tooltip key={n.node_id} title={n.error} placement="top" overlayStyle={{ maxWidth: 400 }}>
                      {line}
                    </Tooltip>
                  );
                }
                return <div key={n.node_id}>{line}</div>;
              })}
            </div>
          )}
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

          <div className="markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                table: ({ children, ...props }) => (
                  <table style={{ borderCollapse: 'collapse', width: '100%', margin: '8px 0' }} {...props}>
                    {children}
                  </table>
                ),
                th: ({ children, ...props }) => (
                  <th style={{ border: '1px solid #444', padding: '6px 10px', background: '#2a2a2a', fontWeight: 600, textAlign: 'left' }} {...props}>
                    {children}
                  </th>
                ),
                td: ({ children, ...props }) => (
                  <td style={{ border: '1px solid #333', padding: '6px 10px' }} {...props}>
                    {children}
                  </td>
                ),
                code: ({ className, children, ...props }) => {
                  const isBlock = className?.includes('language-');
                  if (isBlock) {
                    return (
                      <code
                        style={{
                          display: 'block',
                          background: '#1a1a1a',
                          border: '1px solid #333',
                          borderRadius: 6,
                          padding: '12px 16px',
                          overflowX: 'auto',
                          fontSize: 13,
                          lineHeight: 1.5,
                        }}
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  }
                  return (
                    <code
                      style={{
                        background: '#2a2a2a',
                        border: '1px solid #3a3a3a',
                        borderRadius: 4,
                        padding: '1px 5px',
                        fontSize: '0.9em',
                      }}
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => (
                  <pre style={{ margin: '8px 0', borderRadius: 6, overflow: 'hidden' }}>
                    {children}
                  </pre>
                ),
                h1: ({ children, ...props }) => <h1 style={{ fontSize: '1.5em', fontWeight: 700, margin: '16px 0 8px', color: '#F0F0F0' }} {...props}>{children}</h1>,
                h2: ({ children, ...props }) => <h2 style={{ fontSize: '1.3em', fontWeight: 600, margin: '14px 0 6px', color: '#E8E8E8' }} {...props}>{children}</h2>,
                h3: ({ children, ...props }) => <h3 style={{ fontSize: '1.1em', fontWeight: 600, margin: '12px 0 4px', color: '#E0E0E0' }} {...props}>{children}</h3>,
                ul: ({ children, ...props }) => <ul style={{ paddingLeft: '1.5em', margin: '4px 0' }} {...props}>{children}</ul>,
                ol: ({ children, ...props }) => <ol style={{ paddingLeft: '1.5em', margin: '4px 0' }} {...props}>{children}</ol>,
                li: ({ children, ...props }) => <li style={{ margin: '2px 0' }} {...props}>{children}</li>,
                blockquote: ({ children, ...props }) => (
                  <blockquote
                    style={{
                      borderLeft: '3px solid #6B8EC4',
                      paddingLeft: 12,
                      margin: '8px 0',
                      color: '#aaa',
                      fontStyle: 'italic',
                    }}
                    {...props}
                  >
                    {children}
                  </blockquote>
                ),
                a: ({ children, ...props }) => (
                  <a style={{ color: '#6B8EC4', textDecoration: 'underline' }} target="_blank" rel="noopener noreferrer" {...props}>
                    {children}
                  </a>
                ),
                hr: () => <hr style={{ border: 'none', borderTop: '1px solid #333', margin: '12px 0' }} />,
                p: ({ children, ...props }) => <p style={{ margin: '6px 0' }} {...props}>{children}</p>,
                strong: ({ children, ...props }) => <strong style={{ fontWeight: 600, color: '#F0F0F0' }} {...props}>{children}</strong>,
                em: ({ children, ...props }) => <em style={{ color: '#ccc' }} {...props}>{children}</em>,
              }}
            >
              {msg.content}
            </ReactMarkdown>
          </div>

          {/* Node status pills for workflow error messages */}
          {isWorkflowError && nodeStatuses && nodeStatuses.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid #4a2a2a' }}>
              <Text style={{ color: '#C47C7C', fontSize: 11, display: 'block', marginBottom: 4 }}>
                Node Status:
              </Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {nodeStatuses.map((n) => {
                  const pill = (
                    <Tag
                      color={n.status === 'completed' ? 'green' : n.status === 'failed' ? 'red' : n.status === 'skipped' ? 'warning' : 'default'}
                      style={{ fontSize: 10, cursor: n.status === 'failed' && n.error ? 'help' : 'default' }}
                    >
                      {n.agent || n.node_id} ({n.status})
                    </Tag>
                  );
                  if (n.status === 'failed' && n.error) {
                    return (
                      <Tooltip key={n.node_id} title={n.error} placement="top">
                        {pill}
                      </Tooltip>
                    );
                  }
                  return <div key={n.node_id}>{pill}</div>;
                })}
              </div>
            </div>
          )}

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
            {formatTime(msg.created_at)}
          </div>
        </div>
      </div>
    </div>
  );
}
