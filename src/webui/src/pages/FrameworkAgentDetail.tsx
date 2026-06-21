import { useParams, useNavigate } from 'react-router-dom';
import { Card, Descriptions, List, Tag, Button, Spin, Alert, Space, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useAgent } from '../hooks/useAgents';
import type { AgentDetail } from '../domain/agent';

const { Title, Text } = Typography;

/**
 * Local view-model that extends `AgentDetail` with legacy optional fields
 * (`capabilities`, `tools`) the detail page renders but the canonical
 * type does not surface. Backend may include them in the payload.
 */
type AgentDetailViewModel = AgentDetail & {
  capabilities?: string[];
  tools?: string[];
};

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

  // The canonical `AgentDetail` only carries execution telemetry fields;
  // the legacy detail page also renders `capabilities` and `tools` arrays
  // (optional in the backend payload). Use a typed view-model with
  // optional fields so the section renderers keep working with
  // permissive `[]` fallbacks.
  const agentVm: AgentDetailViewModel = agent;

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
            {agentVm.name}
          </Title>
          <Text type="secondary">{agentVm.description || 'No description'}</Text>
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
              {agentVm.name}
            </Descriptions.Item>
            <Descriptions.Item label="Mode" span={1}>
              <Tag color={agentVm.mode === 'primary' ? 'blue' : 'default'}>{agentVm.mode}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Description" span={2}>
              {agentVm.description || 'No description'}
            </Descriptions.Item>
          </Descriptions>
        </Card>

        <Card title="Capabilities">
          <List
            dataSource={agentVm.capabilities || []}
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
            dataSource={agentVm.tools || []}
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