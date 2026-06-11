import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Descriptions, List, Tag, Table, Form, Input, Button, message, Spin, Alert, Space, Modal, Typography } from 'antd';
import { PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { API_V1_BASE } from '../config/env';
import { apiGet, apiPost, buildUrl } from '../api/client';
import { getAgent } from '../api/agents';
import { ApiError } from '../types/api-error';

const { Title, Text } = Typography;

interface AgentDetail {
  name: string;
  description: string;
  mode: string;
  capabilities: string[];
  tools: string[];
}

interface Job {
  id: string;
  agent: string;
  prompt: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export default function FrameworkAgentDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [runModalVisible, setRunModalVisible] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [runForm] = Form.useForm();

  const fetchAgent = useCallback(async () => {
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getAgent(name);
      setAgent(data as unknown as AgentDetail);
    } catch (err: unknown) {
      const msg = err instanceof ApiError
        ? `HTTP ${err.problem.status}`
        : err instanceof Error ? err.message : 'Failed to load agent';
      setError(msg);
      setAgent(null);
    } finally {
      setLoading(false);
    }
  }, [name]);

  const fetchJobs = useCallback(async () => {
    if (!name) return;
    setJobsLoading(true);
    try {
      // TODO: /api/v1/jobs is a latent-bug endpoint — there is no `jobs`
      // resource in the current backend. The legacy implementation
      // expected a separate jobs table that was never wired up. The
      // intended replacement is `listExecutions({ workflow_id })` from
      // `api/executions.ts`, but the response shape does not match the
      // local `Job` interface (executions return workflow nodes, not
      // agent dispatches). Track this in Wave 4.
      const data = await apiGet<Job[]>(buildUrl(API_V1_BASE, '/jobs'));
      // Filter by agent name on client side
      setJobs(data.filter((job) => job.agent === name));
    } catch (err: unknown) {
      const msg = err instanceof ApiError
        ? `HTTP ${err.problem.status}`
        : err instanceof Error ? err.message : 'Failed to load jobs';
      message.error(msg);
    } finally {
      setJobsLoading(false);
    }
  }, [name]);

  useEffect(() => {
    fetchAgent();
    fetchJobs();
  }, [fetchAgent, fetchJobs]);

  const handleRunAgent = async () => {
    if (!name) return;
    try {
      const values = await runForm.validateFields();
      setRunLoading(true);
      // TODO: POST /api/v1/jobs is the same latent-bug endpoint as the
      // GET above. There is no `jobs` resource in the current backend;
      // the intended replacement is `createMessage(...)` (workflow
      // mode) or a new dispatch endpoint. Track this in Wave 4.
      const job = await apiPost<Job>(
        buildUrl(API_V1_BASE, '/jobs'),
        { agent: name, prompt: values.prompt },
      );
      message.success(`Job ${job.id} created`);
      setRunModalVisible(false);
      runForm.resetFields();
      fetchJobs();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      const msg = err instanceof ApiError
        ? `HTTP ${err.problem.status}`
        : err instanceof Error ? err.message : 'Failed to run agent';
      message.error(msg);
    } finally {
      setRunLoading(false);
    }
  };

  const jobColumns: ColumnsType<Job> = [
    {
      title: 'Job ID',
      dataIndex: 'id',
      key: 'id',
      width: 200,
      render: (id: string) => <Text code>{id}</Text>,
    },
    {
      title: 'Prompt',
      dataIndex: 'prompt',
      key: 'prompt',
      ellipsis: true,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const colorMap: Record<string, string> = {
          pending: 'orange',
          running: 'blue',
          completed: 'green',
          failed: 'red',
        };
        return <Tag color={colorMap[status] || 'default'}>{status}</Tag>;
      },
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (ts: string) => new Date(ts).toLocaleString(),
    },
  ];

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error || !agent) {
    return (
      <Alert
        type="error"
        message="Failed to load agent"
        description={error || 'Agent not found'}
        showIcon
        closable
        onClose={() => navigate('/agents')}
        action={
          <Button size="small" onClick={() => navigate('/agents')}>
            Back to Agents
          </Button>
        }
      />
    );
  }

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
            {agent.name}
          </Title>
          <Text type="secondary">{agent.description || 'No description'}</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { fetchAgent(); fetchJobs(); }}>
            Refresh
          </Button>
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => setRunModalVisible(true)}>
            Run Agent
          </Button>
        </Space>
      </div>

      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Card title="Agent Information">
          <Descriptions column={2} bordered>
            <Descriptions.Item label="Name" span={1}>
              {agent.name}
            </Descriptions.Item>
            <Descriptions.Item label="Mode" span={1}>
              <Tag color={agent.mode === 'primary' ? 'blue' : 'default'}>{agent.mode}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Description" span={2}>
              {agent.description || 'No description'}
            </Descriptions.Item>
          </Descriptions>
        </Card>

        <Card title="Capabilities">
          <List
            dataSource={agent.capabilities || []}
            renderItem={(item: string) => (
              <List.Item>
                <Text>{item}</Text>
              </List.Item>
            )}
            locale={{ emptyText: 'No capabilities defined' }}
          />
        </Card>

        <Card title="Tools">
          <List
            dataSource={agent.tools || []}
            renderItem={(item: string) => (
              <List.Item>
                <Tag>{item}</Tag>
              </List.Item>
            )}
            locale={{ emptyText: 'No tools available' }}
          />
        </Card>

        <Card title="Jobs History">
          {jobsLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <Spin size="large" />
            </div>
          ) : (
            <Table<Job>
              columns={jobColumns}
              dataSource={jobs}
              rowKey="id"
              pagination={{ pageSize: 10 }}
              size="small"
            />
          )}
        </Card>
      </Space>

      <Modal
        title={`Run Agent: ${agent.name}`}
        open={runModalVisible}
        onCancel={() => { setRunModalVisible(false); runForm.resetFields(); }}
        footer={
          <Space>
            <Button onClick={() => { setRunModalVisible(false); runForm.resetFields(); }}>
              Cancel
            </Button>
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleRunAgent} loading={runLoading}>
              Run
            </Button>
          </Space>
        }
        width={520}
        destroyOnClose
      >
        <Form form={runForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="prompt"
            label="Prompt"
            rules={[{ required: true, message: 'Please enter a prompt' }]}
          >
            <Input.TextArea
              placeholder="What should this agent do?"
              rows={6}
              autoSize={{ minRows: 4, maxRows: 10 }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}