import { useEffect, useState, useCallback } from 'react';
import {
  Typography,
  Table,
  Button,
  Tag,
  Space,
  Modal,
  Switch,
  Form,
  Input,
  Select,
  Alert,
  Spin,
  message,
} from 'antd';
import { ReloadOutlined, EditOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text } = Typography;

interface McpServerConfig {
  type: string;
  command: string | string[];
  args?: string[];
  enabled: boolean;
  description?: string;
  env?: Record<string, string>;
}

interface McpServerRow extends McpServerConfig {
  name: string;
}

export default function MCPServersPage() {
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit modal state
  const [editVisible, setEditVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<McpServerRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const fetchServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/mcp');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: Record<string, McpServerConfig> = await res.json();
      const rows: McpServerRow[] = Object.entries(data).map(([name, config]) => ({
        ...config,
        name,
      }));
      setServers(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load MCP servers';
      setError(msg);
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const handleToggle = async (name: string) => {
    try {
      const res = await fetch(`/api/mcp/${name}/toggle`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setServers((prev) =>
        prev.map((s) => (s.name === name ? { ...s, enabled: data.enabled } : s)),
      );
      message.success(`MCP server ${name} ${data.enabled ? 'enabled' : 'disabled'}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to toggle MCP server';
      message.error(msg);
    }
  };

  const handleEdit = (record: McpServerRow) => {
    setEditTarget(record);
    form.setFieldsValue({
      type: record.type,
      command: Array.isArray(record.command) ? record.command.join(' ') : record.command,
      args: record.args?.join(' ') ?? '',
      description: record.description ?? '',
    });
    setEditVisible(true);
  };

  const handleSave = async () => {
    if (!editTarget) return;
    try {
      const values = await form.validateFields();
      setSaving(true);

      const command = values.command as string;
      const argsStr = values.args as string;
      const payload: McpServerConfig = {
        type: values.type,
        command,
        args: argsStr ? argsStr.split(/\s+/) : [],
        enabled: editTarget.enabled,
        description: values.description || undefined,
      };

      const res = await fetch(`/api/mcp/${editTarget.name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      message.success(`MCP server ${editTarget.name} updated`);
      setEditVisible(false);
      setEditTarget(null);
      form.resetFields();
      fetchServers();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) {
        return; // form validation error, already shown
      }
      const msg = err instanceof Error ? err.message : 'Failed to save MCP config';
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<McpServerRow> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (type: string) => (
        <Tag color={type === 'sse' ? 'purple' : 'blue'}>{type}</Tag>
      ),
      filters: [
        { text: 'stdio', value: 'stdio' },
        { text: 'sse', value: 'sse' },
      ],
      onFilter: (value, record) => record.type === value,
    },
    {
      title: 'Command',
      dataIndex: 'command',
      key: 'command',
      ellipsis: true,
      render: (command: string | string[]) => (
        <Text code>{Array.isArray(command) ? command.join(' ') : command}</Text>
      ),
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
      title: 'Enabled',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 100,
      filters: [
        { text: 'Enabled', value: 'true' },
        { text: 'Disabled', value: 'false' },
      ],
      onFilter: (value, record) => String(record.enabled) === value,
      render: (_: boolean, record: McpServerRow) => (
        <Switch
          checked={record.enabled}
          onChange={() => handleToggle(record.name)}
          size="small"
        />
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
            MCP Servers
          </Title>
          <Text type="secondary">Manage MCP server connections and configurations</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={fetchServers} loading={loading}>
          Reload
        </Button>
      </div>

      {error && (
        <Alert
          type="error"
          message="Failed to load MCP servers"
          description={error}
          showIcon
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<McpServerRow>
        columns={columns}
        dataSource={servers}
        rowKey="name"
        loading={loading}
        pagination={{ pageSize: 10 }}
      />

      {/* Edit Modal */}
      <Modal
        title={editTarget ? `Edit: ${editTarget.name}` : 'Edit MCP Server'}
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
              type: editTarget.type,
              command: Array.isArray(editTarget.command)
                ? editTarget.command.join(' ')
                : editTarget.command,
              args: editTarget.args?.join(' ') ?? '',
              description: editTarget.description ?? '',
            }}
          >
            <Form.Item
              label="Type"
              name="type"
              rules={[{ required: true, message: 'Please select MCP type' }]}
            >
              <Select
                options={[
                  { label: 'stdio', value: 'stdio' },
                  { label: 'sse', value: 'sse' },
                ]}
              />
            </Form.Item>
            <Form.Item
              label="Command"
              name="command"
              rules={[{ required: true, message: 'Please enter the command' }]}
            >
              <Input placeholder="e.g. npx @modelcontextprotocol/server-filesystem" />
            </Form.Item>
            <Form.Item label="Arguments" name="args">
              <Input placeholder="Space-separated arguments (optional)" />
            </Form.Item>
            <Form.Item label="Description" name="description">
              <Input.TextArea rows={2} placeholder="Server description (optional)" />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
}
