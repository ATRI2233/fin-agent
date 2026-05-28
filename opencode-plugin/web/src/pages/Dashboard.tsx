import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Spin, Alert, Tag, List, Typography } from 'antd';
import {
  RobotOutlined,
  ThunderboltOutlined,
  CloudServerOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;

interface AgentMeta {
  name: string;
  description: string;
  mode: string;
  filePath: string;
}

interface SkillMeta {
  name: string;
  description: string;
  filePath: string;
}

interface McpServerConfig {
  type: string;
  command: string | string[];
  args?: string[];
  enabled: boolean;
  description?: string;
  env?: Record<string, string>;
}

interface DashboardState {
  agents: AgentMeta[];
  skills: SkillMeta[];
  mcp: Record<string, McpServerConfig>;
  providersCount: number;
  loading: boolean;
  error: string | null;
}

export default function Dashboard() {
  const [state, setState] = useState<DashboardState>({
    agents: [],
    skills: [],
    mcp: {},
    providersCount: 0,
    loading: true,
    error: null,
  });

  useEffect(() => {
    async function fetchData() {
      try {
        const [agentsRes, skillsRes, mcpRes, providersRes] = await Promise.allSettled([
          fetch('/api/agents').then((r) => r.json()),
          fetch('/api/skills').then((r) => r.json()),
          fetch('/api/mcp').then((r) => r.json()),
          fetch('/api/providers').then((r) => r.json()),
        ]);

        const agents =
          agentsRes.status === 'fulfilled' && agentsRes.value.agents
            ? agentsRes.value.agents
            : [];
        const skills =
          skillsRes.status === 'fulfilled' && skillsRes.value.skills
            ? skillsRes.value.skills
            : [];
        const mcp =
          mcpRes.status === 'fulfilled' && typeof mcpRes.value === 'object'
            ? mcpRes.value
            : {};
        const providersCount =
          providersRes.status === 'fulfilled' &&
          typeof providersRes.value === 'object' &&
          !Array.isArray(providersRes.value)
            ? Object.keys(providersRes.value).length
            : 0;

        setState({ agents, skills, mcp, providersCount, loading: false, error: null });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to fetch data';
        setState((prev) => ({ ...prev, loading: false, error: message }));
      }
    }

    fetchData();
  }, []);

  if (state.loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (state.error) {
    return <Alert type="error" message="Failed to load dashboard" description={state.error} showIcon />;
  }

  const mcpEntries = Object.entries(state.mcp);
  const mcpEnabledCount = mcpEntries.filter(([, cfg]) => cfg.enabled).length;

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        Dashboard
      </Title>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable>
            <Statistic
              title="Agents"
              value={state.agents.length}
              prefix={<RobotOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable>
            <Statistic
              title="Skills"
              value={state.skills.length}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable>
            <Statistic
              title="MCP Servers"
              value={mcpEntries.length}
              prefix={<CloudServerOutlined />}
              valueStyle={{ color: '#722ed1' }}
              suffix={
                <Text type="secondary" style={{ fontSize: 14 }}>
                  / {mcpEnabledCount} active
                </Text>
              }
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable>
            <Statistic
              title="Providers"
              value={state.providersCount}
              prefix={<ApiOutlined />}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={24} lg={12}>
          <Card title="Agents" size="small">
            {state.agents.length === 0 ? (
              <Text type="secondary">No agents configured</Text>
            ) : (
              <List
                dataSource={state.agents}
                size="small"
                renderItem={(agent) => (
                  <List.Item>
                    <List.Item.Meta
                      title={agent.name}
                      description={agent.description || 'No description'}
                    />
                    <Tag>{agent.mode}</Tag>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="MCP Servers" size="small">
            {mcpEntries.length === 0 ? (
              <Text type="secondary">No MCP servers configured</Text>
            ) : (
              <List
                dataSource={mcpEntries}
                size="small"
                renderItem={([name, cfg]) => (
                  <List.Item>
                    <List.Item.Meta
                      title={name}
                      description={cfg.description || (Array.isArray(cfg.command) ? cfg.command.join(' ') : cfg.command)}
                    />
                    {cfg.enabled ? (
                      <Tag icon={<CheckCircleOutlined />} color="success">
                        Enabled
                      </Tag>
                    ) : (
                      <Tag icon={<CloseCircleOutlined />} color="default">
                        Disabled
                      </Tag>
                    )}
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
