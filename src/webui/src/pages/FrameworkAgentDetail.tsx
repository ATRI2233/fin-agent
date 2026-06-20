import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Descriptions, List, Tag, Button, Spin, Alert, Space, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
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

export default function FrameworkAgentDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgent = useCallback(async () => {
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getAgent(name);
      setAgent(data as unknown as AgentDetail);
    } catch (err: unknown) {
      const msg = err instanceof ApiError
        ? `HTTP ${err.status}`
        : err instanceof Error ? err.message : 'Failed to load agent';
      setError(msg);
      setAgent(null);
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    fetchAgent();
  }, [fetchAgent]);

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
          <Button icon={<ReloadOutlined />} onClick={fetchAgent}>
            Refresh
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
      </Space>
    </div>
  );
}