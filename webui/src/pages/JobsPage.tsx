import { useEffect, useState, useCallback, useRef } from 'react';
import { Typography, Table, Button, Tag, Space, Modal, Spin, Alert, message, Popconfirm, Form, Select, Input, Tooltip, Badge } from 'antd';
import { EyeOutlined, DeleteOutlined, ReloadOutlined, PlusOutlined, SyncOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text } = Typography;

interface Job {
  id: string;
  agent: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
  updated_at?: string;
  result?: Record<string, unknown>;
}

interface JobDetail extends Job {
  // full job data from detail endpoint
}

const statusColors: Record<string, string> = {
  pending: 'blue',
  running: 'gold',
  completed: 'green',
  failed: 'red',
  cancelled: 'default',
};

function formatDuration(start: string, end?: string): string {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const diffMs = Math.max(0, e - s);
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

const statusFilterOptions = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Running', value: 'running' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Cancelled', value: 'cancelled' },
];

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const pollingRef = useRef(true);
  const [lastPoll, setLastPoll] = useState<Date>(new Date());

  // Detail modal state
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailJob, setDetailJob] = useState<JobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Submit modal state
  const [submitVisible, setSubmitVisible] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitForm] = Form.useForm();
  const [agents, setAgents] = useState<string[]>([]);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/jobs');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      // API returns array directly or { jobs: [...] }
      setJobs(Array.isArray(data) ? data : data.jobs ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load jobs';
      setError(msg);
      setJobs([]);
    } finally {
      setLoading(false);
      setLastPoll(new Date());
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (res.ok) {
        const data = await res.json();
        // agents list: { agents: [{ name }] }
        const agentList = data.agents ?? [];
        if (Array.isArray(agentList)) {
          setAgents(agentList.map((a: { name: string }) => a.name));
        }
      }
    } catch {
      // fallback: leave agents empty
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    fetchAgents();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const handleView = async (id: string) => {
    setDetailVisible(true);
    setDetailLoading(true);
    setDetailJob(null);
    try {
      const res = await fetch(`/api/v1/jobs/${id}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: JobDetail = await res.json();
      setDetailJob(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load job details';
      message.error(msg);
      setDetailVisible(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/jobs/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      message.success('Job cancelled');
      fetchJobs();
    } catch {
      message.error('Failed to cancel job');
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await submitForm.validateFields();
      setSubmitLoading(true);
      const res = await fetch('/api/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: values.agent, prompt: values.prompt }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      message.success('Job submitted');
      setSubmitVisible(false);
      submitForm.resetFields();
      fetchJobs();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      const msg = err instanceof Error ? err.message : 'Failed to submit job';
      message.error(msg);
    } finally {
      setSubmitLoading(false);
    }
  };

  const filteredJobs = statusFilter === 'all'
    ? jobs
    : jobs.filter((j) => j.status === statusFilter);

  const columns: ColumnsType<Job> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 120,
      ellipsis: true,
    },
    {
      title: 'Agent',
      dataIndex: 'agent',
      key: 'agent',
      width: 140,
    },
    {
      title: 'Prompt',
      dataIndex: 'prompt',
      key: 'prompt',
      ellipsis: true,
      render: (prompt: string) => (
        <Tooltip title={prompt} placement="topLeft" overlayStyle={{ maxWidth: 480 }}>
          <Text ellipsis style={{ maxWidth: 300 }}>{prompt}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: string) => (
        <Tag color={statusColors[status] ?? 'default'}>{status}</Tag>
      ),
      filters: statusFilterOptions.slice(1).map((o) => ({ text: o.label, value: o.value })),
      onFilter: (value, record) => record.status === value,
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (ts: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{ts}</Text>
      ),
      sorter: (a, b) => a.created_at.localeCompare(b.created_at),
    },
    {
      title: 'Duration',
      key: 'duration',
      width: 100,
      render: (_, record) => {
        if (record.status === 'pending') return <Text type="secondary">—</Text>;
        const dur = formatDuration(record.created_at, record.updated_at);
        const isRunning = record.status === 'running';
        return (
          <Text type={isRunning ? undefined : 'secondary'} style={{ fontSize: 12 }}>
            {isRunning && <SyncOutlined spin style={{ marginRight: 4, fontSize: 10 }} />}
            {dur}
          </Text>
        );
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 150,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<EyeOutlined />}
            onClick={() => handleView(record.id)}
          >
            View
          </Button>
          {(record.status === 'pending' || record.status === 'running') && (
            <Popconfirm
              title="Cancel job?"
              description="This will terminate the job."
              onConfirm={() => handleCancel(record.id)}
            >
              <Button type="link" danger icon={<DeleteOutlined />}>
                Cancel
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Jobs
            <Badge
              status={pollingRef.current ? 'processing' : 'default'}
              text={<Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>Auto-refresh 5s</Text>}
            />
          </Title>
          <Text type="secondary">Manage framework job execution and submissions</Text>
        </div>
        <Space>
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            options={statusFilterOptions}
            style={{ width: 140 }}
          />
          <Button icon={<PlusOutlined />} type="primary" onClick={() => setSubmitVisible(true)}>
            Submit Job
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchJobs} loading={loading}>
            Reload
          </Button>
        </Space>
      </div>

      {error && (
        <Alert
          type="error"
          message="Failed to load jobs"
          description={error}
          showIcon
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<Job>
        columns={columns}
        dataSource={filteredJobs}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
      />

      {/* Detail Modal */}
      <Modal
        title={detailJob ? `Job: ${detailJob.id}` : 'Job Details'}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={700}
        destroyOnClose
      >
        {detailLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spin size="large" />
          </div>
        ) : detailJob ? (
          <div>
            <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center' }}>
              <Text strong>Agent: </Text>
              <Text>{detailJob.agent}</Text>
              <Tag color={statusColors[detailJob.status] ?? 'default'}>{detailJob.status}</Tag>
            </div>
            <div style={{ marginBottom: 16 }}>
              <Text strong>Prompt:</Text>
              <div
                style={{
                  marginTop: 8,
                  padding: 12,
                  background: '#222222',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.06)',
                  whiteSpace: 'pre-wrap',
                  fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
                  fontSize: 13,
                  color: '#E5E5E5',
                  maxHeight: 150,
                  overflowY: 'auto',
                }}
              >
                {detailJob.prompt}
              </div>
            </div>
            {detailJob.result && (
              <div style={{ marginBottom: 16 }}>
                <Text strong>Result:</Text>
                <pre
                  style={{
                    marginTop: 8,
                    padding: 12,
                    background: '#222222',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.06)',
                    fontSize: 12,
                    color: '#E5E5E5',
                    maxHeight: 200,
                    overflow: 'auto',
                  }}
                >
                  {JSON.stringify(detailJob.result, null, 2)}
                </pre>
              </div>
            )}
            <div style={{ display: 'flex', gap: 24 }}>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>Created</Text>
                <div style={{ fontSize: 13 }}>{detailJob.created_at}</div>
              </div>
              {detailJob.updated_at && (
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>Updated</Text>
                  <div style={{ fontSize: 13 }}>{detailJob.updated_at}</div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Submit Job Modal */}
      <Modal
        title="Submit Job"
        open={submitVisible}
        onCancel={() => { setSubmitVisible(false); submitForm.resetFields(); }}
        footer={
          <Space>
            <Button onClick={() => { setSubmitVisible(false); submitForm.resetFields(); }}>Cancel</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleSubmit} loading={submitLoading}>
              Submit
            </Button>
          </Space>
        }
        width={520}
        destroyOnClose
      >
        <Form
          form={submitForm}
          layout="vertical"
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="agent"
            label="Agent"
            rules={[{ required: true, message: 'Please select an agent' }]}
          >
            <Select
              placeholder="Select an agent"
              options={agents.map((name) => ({ label: name, value: name }))}
              showSearch
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item
            name="prompt"
            label="Prompt"
            rules={[{ required: true, message: 'Please enter a prompt' }]}
          >
            <Input.TextArea
              placeholder="Enter job prompt..."
              rows={6}
              style={{ fontFamily: 'monospace' }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}