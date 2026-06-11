/**
 * EdgePromptEditor — popover body for editing edge prompt metadata.
 *
 * Extracted from `WorkflowEditor.tsx` (lines 606-655) during Wave 6 task 6.3c.
 * Renders a prompt-type selector and text area for the edge connecting two
 * workflow nodes. The caller is responsible for positioning (e.g. via Popover
 * or inline in the inspector panel).
 */

import { useState } from 'react';
import { Typography, Form, Select, Input, Button, Space } from 'antd';

import type { PromptType, EdgePromptData, WorkflowEdge } from './NodeInspector';

/* ─── Constants ────────────────────────────────────────────────────────── */

const PROMPT_TYPE_OPTIONS: Array<{ label: string; value: PromptType; icon: string }> = [
  { label: '上下文信息', value: 'context', icon: '📝' },
  { label: '执行指令', value: 'instruction', icon: '⚡' },
  { label: '约束条件', value: 'constraint', icon: '🔒' },
  { label: '数据传递', value: 'data', icon: '📊' },
];

/* ─── Props ────────────────────────────────────────────────────────────── */

export interface EdgePromptEditorProps {
  /** The edge whose prompt is being edited. */
  edge: WorkflowEdge;
  /** Callback to persist the updated prompt data on the edge. */
  onUpdateEdge: (edgeId: string, data: Partial<EdgePromptData>) => void;
  /** Dismiss the editor without saving. */
  onClose: () => void;
}

/* ─── Component ────────────────────────────────────────────────────────── */

/**
 * Inline editor for edge prompt metadata (type + content).
 *
 * @example
 * ```tsx
 * <EdgePromptEditor
 *   edge={selectedEdge}
 *   onUpdateEdge={(id, data) => updateEdge(id, { data })}
 *   onClose={() => setSelectedEdge(null)}
 * />
 * ```
 */
export default function EdgePromptEditor({ edge, onUpdateEdge, onClose }: EdgePromptEditorProps) {
  const [prompt, setPrompt] = useState(edge.data?.prompt ?? '');
  const [promptType, setPromptType] = useState<PromptType>(edge.data?.promptType ?? 'context');

  const handleSave = () => {
    onUpdateEdge(edge.id, { prompt, promptType });
    onClose();
  };

  return (
    <div style={{ width: 260, padding: 4 }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 8, fontSize: 12, color: '#E5E5E5' }}>
        连接提示词
      </Typography.Text>
      <Form layout="vertical" size="small">
        <Form.Item label="提示词类型" style={{ marginBottom: 8 }}>
          <Select<PromptType>
            value={promptType}
            onChange={setPromptType}
            options={PROMPT_TYPE_OPTIONS.map((o) => ({
              label: `${o.icon} ${o.label}`,
              value: o.value,
            }))}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item label="提示词内容" style={{ marginBottom: 8 }}>
          <Input.TextArea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述此连接的传递内容..."
            style={{ fontSize: 12 }}
          />
        </Form.Item>
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button size="small" onClick={onClose}>取消</Button>
          <Button size="small" type="primary" onClick={handleSave}>保存</Button>
        </Space>
      </Form>
    </div>
  );
}
