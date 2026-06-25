import { useParams, useNavigate } from 'react-router-dom';
import { Card, Descriptions, Tag, Button, Spin, Alert, Space, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useAgent } from '../hooks/useAgents';

const { Title, Text } = Typography;

export default function FrameworkAgentDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  // Single agent lookup via the framework-level hook. `useAgent(null)`
  // short-circuits when no name is present, so we always pass a real
  // (possibly undefined) string and let the page handle the empty case.
  const { data: agent, loading, error, refetch } = useAgent(name ?? null);

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
        description={error?.message ?? 'Agent not found'}
        showIcon
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
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
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

      </Space>
    </div>
  );
}