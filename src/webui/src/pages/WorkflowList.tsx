import { useEffect, useState } from 'react';
import { Typography, Table, Button, Tag, Space, Alert, message, Popconfirm, Tabs, Card } from 'antd';
import { EditOutlined, PlayCircleOutlined, CopyOutlined, DeleteOutlined, ReloadOutlined, PlusOutlined, SettingOutlined, BranchesOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import {
  useWorkflows,
  useWorkflow,
  useCreateWorkflow,
  useDeleteWorkflow,
  useTriggerWorkflow,
} from '../hooks/useWorkflows';
import type { WorkflowMeta, WorkflowStatus } from '../types/workflow';
import { WORKFLOW_STATUS_CONFIG } from '../utils/statusConfig';
import { formatDateTime } from '../utils/time';

const { Text } = Typography;

const tabItems = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'running', label: '运行中' },
  { key: 'completed', label: '已完成' },
  { key: 'failed', label: '失败' },
  { key: 'paused', label: '暂停' },
];

export default function WorkflowList() {
  const [activeTab, setActiveTab] = useState<string>('all');
  const [copySourceId, setCopySourceId] = useState<string | null>(null);
  const [copySourceName, setCopySourceName] = useState<string>('');

  const navigate = useNavigate();

  // List hook — single source of truth for the table data.
  const { data, loading, error, refetch } = useWorkflows();
  const createMutation = useCreateWorkflow();
  const deleteMutation = useDeleteWorkflow();
  const triggerMutation = useTriggerWorkflow();

  // Hook-driven single-workload fetch for the "copy" flow.
  const { data: copySource } = useWorkflow(copySourceId);
  const createWorkflow = createMutation.mutate;
  const deleteWorkflow = deleteMutation.mutate;
  const triggerWorkflow = triggerMutation.mutate;

  // Whenever the hook resolves a copy source, create the duplicate.
  useEffect(() => {
    if (!copySourceId || !copySource) return;
    let cancelled = false;
    void (async () => {
      try {
        await createWorkflow({
          name: `${copySourceName} (Copy)`,
          description: copySource.description,
          nodes: copySource.nodes,
          edges: copySource.edges,
          trigger_type: copySource.trigger_type,
          config: copySource.config,
        });
        if (!cancelled) {
          message.success(`"${copySourceName}" copied`);
          refetch();
        }
      } catch {
        if (!cancelled) message.error('Failed to copy');
      } finally {
        if (!cancelled) {
          setCopySourceId(null);
          setCopySourceName('');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [copySourceId, copySource, copySourceName, createWorkflow, refetch]);

  const handleRun = async (id: string) => {
    try {
      await triggerWorkflow({ id });
      message.success('Workflow started');
      refetch();
    } catch { message.error('Failed to run'); }
  };

  const handleCopy = (id: string, name: string) => {
    setCopySourceId(id);
    setCopySourceName(name);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWorkflow(id);
      message.success('Deleted');
      refetch();
    } catch { message.error('Failed to delete'); }
  };

  const errorMessage = error ? (error instanceof Error ? error.message : String(error)) : null;
  const workflowList: WorkflowMeta[] = data ?? [];

  const filteredWorkflows = activeTab === 'all'
    ? workflowList
    : workflowList.filter((w) => w.status === activeTab);

  const columns: ColumnsType<WorkflowMeta> = [
    { title: 'Name', dataIndex: 'name', key: 'name', sorter: (a, b) => a.name.localeCompare(b.name), render: (text: string) => <Text style={{ color: '#F0F0F0', fontWeight: 500, fontSize: 15 }}>{text}</Text> },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 120, render: (s: WorkflowStatus) => <Tag color={WORKFLOW_STATUS_CONFIG[s]?.tag ?? 'default'}>{WORKFLOW_STATUS_CONFIG[s]?.label ?? s}</Tag> },
    { title: 'Nodes', dataIndex: 'node_count', key: 'nodeCount', width: 90, align: 'center', render: (c: number | undefined) => <span style={{ color: '#B0B0B0', fontSize: 15 }}>{c ?? 0}</span> },
    { title: 'Last Run', dataIndex: 'last_run_at', key: 'lastRunAt', width: 180, render: (ts?: string) => <Text type="secondary" style={{ fontSize: 13 }}>{formatDateTime(ts)}</Text> },
    { title: 'Actions', key: 'actions', width: 260, render: (_, r) => (
      <Space>
        <Button type="link" icon={<EditOutlined />} onClick={() => navigate(`/workflows/${r.id}/edit`)}>编辑</Button>
        <Button type="link" icon={<PlayCircleOutlined />} onClick={() => handleRun(r.id)}>执行</Button>
        <Button type="link" icon={<CopyOutlined />} onClick={() => handleCopy(r.id, r.name)}>复制</Button>
        <Popconfirm title={`Delete "${r.name}"?`} onConfirm={() => handleDelete(r.id)}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm>
      </Space>
    )},
  ];

  return (
    <div className="page-container fade-in">
      {/* Hero Header */}
      <div style={{ marginBottom: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="page-hero" style={{ marginBottom: 0 }}>
          <h1 className="page-hero-title">Workflows</h1>
          <p className="page-hero-subtitle">管理工作流自动化</p>
        </div>
        <Space size={12}>
          <Button icon={<SettingOutlined />} onClick={() => navigate('/workflows/settings')} size="large">设置</Button>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => navigate('/workflows/new/edit')} size="large">新建工作流</Button>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading} size="large">刷新</Button>
        </Space>
      </div>
      {errorMessage && <Alert type="error" message="加载工作流失败" description={errorMessage} showIcon closable style={{ marginBottom: 24 }} />}
      <Card className="card-spacious fade-in fade-in-2">
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} style={{ marginBottom: 16, paddingLeft: 4 }} />
        <Table<WorkflowMeta> columns={columns} dataSource={filteredWorkflows} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} size="middle" />
      </Card>
    </div>
  );
}
