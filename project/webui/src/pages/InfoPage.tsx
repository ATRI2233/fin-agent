import { useEffect, useState, useCallback } from 'react';
import { Card, Table, Tag, Space, Typography, Spin, Button, message, Empty } from 'antd';
import {
  ReloadOutlined,
  DatabaseOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';

const { Text, Title } = Typography;

import { MAINTENANCE_API_BASE } from '../config/env';

interface TaskStatus {
  id: string;
  name: string;
  description: string;
  agent: string;
  enabled: boolean;
  last_status: string | null;
  last_run_at: string | null;
  last_error: string | null;
}

interface DataRecord {
  id: string;
  data_key: string;
  content: any;
  fetched_at: string;
}

interface StatusOverview {
  total_tasks: number;
  enabled_tasks: number;
  healthy_tasks: number;
  failed_tasks: number;
  tasks: TaskStatus[];
}

export default function InfoPage() {
  const [overview, setOverview] = useState<StatusOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [taskData, setTaskData] = useState<DataRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${MAINTENANCE_API_BASE}/status`);
      if (res.ok) setOverview(await res.json());
    } catch (e) {
      console.error('Failed to fetch maintenance status', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 30000);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  const fetchTaskData = async (taskId: string) => {
    setSelectedTask(taskId);
    setDataLoading(true);
    try {
      const res = await fetch(`${MAINTENANCE_API_BASE}/tasks/${taskId}/data?limit=50`);
      if (res.ok) {
        const data = await res.json();
        setTaskData(data.data || []);
      }
    } catch {
      message.error('Failed to load data');
    } finally {
      setDataLoading(false);
    }
  };

  const runTask = async (taskId: string) => {
    try {
      const res = await fetch(`${MAINTENANCE_API_BASE}/tasks/${taskId}/run`, { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        message.success(`更新完成: ${result.records_updated} 条数据`);
        fetchStatus();
        if (selectedTask === taskId) fetchTaskData(taskId);
      } else {
        message.error(`执行失败: ${result.error}`);
      }
    } catch {
      message.error('请求失败');
    }
  };

  const statusIcon = (status: string | null) => {
    if (!status) return <ClockCircleOutlined style={{ color: '#787878' }} />;
    if (status === 'success') return <CheckCircleOutlined style={{ color: '#5A9E7B' }} />;
    if (status === 'running') return <SyncOutlined spin style={{ color: '#6B8EC4' }} />;
    return <CloseCircleOutlined style={{ color: '#D47070' }} />;
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  const columns = [
    {
      title: '数据源',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: TaskStatus) => (
        <div>
          <Text style={{ color: '#F0F0F0', fontWeight: 500 }}>{text}</Text>
          {record.description && (
            <div><Text style={{ color: '#787878', fontSize: 12 }}>{record.description}</Text></div>
          )}
        </div>
      ),
    },
    {
      title: 'Agent',
      dataIndex: 'agent',
      key: 'agent',
      width: 160,
      render: (text: string) => <Tag color="blue">{text}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'last_status',
      key: 'status',
      width: 100,
      render: (status: string | null) => (
        <Space>
          {statusIcon(status)}
          <Text style={{ color: '#B0B0B0', fontSize: 13 }}>{status || '未执行'}</Text>
        </Space>
      ),
    },
    {
      title: '上次更新',
      dataIndex: 'last_run_at',
      key: 'last_run',
      width: 180,
      render: (t: string | null) => (
        <Text style={{ color: '#787878', fontSize: 13 }}>
          {t ? new Date(t).toLocaleString('zh-CN') : '—'}
        </Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: any, record: TaskStatus) => (
        <Space>
          <Button size="small" onClick={() => fetchTaskData(record.id)}>
            查看数据
          </Button>
          <Button size="small" type="primary" onClick={() => runTask(record.id)}>
            立即更新
          </Button>
        </Space>
      ),
    },
  ];

  const dataColumns = [
    {
      title: '数据标识',
      dataIndex: 'data_key',
      key: 'data_key',
      width: 150,
    },
    {
      title: '数据内容',
      dataIndex: 'content',
      key: 'content',
      render: (content: any) => (
        <pre style={{
          margin: 0,
          fontSize: 12,
          color: '#B0B0B0',
          maxHeight: 120,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
        }}>
          {typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
        </pre>
      ),
    },
    {
      title: '获取时间',
      dataIndex: 'fetched_at',
      key: 'fetched_at',
      width: 180,
      render: (t: string) => (
        <Text style={{ color: '#787878', fontSize: 13 }}>
          {new Date(t).toLocaleString('zh-CN')}
        </Text>
      ),
    },
  ];

  return (
    <div className="page-container fade-in">
      <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="page-hero" style={{ marginBottom: 0 }}>
          <h1 className="page-hero-title">
            <DatabaseOutlined style={{ marginRight: 12 }} />信息中心
          </h1>
          <p className="page-hero-subtitle">后台维护的实时数据</p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={fetchStatus} size="large" />
      </div>

      {/* Status cards */}
      {overview && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
          <Card size="small" style={{ flex: 1, background: 'rgba(255,255,255,0.03)' }}>
            <Text style={{ color: '#787878' }}>总任务</Text>
            <div style={{ fontSize: 28, fontWeight: 600, color: '#F0F0F0' }}>{overview.total_tasks}</div>
          </Card>
          <Card size="small" style={{ flex: 1, background: 'rgba(255,255,255,0.03)' }}>
            <Text style={{ color: '#787878' }}>已启用</Text>
            <div style={{ fontSize: 28, fontWeight: 600, color: '#6B8EC4' }}>{overview.enabled_tasks}</div>
          </Card>
          <Card size="small" style={{ flex: 1, background: 'rgba(255,255,255,0.03)' }}>
            <Text style={{ color: '#787878' }}>健康</Text>
            <div style={{ fontSize: 28, fontWeight: 600, color: '#5A9E7B' }}>{overview.healthy_tasks}</div>
          </Card>
          <Card size="small" style={{ flex: 1, background: 'rgba(255,255,255,0.03)' }}>
            <Text style={{ color: '#787878' }}>异常</Text>
            <div style={{ fontSize: 28, fontWeight: 600, color: '#D47070' }}>{overview.failed_tasks}</div>
          </Card>
        </div>
      )}

      {/* Task list */}
      <Card className="card-spacious" style={{ marginBottom: 24 }}>
        <Table
          columns={columns}
          dataSource={overview?.tasks || []}
          rowKey="id"
          pagination={false}
          size="middle"
          locale={{ emptyText: <Empty description="暂无维护任务" /> }}
        />
      </Card>

      {/* Data preview */}
      {selectedTask && (
        <Card
          className="card-spacious"
          title={<Text style={{ color: '#F0F0F0' }}>数据预览</Text>}
          extra={
            <Button size="small" onClick={() => { setSelectedTask(null); setTaskData([]); }}>
              关闭
            </Button>
          }
        >
          <Table
            columns={dataColumns}
            dataSource={taskData}
            rowKey="id"
            loading={dataLoading}
            pagination={{ pageSize: 10 }}
            size="small"
          />
        </Card>
      )}
    </div>
  );
}
