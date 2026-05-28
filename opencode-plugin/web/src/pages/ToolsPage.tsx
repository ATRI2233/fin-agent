import { useEffect, useState, useCallback } from 'react';
import {
  Typography,
  Table,
  Button,
  Tag,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Alert,
  Spin,
  message,
} from 'antd';
import { ReloadOutlined, EditOutlined, ToolOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text } = Typography;

interface ToolConfig {
  name: string;
  description?: string;
  enabled: boolean;
  source: 'builtin' | 'mcp' | 'custom';
  mcpServer?: string;
}

interface ToolRow extends ToolConfig {
  key: string;
}

export default function ToolsPage() {
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit modal state
  const [editVisible, setEditVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<ToolRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const fetchTools = useCallback(async () => {
    setLoading(true);
    setError(null);
    let allRows: ToolRow[] = [];

    // Fetch tools from /api/tools
    try {
      const res = await fetch('/api/tools');
      if (res.ok) {
        const data: Record<string, ToolConfig> = await res.json();
        const rows: ToolRow[] = Object.entries(data).map(([key, config]) => ({
          ...config,
          key,
        }));
        allRows = [...allRows, ...rows];
      }
    } catch {
      // ignore — tools endpoint may return empty
    }

    // Fetch MCP servers as tools
    try {
      const mcpRes = await fetch('/api/mcp');
      if (mcpRes.ok) {
        const mcpData: Record<string, any> = await mcpRes.json();
        const mcpTools: ToolRow[] = Object.entries(mcpData).map(([name, config]) => ({
          key: `mcp:${name}`,
          name,
          description: config.description || `MCP server: ${name}`,
          enabled: config.enabled !== false,
          source: 'mcp' as const,
          mcpServer: name,
        }));
        allRows = [...allRows, ...mcpTools];
      }
    } catch {
      // ignore mcp fetch errors
    }

    // Add built-in tools
    const builtinTools: ToolRow[] = [
      { key: 'read', name: 'Read', description: 'Read files from disk', enabled: true, source: 'builtin' },
      { key: 'edit', name: 'Edit', description: 'Edit files on disk', enabled: true, source: 'builtin' },
      { key: 'bash', name: 'Bash', description: 'Execute shell commands', enabled: true, source: 'builtin' },
      { key: 'grep', name: 'Grep', description: 'Search file contents', enabled: true, source: 'builtin' },
      { key: 'glob', name: 'Glob', description: 'Find files by pattern', enabled: true, source: 'builtin' },
      { key: 'websearch', name: 'Web Search', description: 'Search the web', enabled: true, source: 'builtin' },
      { key: 'webfetch', name: 'Web Fetch', description: 'Fetch URLs', enabled: true, source: 'builtin' },
      { key: 'lsp_diagnostics', name: 'LSP Diagnostics', description: 'Get LSP errors/warnings', enabled: true, source: 'builtin' },
    ];

    setTools([...allRows, ...builtinTools]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  const handleEdit = (record: ToolRow) => {
    setEditTarget(record);
    form.setFieldsValue({
      name: record.name,
      description: record.description ?? '',
      enabled: record.enabled,
      source: record.source,
      mcpServer: record.mcpServer ?? '',
    });
    setEditVisible(true);
  };

  const handleSave = async () => {
    if (!editTarget) return;
    try {
      const values = await form.validateFields();
      setSaving(true);

      const payload: ToolConfig = {
        name: values.name,
        description: values.description || undefined,
        enabled: values.enabled,
        source: values.source,
        mcpServer: values.mcpServer || undefined,
      };

      const res = await fetch(`/api/tools/${editTarget.key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      message.success(`Tool ${editTarget.key} updated`);
      setEditVisible(false);
      setEditTarget(null);
      form.resetFields();
      fetchTools();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) {
        return; // form validation error
      }
      const msg = err instanceof Error ? err.message : 'Failed to save tool';
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const sourceColorMap: Record<string, string> = {
    builtin: 'green',
    mcp: 'purple',
    custom: 'orange',
  };

  const columns: ColumnsType<ToolRow> = [
    {
      title: 'Name',
      dataIndex: 'key',
      key: 'key',
      sorter: (a, b) => a.key.localeCompare(b.key),
      render: (key: string) => (
        <Space>
          <ToolOutlined style={{ color: '#1890ff' }} />
          <Text strong>{key}</Text>
        </Space>
      ),
    },
    {
      title: 'Display Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text>{name}</Text>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (desc: string | undefined) => (
        <Text type="secondary">{desc || '-'}</Text>
      ),
    },
    {
      title: 'Source',
      dataIndex: 'source',
      key: 'source',
      width: 120,
      filters: [
        { text: 'builtin', value: 'builtin' },
        { text: 'mcp', value: 'mcp' },
        { text: 'custom', value: 'custom' },
      ],
      onFilter: (value, record) => record.source === value,
      render: (source: string) => (
        <Tag color={sourceColorMap[source] ?? 'default'}>{source}</Tag>
      ),
    },
    {
      title: 'MCP Server',
      dataIndex: 'mcpServer',
      key: 'mcpServer',
      ellipsis: true,
      render: (server: string | undefined) => (
        <Text code>{server || '-'}</Text>
      ),
    },
    {
      title: 'Enabled',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 100,
      filters: [
        { text: 'Enabled', value: 'true' },
        { text: 'Disabled', value: 'false' },
      ],
      onFilter: (value, record) => String(record.enabled) === value,
      render: (enabled: boolean) => (
        <Switch checked={enabled} disabled size="small" />
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <Button
          type="link"
          icon={<EditOutlined />}
          onClick={() => handleEdit(record)}
        >
          Edit
        </Button>
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
            Tools
          </Title>
          <Text type="secondary">Manage tool configurations and permissions</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={fetchTools} loading={loading}>
          Reload
        </Button>
      </div>

      {error && (
        <Alert
          type="error"
          message="Failed to load tools"
          description={error}
          showIcon
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<ToolRow>
        columns={columns}
        dataSource={tools}
        rowKey="key"
        loading={loading}
        pagination={{ pageSize: 15 }}
      />

      {/* Edit Modal */}
      <Modal
        title={editTarget ? `Edit: ${editTarget.key}` : 'Edit Tool'}
        open={editVisible}
        onCancel={() => {
          setEditVisible(false);
          setEditTarget(null);
          form.resetFields();
        }}
        footer={
          <Space>
            <Button onClick={() => setEditVisible(false)}>Cancel</Button>
            <Button
              type="primary"
              icon={<EditOutlined />}
              onClick={handleSave}
              loading={saving}
            >
              Save
            </Button>
          </Space>
        }
        width={600}
        destroyOnClose
      >
        {editTarget && (
          <Form
            form={form}
            layout="vertical"
            initialValues={{
              name: editTarget.name,
              description: editTarget.description ?? '',
              enabled: editTarget.enabled,
              source: editTarget.source,
              mcpServer: editTarget.mcpServer ?? '',
            }}
          >
            <Form.Item
              label="Display Name"
              name="name"
              rules={[{ required: true, message: 'Please enter display name' }]}
            >
              <Input placeholder="Tool display name" />
            </Form.Item>
            <Form.Item label="Description" name="description">
              <Input.TextArea rows={2} placeholder="Tool description (optional)" />
            </Form.Item>
            <Form.Item
              label="Source"
              name="source"
              rules={[{ required: true, message: 'Please select source' }]}
            >
              <Select
                options={[
                  { label: 'Built-in', value: 'builtin' },
                  { label: 'MCP Server', value: 'mcp' },
                  { label: 'Custom', value: 'custom' },
                ]}
              />
            </Form.Item>
            <Form.Item label="MCP Server" name="mcpServer">
              <Input placeholder="MCP server name (if source is mcp)" />
            </Form.Item>
            <Form.Item label="Enabled" name="enabled" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
}
