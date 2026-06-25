/**
 * `ConversationSidebar` — left-rail conversation list.
 *
 * Extracted from `pages/ChatPage/index.tsx`. Pure presentation
 * component — the orchestrator owns the data and passes derived props
 * down. No HTTP calls, no store reads; the parent wires `onSelect` /
 * `onCreate` / `onDelete` to the conversation hook.
 *
 * Behavior:
 * - "New Conversation" button at the top, full width.
 * - Clicking a conversation row selects it (delegates to `onSelect`).
 * - The delete button's `stopPropagation` prevents row click from firing.
 * - The currently active row has a `#1a1a1a` background.
 */
import { Button, Popconfirm } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';

import type { Conversation } from '../../domain/conversation';

export interface ConversationSidebarProps {
  /** All conversations (newest first), as returned by the list hook. */
  conversations: Conversation[];
  /** Currently-selected conversation id, or `null` when nothing is open. */
  currentId: string | null;
  /** Fired when the user clicks a row. */
  onSelect: (conv: Conversation) => void;
  /** Fired when the user clicks the "New Conversation" button. */
  onCreate: () => void | Promise<void>;
  /** Fired after the user confirms deletion of a row. */
  onDelete: (id: string) => void | Promise<void>;
}

export default function ConversationSidebar({
  conversations,
  currentId,
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
      <style>{`.conv-row .conv-delete-btn { visibility: hidden; }
.conv-row:hover .conv-delete-btn { visibility: visible; }`}</style>
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
          return (
            <div
              key={conv.id}
              className="conv-row"
              style={{
                padding: '10px 16px',
                cursor: 'pointer',
                background: currentId === conv.id ? '#1a1a1a' : 'transparent',
                borderBottom: '1px solid #1a1a1a',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
              onClick={() => onSelect(conv)}
            >
              <div style={{ flex: 1 }}>
                <div style={{ color: '#E0E0E0', fontSize: 14 }}>{conv.title}</div>
                <div style={{ color: '#666', fontSize: 12, marginTop: 2 }}>
                  {conv.message_count} messages
                </div>
              </div>

              {/* Delete button — visible on hover via CSS */}
              <span className="conv-delete-btn">
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
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}