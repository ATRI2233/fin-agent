/**
 * `ConversationSidebar` — left-rail conversation list + session history.
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
 * Additionally shows agent sessions for the current conversation.
 */
import { useState } from 'react';
import { Button, List, Popconfirm, Tag } from 'antd';
import {
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  DownOutlined,
  LoadingOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  RightOutlined,
} from '@ant-design/icons';

import type { Conversation } from '../../types/conversation';
import type { SessionInfo } from '../../types/session';
import { formatDateTime } from '../../utils/time';

export interface ConversationSidebarProps {
  /** All conversations (newest first), as returned by the list hook. */
  conversations: Conversation[];
  /** Currently-selected conversation id, or `null` when nothing is open. */
  currentId: string | null;
  /** Agent sessions for the current conversation. */
  sessions?: SessionInfo[];
  /** Fired when the user clicks a row. */
  onSelect: (conv: Conversation) => void;
  /** Fired when the user clicks the "New Conversation" button. */
  onCreate: () => void | Promise<void>;
  /** Fired after the user confirms deletion of a row. */
  onDelete: (id: string) => void | Promise<void>;
}

function SessionStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'active':
      return <LoadingOutlined spin style={{ color: '#6B8EC4', fontSize: 11 }} />;
    case 'inactive':
      return <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 11 }} />;
    case 'cleaned_up':
      return <CloseCircleOutlined style={{ color: '#888', fontSize: 11 }} />;
    default:
      return <QuestionCircleOutlined style={{ color: '#888', fontSize: 11 }} />;
  }
}

function sessionStatusColor(status: string): string {
  switch (status) {
    case 'active': return 'blue';
    case 'inactive': return 'green';
    case 'cleaned_up': return 'default';
    default: return 'default';
  }
}

export default function ConversationSidebar({
  conversations,
  currentId,
  sessions,
  onSelect,
  onCreate,
  onDelete,
}: ConversationSidebarProps) {
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
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

        {/* Agent Sessions — collapsed by default, click to expand */}
        {sessions && sessions.length > 0 && (
          <div style={{ borderTop: '1px solid #222' }}>
            <div
              onClick={() => setSessionsExpanded(!sessionsExpanded)}
              style={{
                padding: '10px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              {sessionsExpanded
                ? <DownOutlined style={{ color: '#666', fontSize: 10 }} />
                : <RightOutlined style={{ color: '#666', fontSize: 10 }} />
              }
              <ApiOutlined style={{ color: '#666', fontSize: 12 }} />
              <span style={{ color: '#888', fontSize: 12, flex: 1 }}>
                Sessions
              </span>
              <Tag style={{ fontSize: 10, margin: 0 }}>{sessions.length}</Tag>
            </div>
            {sessionsExpanded && sessions.map((s) => (
              <div
                key={s.session_id}
                style={{
                  padding: '6px 16px 6px 32px',
                  borderBottom: '1px solid #1a1a1a',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <SessionStatusIcon status={s.status} />
                  <span style={{ color: '#ccc', fontSize: 12, flex: 1 }}>
                    {s.agent || 'unknown'}
                  </span>
                  <Tag
                    color={sessionStatusColor(s.status)}
                    style={{ fontSize: 10, margin: 0 }}
                  >
                    {s.status}
                  </Tag>
                </div>
                {s.created_at && (
                  <div style={{ marginLeft: 17, marginTop: 1 }}>
                    <span style={{ color: '#555', fontSize: 10 }}>
                      {formatDateTime(s.created_at)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}