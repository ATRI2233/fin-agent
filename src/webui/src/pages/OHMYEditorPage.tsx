import { useEffect, useState, useCallback } from 'react';
import {
  Typography,
  Button,
  Space,
  Spin,
  Alert,
  message,
  Card,
  Tag,
  Row,
  Col,
  Collapse,
} from 'antd';
import {
  SaveOutlined,
  ReloadOutlined,
  AppstoreOutlined,
  RobotOutlined,
  FolderOutlined,
} from '@ant-design/icons';
import Editor from '@monaco-editor/react';

const { Title, Text } = Typography;

interface AgentEntry {
  name: string;
  description?: string;
  mode?: string;
  [key: string]: unknown;
}

interface CategoryEntry {
  name: string;
  agents?: string[];
  description?: string;
  [key: string]: unknown;
}

interface OhMyConfig {
  agents?: Record<string, AgentEntry>;
  categories?: Record<string, CategoryEntry>;
  [key: string]: unknown;
}

export default function OHMYEditorPage() {
  const [config, setConfig] = useState<OhMyConfig>({});
  const [rawContent, setRawContent] = useState<string>('{}');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/config/oh-my-openagent');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: OhMyConfig = await res.json();
      setConfig(data);
      setRawContent(JSON.stringify(data, null, 2));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load config';
      setError(msg);
      setConfig({});
      setRawContent('{}');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const parsed = JSON.parse(rawContent) as OhMyConfig;
      const res = await fetch('/api/config/oh-my-openagent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      setConfig(parsed);
      message.success('Configuration saved successfully');
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        message.error('Invalid JSON: please check your syntax');
      } else {
        const msg = err instanceof Error ? err.message : 'Failed to save';
        message.error(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    setRawContent(value ?? '{}');
  };

  const agents = config.agents ? Object.entries(config.agents) : [];
  const categories = config.categories ? Object.entries(config.categories) : [];

  const collapseItems = [
    {
      key: 'agents',
      label: (
        <Space>
          <RobotOutlined />
          <Text strong>Agents ({agents.length})</Text>
        </Space>
      ),
      children: agents.length === 0 ? (
        <Text type="secondary">No agents configured</Text>
      ) : (
        <Row gutter={[12, 12]}>
          {agents.map(([name, agent]) => (
            <Col xs={24} sm={12} lg={8} key={name}>
              <Card size="small" hoverable>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space>
                    <RobotOutlined style={{ color: '#1677ff' }} />
                    <Text strong>{name}</Text>
                    {agent.mode && (
                      <Tag color={agent.mode === 'primary' ? 'blue' : 'default'}>
                        {agent.mode}
                      </Tag>
                    )}
                  </Space>
                  <Text type="secondary" ellipsis>
                    {agent.description || 'No description'}
                  </Text>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      ),
    },
    {
      key: 'categories',
      label: (
        <Space>
          <FolderOutlined />
          <Text strong>Categories ({categories.length})</Text>
        </Space>
      ),
      children: categories.length === 0 ? (
        <Text type="secondary">No categories configured</Text>
      ) : (
        <Row gutter={[12, 12]}>
          {categories.map(([name, category]) => (
            <Col xs={24} sm={12} lg={8} key={name}>
              <Card size="small" hoverable>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space>
                    <FolderOutlined style={{ color: '#52c41a' }} />
                    <Text strong>{name}</Text>
                    {category.agents && (
                      <Tag>{category.agents.length} agents</Tag>
                    )}
                  </Space>
                  <Text type="secondary" ellipsis>
                    {category.description || 'No description'}
                  </Text>
                  {category.agents && category.agents.length > 0 && (
                    <Space size={[0, 4]} wrap>
                      {category.agents.map((agentName) => (
                        <Tag key={agentName} color="blue">
                          {agentName}
                        </Tag>
                      ))}
                    </Space>
                  )}
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      ),
    },
  ];

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexShrink: 0,
        }}
      >
        <div>
          <Space>
            <AppstoreOutlined style={{ fontSize: 20 }} />
            <Title level={4} style={{ margin: 0 }}>
              Oh My OpenAgent
            </Title>
          </Space>
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            Manage oh-my-openagent.jsonc configuration
          </Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchConfig} loading={loading}>
            Reload
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={saving}
          >
            Save
          </Button>
        </Space>
      </div>

      {error && (
        <Alert
          type="error"
          message="Failed to load configuration"
          description={error}
          showIcon
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16, flexShrink: 0 }}
        />
      )}

      {/* Main content: structured view + editor */}
      <Row gutter={16} style={{ flex: 1, minHeight: 0 }}>
        {/* Structured view */}
        <Col xs={24} lg={10} style={{ marginBottom: 16 }}>
          <Collapse
            defaultActiveKey={['agents', 'categories']}
            items={collapseItems}
            style={{ height: '100%', overflow: 'auto' }}
          />
        </Col>

        {/* JSONC Editor */}
        <Col xs={24} lg={14} style={{ marginBottom: 16 }}>
          <div
            style={{
              height: '100%',
              minHeight: 400,
              border: '1px solid #d9d9d9',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            <Editor
              height="100%"
              language="json"
              value={rawContent}
              onChange={handleEditorChange}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                formatOnPaste: true,
                tabSize: 2,
              }}
              theme="vs-dark"
            />
          </div>
        </Col>
      </Row>
    </div>
  );
}
