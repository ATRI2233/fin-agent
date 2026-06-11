/**
 * AgentNodePropertiesPanel — property editor for `agent`-type nodes.
 *
 * Originally lived inline in `pages/WorkflowEditor.tsx` as
 * `NodePropertiesPanel` (lines 197-305 of the legacy file). Extracted into
 * `properties/AgentNodePropertiesPanel.tsx` by Wave 6 task 6.3b so the
 * orchestrator can route to a focused per-type panel.
 *
 * Field coverage
 * --------------
 *   - Label (free text)
 *   - Prompt (system prompt / instruction)
 *   - Parameters (key/value pairs edited as a row-list with add/remove)
 *   - Tools (multi-select from the static `AVAILABLE_TOOLS` catalog)
 *   - Delete (popconfirm + onDeleteNode callback)
 *
 * The `parameters` field round-trips through a local `paramRows` mirror so
 * the user can type into empty `key` slots without immediately committing
 * `key: ''` to the workflow graph.
 */

import { useEffect, useState } from 'react';
import { Form, Typography, Input, Select, Button, Space, Popconfirm, Tag } from 'antd';
import {
  DeleteOutlined,
  PlusOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import type { Node } from '@xyflow/react';

/* ─── Domain types ─────────────────────────────────────────────────────── */

export interface AgentNodeData {
  label: string;
  agentType: string;
  prompt?: string;
  parameters?: Record<string, string>;
  tools?: string[];
  inputs: Record<string, string>;
  [key: string]: unknown;
}

export type AgentNode = Node<AgentNodeData, 'agent'>;

/* ─── Tool catalog (static, editor-only) ───────────────────────────────── */

const AVAILABLE_TOOLS = [
  'market_snapshot', 'technical_levels', 'fundamental_scan',
  'news_sentiment', 'sector_rotation', 'insider_trading',
  'fear_greed_index', 'earnings_calendar', 'analyst_ratings',
  'sec_filings', 'options_greeks', 'commodity_prices',
];

/* ─── Component ────────────────────────────────────────────────────────── */

export interface AgentNodePropertiesPanelProps {
  selectedNode: AgentNode;
  onUpdateNode: (id: string, data: Partial<AgentNodeData>) => void;
  onDeleteNode: (id: string) => void;
}

export default function AgentNodePropertiesPanel({
  selectedNode,
  onUpdateNode,
  onDeleteNode,
}: AgentNodePropertiesPanelProps) {
  const [paramRows, setParamRows] = useState<Array<{ key: string; value: string }>>([]);

  // Re-seed the local row mirror when the selected node or its parameters
  // object change. Lets the user edit empty-key rows without wiping them
  // on the next parent re-render.
  useEffect(() => {
    const params = selectedNode.data.parameters ?? {};
    setParamRows(Object.entries(params).map(([key, value]) => ({ key, value })));
  }, [selectedNode.id, selectedNode.data.parameters]);

  const commitParams = (rows: Array<{ key: string; value: string }>) => {
    const obj: Record<string, string> = {};
    rows.forEach((r) => { if (r.key.trim()) obj[r.key.trim()] = r.value; });
    onUpdateNode(selectedNode.id, { parameters: obj });
  };

  const addParam = () => {
    setParamRows([...paramRows, { key: '', value: '' }]);
  };

  const removeParam = (idx: number) => {
    const next = paramRows.filter((_, i) => i !== idx);
    setParamRows(next);
    commitParams(next);
  };

  const updateParam = (idx: number, field: 'key' | 'value', val: string) => {
    const next = paramRows.map((r, i) => (i === idx ? { ...r, [field]: val } : r));
    setParamRows(next);
    commitParams(next);
  };

  return (
    <div style={{ padding: 16 }}>
      <Typography.Text
        strong
        style={{ display: 'block', marginBottom: 12, fontSize: 14, color: '#E5E5E5' }}
      >
        <Tag color="blue">{selectedNode.data.agentType}</Tag> 节点属性
      </Typography.Text>
      <Form layout="vertical" size="small">
        <Form.Item label="名称">
          <Input
            value={selectedNode.data.label}
            onChange={(e) => onUpdateNode(selectedNode.id, { label: e.target.value })}
          />
        </Form.Item>

        <Form.Item label="提示词">
          <Input.TextArea
            rows={4}
            value={selectedNode.data.prompt ?? ''}
            onChange={(e) => onUpdateNode(selectedNode.id, { prompt: e.target.value })}
            placeholder="Agent 指令 / 系统提示词"
          />
        </Form.Item>

        <Form.Item label="参数">
          {paramRows.map((row, idx) => (
            <Space key={idx} style={{ display: 'flex', marginBottom: 4 }} align="start">
              <Input
                placeholder="键"
                value={row.key}
                onChange={(e) => updateParam(idx, 'key', e.target.value)}
                style={{ width: 90 }}
              />
              <Input
                placeholder="值"
                value={row.value}
                onChange={(e) => updateParam(idx, 'value', e.target.value)}
                style={{ width: 90 }}
              />
              <MinusCircleOutlined
                style={{ color: '#C47C7C', cursor: 'pointer', paddingTop: 8 }}
                onClick={() => removeParam(idx)}
              />
            </Space>
          ))}
          <Button
            type="dashed"
            onClick={addParam}
            icon={<PlusOutlined />}
            size="small"
            block
          >
            添加参数
          </Button>
        </Form.Item>

        <Form.Item label="工具">
          <Select
            mode="multiple"
            value={selectedNode.data.tools ?? []}
            onChange={(val) => onUpdateNode(selectedNode.id, { tools: val })}
            options={AVAILABLE_TOOLS.map((t) => ({ label: t, value: t }))}
            placeholder="选择工具"
            style={{ width: '100%' }}
            maxTagCount="responsive"
          />
        </Form.Item>

        <Form.Item>
          <Popconfirm
            title="删除此节点？"
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
