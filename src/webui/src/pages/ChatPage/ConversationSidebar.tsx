/**
 * `ConversationSidebar` — left-rail conversation list + per-conversation session sub-lists.
 *
 * Extracted from `pages/ChatPage/index.tsx` . Pure
 * presentation component — the orchestrator owns the data and passes
 * derived props down. No HTTP calls, no store reads; the parent wires
 * `onSelect` / `onCreate` / `onDelete` / `onConversationExpand` /
 * `onSessionClick` to the conversation hook.
 *
 * Behavior:
 * - "New Conversation" button at the top, full width.
 * - Each conversation row has a expand/collapse toggle on the left.
 * - Clicking a conversation row selects it (delegates to `onSelect`).
 * - Expanding a conversation row shows its sessions sub-list below it.
 * - Each session in the sub-list is clickable (delegates to `onSessionClick`).
 * - The delete button's `stopPropagation` prevents row click from firing.
 * - The currently active row has a `#1a1a1a` background.
 */
import { useState } from 'react';
import { Button, Popconfirm, Tag } from 'antd';
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
  /** Sessions grouped by conversation id. */
  sessionsByConversation?: Record<string, SessionInfo[]>;
  /** Which conversations are currently expanded (show sessions sub-list). */
  expandedConversations?: Set<string>;
  /** Fired when the user expands a conversation row (to fetch its sessions). */
  onConversationExpand?: (conversationId: string) => void;
  /** Fired when the user clicks a session sub-list item (to open that session). */
  onSessionClick?: (session: SessionInfo) => void;
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
  sessionsByConversation = {},
  expandedConversations = new Set<string>(),
  onConversationExpand,
  onSessionClick,
  onSelect,
  onCreate,
  onDelete,
}: ConversationSidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
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
        {conversations.map((conv) => {
          const isExpanded = expandedConversations.has(conv.id);
          const sessions = sessionsByConversation[conv.id] ?? [];
          const isHovered = hoveredId === conv.id;
          return (
            <div key={conv.id}>
              <div
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  background: currentId === conv.id ? '#1a1a1a' : 'transparent',
                  borderBottom: '1px solid #1a1a1a',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
                onMouseEnter={() => setHoveredId(conv.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {/* Expand/collapse toggle */}
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onConversationExpand?.(conv.id);
                  }}
                  style={{ cursor: 'pointer', color: '#555', fontSize: 10 }}
                >
                  {isExpanded
                    ? <DownOutlined style={{ fontSize: 10 }} />
                    : <RightOutlined style={{ fontSize: 10 }} />
                  }
                </span>

                {/* Conversation row — click to select */}
                <div
                  style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}
                  onClick={() => onSelect(conv)}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#E0E0E0', fontSize: 14 }}>{conv.title}</div>
                    <div style={{ color: '#666', fontSize: 12, marginTop: 2 }}>
                      {conv.message_count} messages
                      {sessions.length > 0 && (
                        <Tag style={{ fontSize: 10, marginLeft: 6, marginBottom: 0 }}>{sessions.length} sessions</Tag>
                      )}
                    </div>
                  </div>
                </div>

                {/* Delete button — only on hover */}
                {isHovered && (
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
                )}
              </div>

              {/* Sessions sub-list — shown when this conversation is expanded */}
              {isExpanded && sessions.length > 0 && (
                <div style={{ background: '#0d0d0d' }}>
                  {sessions.map((s) => (
                    <div
                      key={s.session_id}
                      style={{
                        padding: '6px 16px 6px 36px',
                        borderBottom: '1px solid #1a1a1a',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                      onClick={() => onSessionClick?.(s)}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background = '#1a1a1a';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                      }}
                    >
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
                  ))}
                </div>
              )}
              {isExpanded && sessions.length === 0 && (
                <div style={{
                  padding: '6px 16px 6px 36px',
                  color: '#555',
                  fontSize: 11,
                  borderBottom: '1px solid #1a1a1a',
                }}>
                  No sessions
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}