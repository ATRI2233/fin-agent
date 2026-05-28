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
  Alert,
  Spin,
  message,
  Popconfirm,
} from 'antd';
import { ReloadOutlined, EditOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text } = Typography;

interface ProviderModelConfig {
  name: string;
}

interface ProviderConfig {
  name: string;
  npm: string;
  options?: Record<string, unknown>;
  models?: Record<string, ProviderModelConfig>;
}

interface ProviderRow extends ProviderConfig {
  key: string;
}

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit modal state
  const [editVisible, setEditVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<ProviderRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  // Add modal state
  const [addVisible, setAddVisible] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addForm] = Form.useForm();

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/providers');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: Record<string, ProviderConfig> = await res.json();
      const rows: ProviderRow[] = Object.entries(data).map(([key, config]) => ({
        ...config,
        key,
      }));
      setProviders(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load providers';
      setError(msg);
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const handleEdit = (record: ProviderRow) => {
    setEditTarget(record);
    form.setFieldsValue({
      name: record.name,
      npm: record.npm,
      apiKey: record.options?.apiKey ?? '',
      baseURL: record.options?.baseURL ?? '',
    });
    setEditVisible(true);
  };

  const handleSave = async () => {
    if (!editTarget) return;
    try {
      const values = await form.validateFields();
      setSaving(true);

      const payload: ProviderConfig = {
        name: values.name,
        npm: values.npm,
        options: {
          apiKey: values.apiKey,
          baseURL: values.baseURL,
          setCacheKey: true,
        },
        models: editTarget.models,
      };

      const res = await fetch(`/api/providers/${editTarget.key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      message.success(`Provider ${editTarget.key} updated`);
      setEditVisible(false);
      setEditTarget(null);
      form.resetFields();
      fetchProviders();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) {
        return; // form validation error
      }
      const msg = err instanceof Error ? err.message : 'Failed to save provider';
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      const res = await fetch(`/api/providers/${name}`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      message.success(`Provider ${name} deleted`);
      fetchProviders();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete provider';
      message.error(msg);
    }
  };

  const handleAddSave = async () => {
    try {
      const values = await addForm.validateFields();
      setAddSaving(true);

      const payload = {
        name: values.name,
        npm: values.npm,
        options: {
          apiKey: values.apiKey || '',
          baseURL: values.baseURL || '',
          setCacheKey: true,
        },
        models: {},
      };

      const res = await fetch(`/api/providers/${values.key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      message.success('Provider created');
      setAddVisible(false);
      addForm.resetFields();
      fetchProviders();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) {
        return; // form validation error
      }
      const msg = err instanceof Error ? err.message : 'Failed to create provider';
      message.error(msg);
    } finally {
      setAddSaving(false);
    }
  };

  const columns: ColumnsType<ProviderRow> = [
    {
      title: 'Name',
      dataIndex: 'key',
      key: 'key',
      sorter: (a, b) => a.key.localeCompare(b.key),
      render: (key: string) => <Text strong>{key}</Text>,
    },
    {
      title: 'Display Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text>{name}</Text>,
    },
    {
      title: 'NPM Package',
      dataIndex: 'npm',
      key: 'npm',
      ellipsis: true,
      render: (npm: string) => <Text code>{npm}</Text>,
    },
    {
      title: 'Models',
      key: 'models',
      width: 200,
      render: (_, record) => {
        const models = record.models ? Object.keys(record.models) : [];
        return (
          <Space wrap size={[0, 4]}>
            {models.length > 0 ? (
              models.map((m) => (
                <Tag key={m} color="blue">
                  {m}
                </Tag>
              ))
            ) : (
              <Text type="secondary">-</Text>
            )}
          </Space>
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
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            Edit
          </Button>
          <Popconfirm
            title="Delete provider?"
            description={`Are you sure you want to delete "${record.key}"?`}
            onConfirm={() => handleDelete(record.key)}
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
            Providers
          </Title>
          <Text type="secondary">Manage AI model provider configurations</Text>
        </div>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddVisible(true)}>
            Add Provider
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchProviders} loading={loading}>
            Reload
          </Button>
        </Space>
      </div>

      {error && (
        <Alert
          type="error"
          message="Failed to load providers"
          description={error}
          showIcon
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<ProviderRow>
        columns={columns}
        dataSource={providers}
        rowKey="key"
        loading={loading}
        pagination={{ pageSize: 10 }}
      />

      {/* Edit Modal */}
      <Modal
        title={editTarget ? `Edit: ${editTarget.key}` : 'Edit Provider'}
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
              npm: editTarget.npm,
              apiKey: editTarget.options?.apiKey ?? '',
              baseURL: editTarget.options?.baseURL ?? '',
            }}
          >
            <Form.Item
              label="Display Name"
              name="name"
              rules={[{ required: true, message: 'Please enter display name' }]}
            >
              <Input placeholder="e.g. OpenAI" />
            </Form.Item>
            <Form.Item
              label="NPM Package"
              name="npm"
              rules={[{ required: true, message: 'Please enter NPM package name' }]}
            >
              <Input placeholder="e.g. @ai-sdk/openai-compatible" />
            </Form.Item>
            <Form.Item label="API Key" name="apiKey">
              <Input.Password placeholder="API key (optional)" />
            </Form.Item>
            <Form.Item label="Base URL" name="baseURL">
              <Input placeholder="e.g. https://api.openai.com/v1" />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* Add Provider Modal */}
      <Modal
        title="Add Provider"
        open={addVisible}
        onCancel={() => {
          setAddVisible(false);
          addForm.resetFields();
        }}
        footer={
          <Space>
            <Button onClick={() => setAddVisible(false)}>Cancel</Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAddSave}
              loading={addSaving}
            >
              Create
            </Button>
          </Space>
        }
        width={600}
        destroyOnClose
      >
        <Form form={addForm} layout="vertical">
          <Form.Item
            label="Key (identifier)"
            name="key"
            rules={[{ required: true, message: 'Please enter provider key' }]}
          >
            <Input placeholder="e.g. openai, mimo" />
          </Form.Item>
          <Form.Item
            label="Display Name"
            name="name"
            rules={[{ required: true, message: 'Please enter display name' }]}
          >
            <Input placeholder="e.g. OpenAI" />
          </Form.Item>
          <Form.Item
            label="NPM Package"
            name="npm"
            rules={[{ required: true, message: 'Please enter NPM package name' }]}
          >
            <Input placeholder="e.g. @ai-sdk/openai-compatible" />
          </Form.Item>
          <Form.Item label="API Key" name="apiKey">
            <Input.Password placeholder="API key (optional)" />
          </Form.Item>
          <Form.Item label="Base URL" name="baseURL">
            <Input placeholder="e.g. https://api.openai.com/v1" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
