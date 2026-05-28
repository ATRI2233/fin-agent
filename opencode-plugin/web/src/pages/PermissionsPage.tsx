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
  Card,
  Alert,
  Spin,
  message,
  Popconfirm,
} from 'antd';
import {
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  SaveOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text } = Typography;

interface PermissionRule {
  tool: string;
  action: 'allow' | 'deny';
  agents?: string[];
  description?: string;
}

interface PermissionsConfig {
  rules: PermissionRule[];
  defaultAction: 'allow' | 'deny';
}

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<PermissionsConfig>({
    rules: [],
    defaultAction: 'allow',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit modal state
  const [editVisible, setEditVisible] = useState(false);
  const [editIndex, setEditIndex] = useState<number>(-1);
  const [form] = Form.useForm();

  // Default action form
  const [defaultAction, setDefaultAction] = useState<'allow' | 'deny'>('allow');

  const fetchPermissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/permissions');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: PermissionsConfig = await res.json();
      setPermissions(data);
      setDefaultAction(data.defaultAction);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load permissions';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const payload: PermissionsConfig = {
        rules: permissions.rules,
        defaultAction,
      };

      const res = await fetch('/api/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      message.success('Permissions saved successfully');
      fetchPermissions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save permissions';
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = () => {
    setEditIndex(-1);
    form.resetFields();
    form.setFieldsValue({
      tool: '',
      action: 'allow',
      agents: '',
      description: '',
    });
    setEditVisible(true);
  };

  const handleEdit = (index: number) => {
    const rule = permissions.rules[index];
    setEditIndex(index);
    form.setFieldsValue({
      tool: rule.tool,
      action: rule.action,
      agents: rule.agents?.join(', ') ?? '',
      description: rule.description ?? '',
    });
    setEditVisible(true);
  };

  const handleDelete = (index: number) => {
    const newRules = [...permissions.rules];
    newRules.splice(index, 1);
    setPermissions({ ...permissions, rules: newRules });
  };

  const handleModalSave = async () => {
    try {
      const values = await form.validateFields();

      const rule: PermissionRule = {
        tool: values.tool,
        action: values.action,
        agents: values.agents
          ? (values.agents as string).split(',').map((s: string) => s.trim()).filter(Boolean)
          : undefined,
        description: values.description || undefined,
      };

      const newRules = [...permissions.rules];
      if (editIndex >= 0) {
        newRules[editIndex] = rule;
      } else {
        newRules.push(rule);
      }

      setPermissions({ ...permissions, rules: newRules });
      setEditVisible(false);
      form.resetFields();
    } catch {
      // form validation error, already shown
    }
  };

  const actionColorMap: Record<string, string> = {
    allow: 'green',
    deny: 'red',
  };

  const columns: ColumnsType<PermissionRule> = [
    {
      title: 'Tool',
      dataIndex: 'tool',
      key: 'tool',
      sorter: (a, b) => a.tool.localeCompare(b.tool),
      render: (tool: string) => (
        <Space>
          <SafetyOutlined style={{ color: '#1890ff' }} />
          <Text strong>{tool}</Text>
        </Space>
      ),
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      width: 120,
      filters: [
        { text: 'Allow', value: 'allow' },
        { text: 'Deny', value: 'deny' },
      ],
      onFilter: (value, record) => record.action === value,
      render: (action: string) => (
        <Tag color={actionColorMap[action] ?? 'default'}>
          {action.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'Agents',
      dataIndex: 'agents',
      key: 'agents',
      render: (agents: string[] | undefined) => (
        <Space wrap size={[0, 4]}>
          {agents && agents.length > 0 ? (
            agents.map((a) => (
              <Tag key={a} color="blue">
                {a}
              </Tag>
            ))
          ) : (
            <Text type="secondary">All agents</Text>
          )}
        </Space>
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
      title: 'Actions',
      key: 'actions',
      width: 150,
      render: (_, _record, index) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEdit(index)}
          >
            Edit
          </Button>
          <Popconfirm
            title="Delete this rule?"
            onConfirm={() => handleDelete(index)}
            okText="Delete"
            cancelText="Cancel"
            okButtonProps={{ danger: true }}
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              Delete
            </Button>
          </Popconfirm>
        </Space>
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
            Permissions
          </Title>
          <Text type="secondary">Manage tool access permissions for agents</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchPermissions} loading={loading}>
            Reload
          </Button>
          <Button icon={<PlusOutlined />} type="primary" onClick={handleAdd}>
            Add Rule
          </Button>
          <Button
            icon={<SaveOutlined />}
            type="primary"
            onClick={handleSaveAll}
            loading={saving}
          >
            Save All
          </Button>
        </Space>
      </div>

      {error && (
        <Alert
          type="error"
          message="Failed to load permissions"
          description={error}
          showIcon
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Default Action Card */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Text strong>Default Action:</Text>
          <Select
            value={defaultAction}
            onChange={(value) => setDefaultAction(value)}
            style={{ width: 150 }}
            options={[
              { label: 'Allow', value: 'allow' },
              { label: 'Deny', value: 'deny' },
            ]}
          />
          <Text type="secondary">
            {defaultAction === 'allow'
              ? 'Tools are allowed by default unless explicitly denied'
              : 'Tools are denied by default unless explicitly allowed'}
          </Text>
        </div>
      </Card>

      {/* Rules Table */}
      <Table<PermissionRule>
        columns={columns}
        dataSource={permissions.rules}
        rowKey={(_, index) => String(index)}
        pagination={{ pageSize: 10 }}
      />

      {/* Edit Modal */}
      <Modal
        title={editIndex >= 0 ? 'Edit Permission Rule' : 'Add Permission Rule'}
        open={editVisible}
        onCancel={() => {
          setEditVisible(false);
          form.resetFields();
        }}
        footer={
          <Space>
            <Button onClick={() => setEditVisible(false)}>Cancel</Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleModalSave}
            >
              Save
            </Button>
          </Space>
        }
        width={500}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="Tool Name"
            name="tool"
            rules={[{ required: true, message: 'Please enter tool name' }]}
          >
            <Input placeholder="e.g. bash, read, write" />
          </Form.Item>
          <Form.Item
            label="Action"
            name="action"
            rules={[{ required: true, message: 'Please select action' }]}
          >
            <Select
              options={[
                { label: 'Allow', value: 'allow' },
                { label: 'Deny', value: 'deny' },
              ]}
            />
          </Form.Item>
          <Form.Item label="Agents" name="agents">
            <Input placeholder="Comma-separated agent names (empty = all agents)" />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea rows={2} placeholder="Rule description (optional)" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
