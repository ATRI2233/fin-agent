/**
 * `ChatHeader` — top bar of the active conversation panel.
 *
 * Extracted from `pages/ChatPage/index.tsx`. Pure
 * presentation component — the orchestrator owns data (title, target
 * tag, processing state, refresh callback) and passes derived props
 * down. No HTTP calls, no store reads; the parent wires `onRefresh`
 * to the messages hook.
 *
 * Visual contract:
 * - Left side: conversation title + current target tag (agent or
 *   workflow name) + optional "Processing" / "取消" badge when SSE
 *   is in flight.
 * - Right side: Refresh button (reloads messages).
 */
import { Button, Space, Tag, Typography } from 'antd';
import { LoadingOutlined, ReloadOutlined } from '@ant-design/icons';

import type { WorkflowMeta } from '../../domain/workflow';
import type { ChatMode } from './ChatInput';

const { Text } = Typography;

export interface ChatHeaderProps {
  /** Conversation title to display. `null` means no conversation is open. */
  title: string | null;
  /** Composer mode — drives which tag (agent vs workflow) is shown. */
  mode: ChatMode;
  /** Currently selected agent name, or empty string when unset. */
  selectedAgent: string;
  /** Currently selected workflow id, or `null` when unset. */
  selectedWorkflow: string | null;
  /** Registry used to resolve a workflow id → display name. */
  workflows: WorkflowMeta[];
  /** True when an SSE stream is in flight (shows "Processing" + cancel). */
  processingMessage: boolean;
  /** Fired when the user clicks the Refresh button. */
  onRefresh: () => void;
  /** Fired when the user clicks the cancel (取消) button during processing. */
  onCancelStream: () => void;
}

export default function ChatHeader({
  title,
  mode,
  selectedAgent,
  selectedWorkflow,
  workflows,
  processingMessage,
  onRefresh,
  onCancelStream,
}: ChatHeaderProps) {
  return (
    <div
      style={{
        padding: '12px 24px',
        borderBottom: '1px solid #222',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <div>
        <Text style={{ color: '#F0F0F0', fontSize: 16, fontWeight: 500 }}>
          {title}
        </Text>
        <div style={{ marginTop: 4 }}>
          {mode === 'agent' ? (
            <Tag color="blue">{selectedAgent || 'Select agent'}</Tag>
          ) : (
            <Tag color="purple">
              {workflows.find((w) => w.id === selectedWorkflow)?.name ||
                'Select workflow'}
            </Tag>
          )}
          {processingMessage && (
            <Space size={8}>
              <Tag color="orange" icon={<LoadingOutlined spin />}>
                Processing
              </Tag>
              <Button size="small" danger onClick={onCancelStream}>
                取消
              </Button>
            </Space>
          )}
        </div>
      </div>

      <Button icon={<ReloadOutlined />} onClick={onRefresh}>
        Refresh
      </Button>
    </div>
  );
}