/**
 * DebateNodePropertiesPanel — property editor for `debate`-type nodes.
 *
 * Originally lived inline in `pages/WorkflowEditor.tsx` as
 * `DebatePropertiesPanel` (lines 315-424 of the legacy file). Extracted by
 * .
 *
 * Field coverage
 * --------------
 * - Label (free text)
 * - Participants (list of agent-type Selects with add/remove). Removing
 * a participant also clears the `judge` slot if it pointed at the
 * same agent; renaming a participant propagates the rename to `judge`.
 * - Judge (single Select over the current participant list)
 * - Prompt (shared analysis prompt for all participants)
 * - Delete (popconfirm + onDeleteNode callback)
 */

import { Form, Typography, Input, Select, Button, Space, Popconfirm, Tag } from 'antd';
import {
  DeleteOutlined,
  PlusOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';

import type { PaletteAgent } from '../AgentPalettePanel';
import type { DebateNodeData, DebateNode } from '../index';

/* ─── Component ────────────────────────────────────────────────────────── */

export interface DebateNodePropertiesPanelProps {
  selectedNode: DebateNode;
  onUpdateNode: (id: string, data: Partial<DebateNodeData>) => void;
  onDeleteNode: (id: string) => void;
  agents: PaletteAgent[];
}

export default function DebateNodePropertiesPanel({
  selectedNode,
  onUpdateNode,
  onDeleteNode,
  agents,
}: DebateNodePropertiesPanelProps) {
  const data = selectedNode.data;

  const addAgent = () => {
    onUpdateNode(selectedNode.id, { agents: [...data.agents, ''] });
  };

  const removeAgent = (idx: number) => {
    const removed = data.agents[idx];
    const next = data.agents.filter((_, i) => i !== idx);
    const update: Partial<DebateNodeData> = { agents: next };
    // If the judge pointed at the removed agent, clear the judge too —
    // the alternative (orphan judge) would silently never fire.
    if (data.judge === removed) {
      update.judge = '';
    }
    onUpdateNode(selectedNode.id, update);
  };

  const updateAgent = (idx: number, val: string) => {
    const old = data.agents[idx];
    const next = data.agents.map((a, i) => (i === idx ? val : a));
    const update: Partial<DebateNodeData> = { agents: next };
    // Keep the judge in sync if it pointed at the renamed agent.
    if (data.judge === old) {
      update.judge = val;
    }
    onUpdateNode(selectedNode.id, update);
  };

  const judgeOptions = data.agents
    .filter((a) => a)
    .map((a) => {
      const agent = agents.find((pa) => pa.type === a);
      return { label: agent ? `${agent.label} (${a})` : a, value: a };
    });

  return (
    <div style={{ padding: 16 }}>
      <Typography.Text
        strong
        style={{ display: 'block', marginBottom: 12, fontSize: 14, color: '#E5E5E5' }}
      >
        <Tag color="purple">debate</Tag> 辩论属性
      </Typography.Text>
      <Form layout="vertical" size="small">
        <Form.Item label="辩论名称">
          <Input
            value={data.label}
            onChange={(e) => onUpdateNode(selectedNode.id, { label: e.target.value })}
          />
        </Form.Item>

        <Form.Item label="参与 Agent">
          {data.agents.map((agent, idx) => (
            <Space key={idx} style={{ display: 'flex', marginBottom: 4 }} align="start">
              <Select
                value={agent || undefined}
                onChange={(val) => updateAgent(idx, val)}
                placeholder="选择 Agent"
                style={{ width: 180 }}
                options={agents.map((a) => ({
                  label: `${a.label} (${a.type})`,
                  value: a.type,
                }))}
              />
              <MinusCircleOutlined
                style={{ color: '#C47C7C', cursor: 'pointer', paddingTop: 8 }}
                onClick={() => removeAgent(idx)}
              />
            </Space>
          ))}
          <Button
            type="dashed"
            onClick={addAgent}
            icon={<PlusOutlined />}
            size="small"
            block
          >
            添加 Agent
          </Button>
        </Form.Item>

        <Form.Item label="裁判 Agent">
          <Select
            value={data.judge || undefined}
            onChange={(val) => onUpdateNode(selectedNode.id, { judge: val ?? '' })}
            placeholder="选择裁判"
            options={judgeOptions}
            allowClear
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item label="辩论提示词">
          <Input.TextArea
            rows={4}
            value={data.prompt}
            onChange={(e) => onUpdateNode(selectedNode.id, { prompt: e.target.value })}
            placeholder="所有 Agent 共享的分析提示词"
          />
        </Form.Item>

        <Form.Item>
          <Popconfirm
            title="删除此辩论节点？"
            description="此操作不可撤销。"
            onConfirm={() => onDeleteNode(selectedNode.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />} block>
              删除节点
            </Button>
          </Popconfirm>
        </Form.Item>
      </Form>
    </div>
  );
}
