import { useEffect, useState, useCallback } from 'react';
import { Typography, Table, Button, Tag, Space, Modal, Form, Input, Alert, Spin, message, Popconfirm, Select, Card, Radio } from 'antd';
import { ReloadOutlined, EditOutlined, DeleteOutlined, PlusOutlined, CheckCircleFilled } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text } = Typography;

interface ProviderModelConfig { name: string; }
interface ProviderConfig { name: string; npm: string; options?: Record<string, unknown>; models?: Record<string, ProviderModelConfig>; }
interface ProviderRow extends ProviderConfig { key: string; }

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeProvider, setActiveProvider] = useState('');
  const [activeModel, setActiveModel] = useState('');

  const [editVisible, setEditVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<ProviderRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const [addVisible, setAddVisible] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addForm] = Form.useForm();

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/providers');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const provMap: Record<string, ProviderConfig> = data.providers || data;
      setProviders(Object.entries(provMap).map(([k, c]) => ({ ...(c as ProviderConfig), key: k })));
      if (data.active) {
        setActiveProvider(data.active.provider || '');
        setActiveModel(data.active.model || '');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载失败');
      setProviders([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchProviders(); }, [fetchProviders]);

  const handleSetActive = async (provider: string, model: string) => {
    try {
      const res = await fetch('/api/providers/active', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setActiveProvider(provider);
      setActiveModel(model);
      message.success(`已切换到 ${provider}${model ? ` / ${model}` : ''}`);
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : '切换失败');
    }
  };

  const handleEdit = (r: ProviderRow) => {
    setEditTarget(r);
    form.setFieldsValue({ name: r.name, npm: r.npm, apiKey: r.options?.apiKey ?? '', baseURL: r.options?.baseURL ?? '' });
    setEditVisible(true);
  };

  const handleSave = async () => {
    if (!editTarget) return;
    try {
      const v = await form.validateFields();
      setSaving(true);
      const res = await fetch(`/api/providers/${editTarget.key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: v.name, npm: v.npm, options: { apiKey: v.apiKey, baseURL: v.baseURL, setCacheKey: true }, models: editTarget.models }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      message.success(`${editTarget.key} 已更新`);
      setEditVisible(false); setEditTarget(null); form.resetFields(); fetchProviders();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally { setSaving(false); }
  };

  const handleDelete = async (name: string) => {
    try {
      const res = await fetch(`/api/providers/${name}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (activeProvider === name) {
        setActiveProvider('');
        setActiveModel('');
      }
      message.success(`${name} 已删除`);
      fetchProviders();
    } catch (err: unknown) { message.error(err instanceof Error ? err.message : '操作失败'); }
  };

  const handleAddSave = async () => {
    try {
      const v = await addForm.validateFields();
      setAddSaving(true);
      const res = await fetch(`/api/providers/${v.key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: v.name, npm: v.npm, options: { apiKey: v.apiKey || '', baseURL: v.baseURL || '', setCacheKey: true }, models: {} }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      message.success('提供商已创建');
      setAddVisible(false); addForm.resetFields(); fetchProviders();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(err instanceof Error ? err.message : '创建失败');
    } finally { setAddSaving(false); }
  };

  // Get models for the currently active provider
  const activeProviderRow = providers.find((p) => p.key === activeProvider);
  const activeModels = activeProviderRow?.models ? Object.keys(activeProviderRow.models) : [];

  const columns: ColumnsType<ProviderRow> = [
    {
      title: '状态', key: 'status', width: 60, align: 'center',
      render: (_, r) => r.key === activeProvider
        ? <CheckCircleFilled style={{ color: '#5A9E7B', fontSize: 18 }} />
        : <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.15)' }} />,
    },
    { title: '标识', dataIndex: 'key', key: 'key', sorter: (a, b) => a.key.localeCompare(b.key), render: (k: string) => <Text strong style={{ color: k === activeProvider ? '#5A9E7B' : undefined }}>{k}</Text> },
    { title: '显示名称', dataIndex: 'name', key: 'name', render: (n: string) => <Text>{n}</Text> },
    { title: 'NPM 包', dataIndex: 'npm', key: 'npm', ellipsis: true, render: (n: string) => <Text code>{n}</Text> },
    {
      title: '模型', key: 'models', width: 220,
      render: (_, r) => {
        const ms = r.models ? Object.keys(r.models) : [];
        return (
          <Space wrap size={[0, 4]}>
            {ms.length > 0 ? ms.map((m) => (
              <Tag
                key={m}
                color={r.key === activeProvider && m === activeModel ? 'green' : 'blue'}
                style={{ cursor: 'pointer' }}
                onClick={() => handleSetActive(r.key, m)}
              >
                {m}
              </Tag>
            )) : <Text type="secondary">-</Text>}
          </Space>
        );
      },
    },
    { title: '操作', key: 'actions', width: 200, render: (_, r) => (
      <Space>
        <Button type="link" size="small" onClick={() => handleSetActive(r.key, '')} disabled={r.key === activeProvider && !activeModel}>
          {r.key === activeProvider && !activeModel ? '已激活' : '设为激活'}
        </Button>
        <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
        <Popconfirm title={`删除 "${r.key}"？`} onConfirm={() => handleDelete(r.key)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm>
      </Space>
    )},
  ];

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>提供商</Title>
          <Text type="secondary">管理 AI 模型提供商，设置当前启用的 LLM</Text>
        </div>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddVisible(true)}>添加提供商</Button>
          <Button icon={<ReloadOutlined />} onClick={fetchProviders} loading={loading}>刷新</Button>
        </Space>
      </div>

      {/* Active provider card */}
      <Card
        style={{ marginBottom: 20, background: 'rgba(90, 158, 123, 0.06)', border: '1px solid rgba(90, 158, 123, 0.2)' }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircleFilled style={{ color: '#5A9E7B', fontSize: 20 }} />
            <Text strong style={{ fontSize: 15, color: '#E5E5E5' }}>当前激活</Text>
          </div>
          <Select
            value={activeProvider || undefined}
            onChange={(val) => handleSetActive(val, '')}
            placeholder="选择提供商"
            style={{ width: 180 }}
            allowClear
            options={providers.map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }))}
          />
          {activeModels.length > 0 && (
            <Select
              value={activeModel || undefined}
              onChange={(val) => handleSetActive(activeProvider, val)}
              placeholder="选择模型（可选）"
              style={{ width: 200 }}
              allowClear
              options={activeModels.map((m) => ({ label: m, value: m }))}
            />
          )}
          {activeProvider && (
            <Tag color="green" style={{ fontSize: 13, padding: '2px 12px' }}>
              {activeProvider}{activeModel ? ` / ${activeModel}` : ''}
            </Tag>
          )}
        </div>
      </Card>

      {error && <Alert type="error" message="加载提供商失败" description={error} showIcon closable onClose={() => setError(null)} style={{ marginBottom: 16 }} />}
      <Table<ProviderRow> columns={columns} dataSource={providers} rowKey="key" loading={loading} pagination={{ pageSize: 10 }} />
      <Modal title={editTarget ? `编辑: ${editTarget.key}` : '编辑提供商'} open={editVisible} onCancel={() => { setEditVisible(false); setEditTarget(null); form.resetFields(); }} footer={<Space><Button onClick={() => setEditVisible(false)}>取消</Button><Button type="primary" icon={<EditOutlined />} onClick={handleSave} loading={saving}>保存</Button></Space>} width={600} destroyOnClose>
        {editTarget && (
          <Form form={form} layout="vertical" initialValues={{ name: editTarget.name, npm: editTarget.npm, apiKey: editTarget.options?.apiKey ?? '', baseURL: editTarget.options?.baseURL ?? '' }}>
            <Form.Item label="显示名称" name="name" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item label="NPM 包" name="npm" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item label="API 密钥" name="apiKey"><Input.Password /></Form.Item>
            <Form.Item label="基础 URL" name="baseURL"><Input /></Form.Item>
          </Form>
        )}
      </Modal>
      <Modal title="添加提供商" open={addVisible} onCancel={() => { setAddVisible(false); addForm.resetFields(); }} footer={<Space><Button onClick={() => setAddVisible(false)}>取消</Button><Button type="primary" icon={<PlusOutlined />} onClick={handleAddSave} loading={addSaving}>创建</Button></Space>} width={600} destroyOnClose>
        <Form form={addForm} layout="vertical">
          <Form.Item label="标识（identifier）" name="key" rules={[{ required: true }]}><Input placeholder="例如 openai, mimo" /></Form.Item>
          <Form.Item label="显示名称" name="name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="NPM 包" name="npm" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="API 密钥" name="apiKey"><Input.Password /></Form.Item>
          <Form.Item label="基础 URL" name="baseURL"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
