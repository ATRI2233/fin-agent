/**
 * OutputNodePropertiesPanel — property editor for `output`-type nodes.
 *
 * Originally lived inline in `pages/WorkflowEditor.tsx` as
 * `OutputNodePropertiesPanel` (lines 948-990 of the legacy file).
 * Extracted by .
 *
 * Field coverage
 * --------------
 * - Label (free text)
 * - outputKey (optional — when set, the runtime extracts this key from
 * the upstream result rather than returning the full payload)
 * - Delete (popconfirm + onDeleteNode callback)
 */

import { Form, Typography, Input, Button, Popconfirm, Tag } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { Node } from '@xyflow/react';

import type { OutputNodeData } from '../../../components/workflow/nodes/OutputNode';

export type OutputNode = Node<OutputNodeData, 'output'>;

export interface OutputNodePropertiesPanelProps {
  selectedNode: OutputNode;
  onUpdateNode: (id: string, data: Record<string, unknown>) => void;
  onDeleteNode: (id: string) => void;
}

export default function OutputNodePropertiesPanel({
  selectedNode,
  onUpdateNode,
  onDeleteNode,
}: OutputNodePropertiesPanelProps) {
  const data = selectedNode.data;

  return (
    <div style={{ padding: 16 }}>
      <Typography.Text
        strong
        style={{ display: 'block', marginBottom: 12, fontSize: 14, color: '#E5E5E5' }}
      >
        <Tag color="gold">output</Tag> 输出节点属性
      </Typography.Text>
      <Form layout="vertical" size="small">
        <Form.Item label="名称">
          <Input
            value={data.label}
            onChange={(e) => onUpdateNode(selectedNode.id, { label: e.target.value })}
            placeholder="输出节点名称"
          />
        </Form.Item>

        <Form.Item label="输出键名（可选）">
          <Input
            value={data.outputKey ?? ''}
            onChange={(e) => onUpdateNode(selectedNode.id, { outputKey: e.target.value })}
            placeholder="从上游结果中提取指定键"
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
