/**
 * ViewAgentModal — read-only viewer for an agent's markdown content.
 *
 * Extracted from the monolithic `AgentsPage.tsx` during . The
 * modal owns its own `content` / `loading` state and refetches on
 * `agentName` change so the orchestrator stays declarative. On load
 * failure we surface a toast and call `onClose()` — the orchestrator
 * toggles the `visible` prop, so the parent decides the UX.
 *
 * @see ./EditAgentModal for the writable counterpart that also exposes
 * the tools-whitelist selector.
 */

import { useEffect, useState } from 'react';
import { Modal, Spin, Tag, Typography, message } from 'antd';
import Editor from '@monaco-editor/react';
import { getAgentContent } from '../../api/agents';

const { Text } = Typography;

/** Subset of `/agents/{name}/content` that the proxy returns. */
interface AgentContent {
  name: string;
  content: string;
  description: string;
  mode: string;
}

export interface ViewAgentModalProps {
  /** Controls modal visibility; the modal resets state on close. */
  visible: boolean;
  /** Called when the user dismisses the modal (cancel, X, or load error). */
  onClose: () => void;
  /** Registry name of the agent to view, or `null` while hidden. */
  agentName: string | null;
}

export default function ViewAgentModal({ visible, onClose, agentName }: ViewAgentModalProps) {
  const [content, setContent] = useState<AgentContent | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!agentName) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setContent(null);
    getAgentContent(agentName)
      .then((raw) => {
        if (cancelled) return;
        const fmMatch = raw.match(/^---[\r]?\n([\s\S]*?)[\r]?\n---/);
        let desc = '';
        let m = 'subagent';
        if (fmMatch) {
          for (const line of fmMatch[1].split('\n')) {
            const [k, ...rest] = line.split(':');
            const v = rest.join(':');
            if (k.trim() === 'description') desc = v.trim();
            if (k.trim() === 'mode') m = v.trim();
          }
        }
        setContent({ name: agentName, content: raw, description: desc, mode: m });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed to load agent content';
        message.error(msg);
        onClose();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentName, onClose]);

  return (
    <Modal
      title={content ? `查看：${content.name}` : '查看 Agent'}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={800}
      destroyOnClose
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spin size="large" />
        </div>
      ) : content ? (
        <div>
          <div style={{ marginBottom: 20, display: 'flex', gap: 24 }}>
            <div>
              <Text style={{ color: '#787878', fontSize: 13, display: 'block', marginBottom: 4 }}>描述</Text>
              <Text style={{ color: '#F0F0F0', fontSize: 15 }}>{content.description || '暂无描述'}</Text>
            </div>
            <div>
              <Text style={{ color: '#787878', fontSize: 13, display: 'block', marginBottom: 4 }}>模式</Text>
              <Tag color={content.mode === 'primary' ? 'blue' : 'default'}>{content.mode}</Tag>
            </div>
          </div>
          <div
            style={{
              height: 400,
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 10,
              overflow: 'hidden',
            }}
          >
            <Editor
              height="100%"
              language="markdown"
              value={content.content}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
              }}
              theme="vs-dark"
            />
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
