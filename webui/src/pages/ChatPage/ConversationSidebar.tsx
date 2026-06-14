/**
 * `ConversationSidebar` — left-rail conversation list + execution history.
 *
 * Extracted from `pages/ChatPage/index.tsx` (Wave 6.1a). Pure
 * presentation component — the orchestrator owns the data and passes
 * derived props down. No HTTP calls, no store reads; the parent wires
 * `onSelect` / `onCreate` / `onDelete` to the conversation hook.
 *
 * Behavior preserved verbatim from the original `ChatPage.tsx`:
 *   - "New Conversation" button at the top, full width.
 *   - Each row shows title + message count + a delete (Popconfirm) button.
 *   - Clicking the row selects it (delegates to `onSelect`).
 *   - The delete button's `stopPropagation` prevents row click from firing.
 *   - The currently active row has a `#1a1a1a` background.
 *
 * Additionally shows workflow execution history for the current conversation.
 */
import { Button, List, Popconfirm, Tag, Tooltip } from 'antd';
import {
  BranchesOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  LoadingOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

import type { Conversation } from '../../types/conversation';
import type { Execution } from '../../types/execution';

export interface ConversationSidebarProps {
  /** All conversations (newest first), as returned by the list hook. */
  conversations: Conversation[];
  /** Currently-selected conversation id, or `null` when nothing is open. */
  currentId: string | null;
  /** Workflow executions for the current conversation. */
  executions?: Execution[];
  /** Fired when the user clicks a row. */
  onSelect: (conv: Conversation) => void;
  /** Fired when the user clicks the "New Conversation" button. */
  onCreate: () => void | Promise<void>;
  /** Fired after the user confirms deletion of a row. */
  onDelete: (id: string) => void | Promise<void>;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function ExecutionStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 12 }} />;
    case 'failed':
      return <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 12 }} />;
    case 'running':
      return <LoadingOutlined spin style={{ color: '#6B8EC4', fontSize: 12 }} />;
    default:
      return <ThunderboltOutlined style={{ color: '#888', fontSize: 12 }} />;
  }
}

export default function ConversationSidebar({
  conversations,
  currentId,
  executions,
  onSelect,
  onCreate,
  onDelete,
}: ConversationSidebarProps) {
  return (
    <div
      style={{
        width: 280,
        background: '#111',
        borderRight: '1px solid #222',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: 16, borderBottom: '1px solid #222' }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            void onCreate();
          }}
          style={{ width: '100%' }}
        >
          New Conversation
        </Button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <List
          dataSource={conversations}
          renderItem={(conv) => (
            <div
              onClick={() => onSelect(conv)}
              style={{
                padding: '12px 16px',
                cursor: 'pointer',
                background: currentId === conv.id ? '#1a1a1a' : 'transparent',
                borderBottom: '1px solid #1a1a1a',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ color: '#E0E0E0', fontSize: 14 }}>{conv.title}</div>
                <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>
                  {conv.message_count} messages
                </div>
              </div>
              <Popconfirm
                title="Delete this conversation?"
                onConfirm={(e) => {
                  e?.stopPropagation();
                  void onDelete(conv.id);
                }}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: '#666' }}
                />
              </Popconfirm>
            </div>
          )}
        />

        {/* Workflow Execution History */}
        {executions && executions.length > 0 && (
          <div style={{ borderTop: '1px solid #222' }}>
            <div
              style={{
                padding: '10px 16px 6px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <BranchesOutlined style={{ color: '#666', fontSize: 12 }} />
              <span style={{ color: '#666', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Workflow History
              </span>
            </div>
            {executions.map((exec) => {
              const statusColor =
                exec.status === 'completed' ? '#52c41a' :
                exec.status === 'failed' ? '#ff4d4f' :
                exec.status === 'running' ? '#6B8EC4' : '#888';
              return (
                <div
                  key={exec.id}
                  style={{
                    padding: '8px 16px',
                    borderBottom: '1px solid #1a1a1a',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ExecutionStatusIcon status={exec.status} />
                    <span style={{ color: '#ccc', fontSize: 12, flex: 1 }}>
                      {exec.workflow_name || 'Workflow'}
                    </span>
                    <Tag
                      color={
                        exec.status === 'completed' ? 'green' :
                        exec.status === 'failed' ? 'red' :
                        exec.status === 'running' ? 'blue' : 'default'
                      }
                      style={{ fontSize: 10, margin: 0 }}
                    >
                      {exec.status}
                    </Tag>
                  </div>
                  <div style={{ marginLeft: 18, marginTop: 2, display: 'flex', gap: 8 }}>
                    {exec.duration_seconds != null && (
                      <span style={{ color: '#666', fontSize: 10 }}>
                        {formatDuration(exec.duration_seconds)}
                      </span>
                    )}
                    {exec.node_count != null && exec.node_count > 0 && (
                      <Tooltip title={`${exec.completed_nodes ?? 0} completed, ${exec.failed_nodes ?? 0} failed`}>
                        <span style={{ color: '#666', fontSize: 10 }}>
                          {exec.completed_nodes ?? 0}/{exec.node_count} nodes
                        </span>
                      </Tooltip>
                    )}
                    {exec.started_at && (
                      <span style={{ color: '#555', fontSize: 10 }}>
                        {new Date(exec.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}