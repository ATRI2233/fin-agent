import { Typography, Card, Button, Space, Table, Tag, Spin, message, Tooltip } from 'antd';
import {
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  PauseCircleOutlined,
  HistoryOutlined,
  EyeOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useWorkflows, useTriggerWorkflow } from '../hooks/useWorkflows';
import type { WorkflowMeta } from '../domain/workflow';

const { Text } = Typography;

const statusColors: Record<string, string> = {
  draft: 'default',
  running: 'processing',
  completed: 'success',
  failed: 'error',
  paused: 'warning',
};

const statusIcons: Record<string, React.ReactNode> = {
  draft: <PauseCircleOutlined />,
  running: <SyncOutlined />,
  completed: <CheckCircleOutlined />,
  failed: <CloseCircleOutlined />,
  paused: <ClockCircleOutlined />,
};

export default function FrameworkPage() {
  const navigate = useNavigate();

  // All data via hooks — no manual fetch / state management.
  const { data: workflowsData, loading: wfLoading, refetch: refetchWorkflows } = useWorkflows();
  const triggerMutation = useTriggerWorkflow();

  const loading = wfLoading;
  const workflows: WorkflowMeta[] = workflowsData ?? [];

  const handleTrigger = async (id: string) => {
    try {
      await triggerMutation.mutate({ id });
      message.success('工作流已触发');
      refetchWorkflows();
    } catch {
      message.error('触发工作流失败');
    }
  };

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <div style={{ textAlign: 'center' }}>
        <Spin size="large" />
        <div style={{ marginTop: 16, color: '#787878', fontSize: 14 }}>
          加载中...
        </div>
      </div>
    </div>
  );

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <Text style={{ color: '#F0F0F0', fontWeight: 500, fontSize: 15 }}>{text}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (s: string) => (
        <Tag icon={statusIcons[s]} color={statusColors[s] ?? 'default'}>
          {s.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: '节点数',
      dataIndex: 'node_count',
      key: 'node_count',
      width: 80,
      align: 'center' as const,
      render: (count: number) => (
        <span style={{ color: '#B0B0B0', fontSize: 15 }}>{count}</span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_: unknown, record: WorkflowMeta) => (
        <Space>
          <Tooltip title="编辑">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => navigate(`/workflows/${record.id}/edit`)}
              style={{ color: '#B0B0B0' }}
            />
          </Tooltip>
          <Tooltip title="执行">
            <Button
              type="text"
              icon={<PlayCircleOutlined />}
              onClick={() => handleTrigger(record.id)}
              style={{ color: '#5A9E7B' }}
            />
          </Tooltip>
          <Tooltip title="查看">
            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={() => navigate(`/workflows/${record.id}/view`)}
              style={{ color: '#B0B0B0' }}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container fade-in">
      {/* Hero Header with Actions */}
      <div style={{ marginBottom: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="page-hero" style={{ marginBottom: 0 }}>
          <h1 className="page-hero-title">框架</h1>
          <p className="page-hero-subtitle">工作流编排与管理</p>
        </div>
        <Space size={12}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/workflows/new/edit')}
            size="large"
          >
            新建工作流
          </Button>
          <Button
            icon={<HistoryOutlined />}
            onClick={() => navigate('/executions')}
            size="large"
          >
            历史记录
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => refetchWorkflows()}
            size="large"
          />
        </Space>
      </div>

      {/* Workflow Table */}
      <Card
        title={
          <span style={{ fontWeight: 600, fontSize: 16, color: '#F0F0F0' }}>
            <BranchesOutlined style={{ marginRight: 10, color: '#6B8EC4' }} />
            工作流
          </span>
        }
        className="card-spacious fade-in fade-in-4"
      >
        {workflows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 64 }}>
            <BranchesOutlined style={{ fontSize: 40, color: '#787878', marginBottom: 20 }} />
            <div style={{ color: '#B0B0B0', fontSize: 16, marginBottom: 20 }}>暂无工作流配置</div>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/workflows/new/edit')}
              size="large"
            >
              创建工作流
            </Button>
          </div>
        ) : (
          <Table
            dataSource={workflows}
            columns={columns}
            rowKey="id"
            size="middle"
          />
        )}
      </Card>
    </div>
  );
}
