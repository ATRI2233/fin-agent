import { useEffect, useState, useCallback } from 'react';
import { Typography, Table, Button, Tag, Space, Modal, Spin, Alert, message, Popconfirm, Form, Input, Select, Tabs, Card } from 'antd';
import { EditOutlined, PlayCircleOutlined, CopyOutlined, DeleteOutlined, ReloadOutlined, PlusOutlined, SettingOutlined, BranchesOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { listWorkflows, getWorkflow, createWorkflow, deleteWorkflow, triggerWorkflow } from '../api/workflows';
import type { WorkflowStatus } from '../types/workflow';

const { Text } = Typography;

interface WorkflowMeta {
  id: string;
  name: string;
  status: WorkflowStatus;
  nodeCount: number;
  createdAt: string;
  lastRunAt?: string;
}

const statusColors: Record<WorkflowStatus, string> = {
  draft: 'default',
  running: 'processing',
  completed: 'success',
  failed: 'error',
  paused: 'warning',
};

const statusLabels: Record<WorkflowStatus, string> = {
  draft: '草稿',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  paused: '暂停',
};

const tabItems = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'running', label: '运行中' },
  { key: 'completed', label: '已完成' },
];

export default function WorkflowList() {
  const [workflows, setWorkflows] = useState<WorkflowMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('all');

  const navigate = useNavigate();

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listWorkflows();
      const workflows: WorkflowMeta[] = (Array.isArray(data) ? data : []).map((w) => ({
        id: w.id,
        name: w.name,
        status: w.status,
        nodeCount: w.node_count ?? 0,
        createdAt: w.created_at ?? '',
        lastRunAt: w.last_run_at ?? undefined,
      }));
      setWorkflows(workflows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
      setWorkflows([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  const handleRun = async (id: string) => {
    try {
      await triggerWorkflow(id);
      message.success('Workflow started');
      fetchWorkflows();
    } catch { message.error('Failed to run'); }
  };

  const handleCopy = async (id: string, name: string) => {
    try {
      // No dedicated copy endpoint — fetch full workflow then create a duplicate
      const source = await getWorkflow(id);
      await createWorkflow({
        name: `${name} (Copy)`,
        description: source.description,
        nodes: source.nodes,
        edges: source.edges,
        trigger_type: source.trigger_type,
        config: source.config,
      });
      message.success(`"${name}" copied`);
      fetchWorkflows();
    } catch { message.error('Failed to copy'); }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWorkflow(id);
      message.success('Deleted');
      fetchWorkflows();
    } catch { message.error('Failed to delete'); }
  };

  const filteredWorkflows = activeTab === 'all' ? workflows : workflows.filter((w) => w.status === activeTab);

  const columns: ColumnsType<WorkflowMeta> = [
    { title: 'Name', dataIndex: 'name', key: 'name', sorter: (a, b) => a.name.localeCompare(b.name), render: (text: string) => <Text style={{ color: '#F0F0F0', fontWeight: 500, fontSize: 15 }}>{text}</Text> },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 120, render: (s: WorkflowStatus) => <Tag color={statusColors[s] ?? 'default'}>{statusLabels[s]}</Tag> },
    { title: 'Nodes', dataIndex: 'nodeCount', key: 'nodeCount', width: 90, align: 'center', render: (c: number) => <span style={{ color: '#B0B0B0', fontSize: 15 }}>{c}</span> },
    { title: 'Last Run', dataIndex: 'lastRunAt', key: 'lastRunAt', width: 180, render: (ts?: string) => <Text type="secondary" style={{ fontSize: 13 }}>{ts ?? '—'}</Text> },
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
          <Button icon={<ReloadOutlined />} onClick={fetchWorkflows} loading={loading} size="large">刷新</Button>
        </Space>
      </div>
      {error && <Alert type="error" message="加载工作流失败" description={error} showIcon closable onClose={() => setError(null)} style={{ marginBottom: 24 }} />}
      <Card className="card-spacious fade-in fade-in-2">
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} style={{ marginBottom: 16, paddingLeft: 4 }} />
        <Table<WorkflowMeta> columns={columns} dataSource={filteredWorkflows} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} size="middle" />
      </Card>
    </div>
  );
}
