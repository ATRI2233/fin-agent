/**
 * WorkflowBlockSelectorModal — pick an existing workflow to import as a
 * reusable sub-DAG (a "workflow block").
 *
 * Originally lived inline in `pages/WorkflowEditor.tsx` (lines 657-779 of
 * the legacy file). Extracted into its own file by .
 *
 * Data source
 * -----------
 * The list is fetched via the typed `useWorkflows` hook (which backs onto
 * `GET /api/v1/workflows`). The legacy modal called `apiGet('/workflows')`
 * directly — this rewrite drops that raw fetch in favour of the typed
 * hook so loading / error / abort semantics stay uniform with the rest of
 * the app.
 *
 * The current workflow is filtered out so the user cannot import a
 * workflow into itself (which would create a self-referential cycle).
 *
 * The legacy modal also surfaced `node_count` and `created_at` per row;
 * `WorkflowMeta` (the typed list payload) does not include those fields,
 * so we display the available `status` and `trigger_type` instead. This
 * is a deliberate trade-off — we don't fire N+1 fetches to recover the
 * missing fields, since the import action only needs `id` + `name`.
 */

import { useEffect, useMemo, useState } from 'react';
import { Modal, Input, List, Space, Badge, Button, Tooltip, Typography } from 'antd';
import {
  BlockOutlined,
  SearchOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { useWorkflows } from '../../hooks/useWorkflows';

export interface WorkflowBlockSelectorModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (workflowId: string, workflowName: string) => void;
  currentWorkflowId?: string;
}

export default function WorkflowBlockSelectorModal({
  visible,
  onClose,
  onSelect,
  currentWorkflowId,
}: WorkflowBlockSelectorModalProps) {
  const { data: workflows, loading } = useWorkflows();
  const [searchText, setSearchText] = useState('');

  // Clear the search box whenever the modal is dismissed so the next open
  // starts fresh.
  useEffect(() => {
    if (!visible) setSearchText('');
  }, [visible]);

  const filtered = useMemo(() => {
    const all = workflows ?? [];
    const needle = searchText.trim().toLowerCase();
    return all
      .filter((w) => w.id !== currentWorkflowId)
      .filter((w) => (needle ? w.name.toLowerCase().includes(needle) : true));
  }, [workflows, currentWorkflowId, searchText]);

  return (
    <Modal
      title={
        <Space>
          <BlockOutlined style={{ color: '#52C41A' }} />
          <span>选择要导入的工作流</span>
        </Space>
      }
      open={visible}
      onCancel={onClose}
      footer={null}
      width={560}
      destroyOnClose
    >
      <Input
        placeholder="搜索工作流名称..."
        prefix={<SearchOutlined />}
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        style={{ marginBottom: 16 }}
        allowClear
      />
      <List
        loading={loading}
        dataSource={filtered}
        locale={{ emptyText: '暂无可用工作流' }}
        style={{ maxHeight: 400, overflowY: 'auto' }}
        renderItem={(item) => (
          <List.Item
            style={{
              cursor: 'pointer',
              padding: '12px 16px',
              borderRadius: 8,
              marginBottom: 4,
              background: 'rgba(139,157,195,0.04)',
              border: '1px solid rgba(139,157,195,0.10)',
              transition: 'all 0.2s',
            }}
            onClick={() => {
              onSelect(item.id, item.name);
              onClose();
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(82, 196, 26, 0.08)';
              e.currentTarget.style.borderColor = 'rgba(82, 196, 26, 0.25)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(139,157,195,0.04)';
              e.currentTarget.style.borderColor = 'rgba(139,157,195,0.10)';
            }}
          >
            <List.Item.Meta
              title={
                <Space>
                  <span style={{ color: '#E5E5E5' }}>{item.name}</span>
                  <Badge
                    status={
                      item.status === 'draft'
                        ? 'default'
                        : item.status === 'running'
                          ? 'processing'
                          : 'success'
                    }
                    text={
                      <span style={{ fontSize: 11, color: '#A0A0A0' }}>
                        {item.status}
                      </span>
                    }
                  />
                </Space>
              }
              description={
                <Typography.Text style={{ fontSize: 12, color: '#6B6B6B' }}>
                  触发方式：{item.trigger_type}
                </Typography.Text>
              }
            />
            <Tooltip title="点击导入此工作流">
              <Button type="primary" size="small" ghost icon={<LinkOutlined />}>
                导入
              </Button>
            </Tooltip>
          </List.Item>
        )}
      />
    </Modal>
  );
}
