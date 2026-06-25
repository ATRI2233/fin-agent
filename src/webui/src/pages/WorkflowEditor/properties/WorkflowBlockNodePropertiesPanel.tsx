/**
 * WorkflowBlockNodePropertiesPanel — property editor for
 * `workflow-block`-type nodes (imported reusable sub-workflows).
 *
 * Originally lived inline in `pages/WorkflowEditor.tsx` as
 * `WorkflowBlockPropertiesPanel` (lines 788-846 of the legacy file).
 * Extracted by .
 *
 * Field coverage
 * --------------
 * - Label (read-only — the block is identified by its imported workflow
 * name, not user-editable text)
 * - Source workflow (read-only summary panel: name + id)
 * - Child count (read-only tag)
 * - Ungroup (button) — drops the block container, keeps the child nodes
 * - Delete (popconfirm) — removes the block AND all its children
 *
 * Note: this panel receives `onDeleteBlock` / `onUngroupBlock` callbacks
 * (not the generic `onUpdateNode` / `onDeleteNode`) because the actions
 * need access to the orchestrator's `setNodes`/`setEdges` to walk the
 * `childNodeIds` set, which the generic node-update callback cannot do.
 */

import { Form, Typography, Input, Button, Space, Popconfirm, Tag, Divider } from 'antd';
import { DeleteOutlined, UngroupOutlined } from '@ant-design/icons';

import type { WorkflowBlockNodeData, WorkflowBlockNode } from '../index';

export interface WorkflowBlockNodePropertiesPanelProps {
  selectedNode: WorkflowBlockNode;
  onDeleteBlock: (blockId: string) => void;
  onUngroupBlock: (blockId: string) => void;
}

export default function WorkflowBlockNodePropertiesPanel({
  selectedNode,
  onDeleteBlock,
  onUngroupBlock,
}: WorkflowBlockNodePropertiesPanelProps) {
  const data = selectedNode.data;

  return (
    <div style={{ padding: 16 }}>
      <Typography.Text
        strong
        style={{ display: 'block', marginBottom: 12, fontSize: 14, color: '#E5E5E5' }}
      >
        <Tag color="green">workflow-block</Tag> 工作流块属性
      </Typography.Text>
      <Form layout="vertical" size="small">
        <Form.Item label="块名称">
          <Input value={data.label} disabled style={{ color: '#E5E5E5' }} />
        </Form.Item>

        <Form.Item label="引用工作流">
          <div
            style={{
              padding: '8px 12px',
              background: 'rgba(82, 196, 26, 0.06)',
              border: '1px solid rgba(82, 196, 26, 0.15)',
              borderRadius: 6,
            }}
          >
            <div style={{ color: '#E5E5E5', fontWeight: 500 }}>{data.workflowName}</div>
            <div style={{ fontSize: 11, color: '#6B6B6B', marginTop: 2 }}>
              ID: {data.workflowId}
            </div>
          </div>
        </Form.Item>

        <Form.Item label="包含节点">
          <Tag color="blue">{data.childNodeIds.length} 个节点</Tag>
        </Form.Item>

        <Divider style={{ margin: '12px 0', borderColor: 'rgba(255,255,255,0.06)' }} />

        <Form.Item>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Button
              icon={<UngroupOutlined />}
              block
              onClick={() => onUngroupBlock(selectedNode.id)}
              style={{ color: '#52C41A', borderColor: 'rgba(82, 196, 26, 0.3)' }}
            >
              解组（保留子节点）
            </Button>
            <Popconfirm
              title="移除整个工作流块？"
              description="将删除此块及其所有子节点，此操作不可撤销。"
              onConfirm={() => onDeleteBlock(selectedNode.id)}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button danger icon={<DeleteOutlined />} block>
                移除整个块
              </Button>
            </Popconfirm>
          </Space>
        </Form.Item>
      </Form>
    </div>
  );
}
