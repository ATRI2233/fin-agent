/**
 * InputNodePropertiesPanel — property editor for `input`-type nodes.
 *
 * Originally lived inline in `pages/WorkflowEditor.tsx` as
 * `InputNodePropertiesPanel` (lines 855-939 of the legacy file). Extracted
 * by Wave 6 task 6.3b.
 *
 * Field coverage
 * --------------
 *   - Label (free text)
 *   - Params (row-list of `{key, type, default}` triples, add/remove).
 *     Unlike the agent panel, this commits each change immediately
 *     (no local row mirror) because the editor runs in lockstep with
 *     the parent `setNodes` callback.
 *   - Delete (popconfirm + onDeleteNode callback)
 *
 * Re-uses the shared `InputNodeData` type from the canvas component so the
 * editor never drifts from the renderer.
 */

import { Form, Typography, Input, Select, Button, Space, Popconfirm, Tag } from 'antd';
import {
  DeleteOutlined,
  PlusOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import type { Node } from '@xyflow/react';

import type { InputNodeData } from '../../../components/workflow/nodes/InputNode';

export type InputNode = Node<InputNodeData, 'input'>;

export interface InputNodePropertiesPanelProps {
  selectedNode: InputNode;
  onUpdateNode: (id: string, data: Record<string, unknown>) => void;
  onDeleteNode: (id: string) => void;
}

export default function InputNodePropertiesPanel({
  selectedNode,
  onUpdateNode,
  onDeleteNode,
}: InputNodePropertiesPanelProps) {
  const data = selectedNode.data;
  const params = data.params ?? [];

  const addParam = () => {
    onUpdateNode(selectedNode.id, {
      params: [...params, { key: '', type: 'string', default: '' }],
    });
  };

  const removeParam = (idx: number) => {
    onUpdateNode(selectedNode.id, { params: params.filter((_, i) => i !== idx) });
  };

  const updateParam = (
    idx: number,
    field: 'key' | 'type' | 'default',
    val: string,
  ) => {
    const next = params.map((p, i) => (i === idx ? { ...p, [field]: val } : p));
    onUpdateNode(selectedNode.id, { params: next });
  };

  return (
    <div style={{ padding: 16 }}>
      <Typography.Text
        strong
        style={{ display: 'block', marginBottom: 12, fontSize: 14, color: '#E5E5E5' }}
      >
        <Tag color="green">input</Tag> 输入节点属性
      </Typography.Text>
      <Form layout="vertical" size="small">
        <Form.Item label="名称">
          <Input
            value={data.label}
            onChange={(e) => onUpdateNode(selectedNode.id, { label: e.target.value })}
            placeholder="输入节点名称"
          />
        </Form.Item>

        <Form.Item label="输入参数">
          {params.map((param, idx) => (
            <Space key={idx} style={{ display: 'flex', marginBottom: 4 }} align="start">
              <Input
                placeholder="参数名"
                value={param.key}
                onChange={(e) => updateParam(idx, 'key', e.target.value)}
                style={{ width: 80 }}
              />
              <Select
                value={param.type}
                onChange={(val) => updateParam(idx, 'type', val)}
                style={{ width: 70 }}
                options={[
                  { label: 'string', value: 'string' },
                  { label: 'number', value: 'number' },
                  { label: 'boolean', value: 'boolean' },
                ]}
              />
              <Input
                placeholder="默认值"
                value={param.default}
                onChange={(e) => updateParam(idx, 'default', e.target.value)}
                style={{ width: 60 }}
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
