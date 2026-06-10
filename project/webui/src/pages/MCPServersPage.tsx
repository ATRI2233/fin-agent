import { useEffect, useState, useCallback } from 'react';
import {
  Typography, Table, Button, Tag, Space, Modal, Switch, Form, Input, Select,
  Alert, Segmented, Popconfirm, message, Card,
} from 'antd';
import { ReloadOutlined, EditOutlined, DeleteOutlined, SwapOutlined, GlobalOutlined, FolderOutlined, CloudServerOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Text } = Typography;

type Scope = 'global' | 'project';

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
  const [scope, setScope] = useState<Scope>('global');

  const [editVisible, setEditVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<McpServerRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    fetch('/api/config/scope').then((r) => r.json()).then((d) => { if (d.mcp) setScope(d.mcp); }).catch(() => {});
  }, []);

  const fetchServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/mcp?scope=${scope}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Record<string, McpServerConfig> = await res.json();
      setServers(Object.entries(data).map(([name, cfg]) => ({ ...cfg, name })));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载失败');
      setServers([]);
    } finally { setLoading(false); }
  }, [scope]);

  useEffect(() => { fetchServers(); }, [fetchServers]);

  const handleScopeChange = async (s: Scope) => {
    setScope(s);
    try { await fetch('/api/config/scope', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mcp: s }) }); } catch {}
  };

  const handleToggle = async (name: string) => {
    try {
      const res = await fetch(`/api/mcp/${name}/toggle?scope=${scope}`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setServers((p) => p.map((s) => (s.name === name ? { ...s, enabled: data.enabled } : s)));
      message.success(`${name} ${data.enabled ? '已启用' : '已禁用'}`);
    } catch (err: unknown) { message.error(err instanceof Error ? err.message : '操作失败'); }
  };

  const handleDelete = async (name: string) => {
    try {
      const res = await fetch(`/api/mcp/${name}?scope=${scope}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      message.success(`${name} 已删除`);
      fetchServers();
    } catch (err: unknown) { message.error(err instanceof Error ? err.message : '操作失败'); }
  };

  const handleMove = async (name: string) => {
    try {
      const res = await fetch(`/api/mcp/${name}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: scope }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      message.success(`已移至 ${data.to}`);
      fetchServers();
    } catch (err: unknown) { message.error(err instanceof Error ? err.message : '操作失败'); }
  };

  const handleEdit = (record: McpServerRow) => {
    setEditTarget(record);
    form.setFieldsValue({ type: record.type, command: Array.isArray(record.command) ? record.command.join(' ') : record.command, args: record.args?.join(' ') ?? '', description: record.description ?? '' });
    setEditVisible(true);
  };

  const handleSave = async () => {
    if (!editTarget) return;
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload: McpServerConfig = { type: values.type, command: values.command, args: values.args ? values.args.split(/\s+/) : [], enabled: editTarget.enabled, description: values.description || undefined };
      const res = await fetch(`/api/mcp/${editTarget.name}?scope=${scope}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      message.success(`${editTarget.name} 已更新`);
      setEditVisible(false);
      setEditTarget(null);
      form.resetFields();
      fetchServers();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally { setSaving(false); }
  };

  const columns: ColumnsType<McpServerRow> = [
    { title: '名称', dataIndex: 'name', key: 'name', sorter: (a, b) => a.name.localeCompare(b.name), render: (n: string) => <Text strong style={{ fontSize: 15 }}>{n}</Text> },
    { title: '类型', dataIndex: 'type', key: 'type', width: 120, render: (t: string) => <Tag color={t === 'sse' ? 'purple' : 'blue'}>{t}</Tag>, filters: [{ text: 'stdio', value: 'stdio' }, { text: 'sse', value: 'sse' }], onFilter: (v, r) => r.type === v },
    { title: '命令', dataIndex: 'command', key: 'command', ellipsis: true, render: (c: string | string[]) => <Text code style={{ fontSize: 13 }}>{Array.isArray(c) ? c.join(' ') : c}</Text> },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true, render: (d?: string) => <Text type="secondary" style={{ fontSize: 14 }}>{d || '-'}</Text> },
    { title: '启用', dataIndex: 'enabled', key: 'enabled', width: 100, filters: [{ text: '启用', value: 'true' }, { text: '禁用', value: 'false' }], onFilter: (v, r) => String(r.enabled) === v, render: (_: boolean, r: McpServerRow) => <Switch checked={r.enabled} onChange={() => handleToggle(r.name)} size="small" /> },
    { title: '操作', key: 'actions', width: 220, render: (_, r) => (
      <Space>
        <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
        <Popconfirm title={`移至${scope === 'global' ? '项目' : '全局'}？`} onConfirm={() => handleMove(r.name)}><Button type="link" icon={<SwapOutlined />}>{scope === 'global' ? '移至项目' : '移至全局'}</Button></Popconfirm>
        <Popconfirm title={`删除 ${r.name}？`} onConfirm={() => handleDelete(r.name)}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm>
      </Space>
    )},
  ];

  return (
    <div className="page-container fade-in">
      {/* Hero Header */}
      <div style={{ marginBottom: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="page-hero" style={{ marginBottom: 0 }}>
          <h1 className="page-hero-title">MCP 服务器</h1>
          <p className="page-hero-subtitle">管理 MCP 服务器连接和配置</p>
        </div>
        <Space size={12}>
          <Segmented value={scope} onChange={(v) => handleScopeChange(v as Scope)} options={[
            { label: <Space><GlobalOutlined />全局</Space>, value: 'global' },
            { label: <Space><FolderOutlined />项目</Space>, value: 'project' },
          ]} />
          <Button icon={<ReloadOutlined />} onClick={fetchServers} loading={loading} size="large">刷新</Button>
        </Space>
      </div>
      {error && <Alert type="error" message="加载 MCP 服务器失败" description={error} showIcon closable onClose={() => setError(null)} style={{ marginBottom: 24 }} />}
      <Card className="card-spacious fade-in fade-in-2">
        <Table<McpServerRow> columns={columns} dataSource={servers} rowKey="name" loading={loading} pagination={{ pageSize: 10 }} size="middle" />
      </Card>
      <Modal title={editTarget ? `编辑: ${editTarget.name}` : '编辑 MCP 服务器'} open={editVisible} onCancel={() => { setEditVisible(false); setEditTarget(null); form.resetFields(); }} footer={<Space><Button onClick={() => setEditVisible(false)}>取消</Button><Button type="primary" icon={<EditOutlined />} onClick={handleSave} loading={saving}>保存</Button></Space>} width={600} destroyOnClose>
        {editTarget && (
          <Form form={form} layout="vertical" initialValues={{ type: editTarget.type, command: Array.isArray(editTarget.command) ? editTarget.command.join(' ') : editTarget.command, args: editTarget.args?.join(' ') ?? '', description: editTarget.description ?? '' }}>
            <Form.Item label="类型" name="type" rules={[{ required: true }]}><Select options={[{ label: 'stdio', value: 'stdio' }, { label: 'sse', value: 'sse' }]} /></Form.Item>
            <Form.Item label="命令" name="command" rules={[{ required: true }]}><Input placeholder="例如 npx @modelcontextprotocol/server-filesystem" /></Form.Item>
            <Form.Item label="参数" name="args"><Input placeholder="空格分隔的参数（可选）" /></Form.Item>
            <Form.Item label="描述" name="description"><Input.TextArea rows={2} placeholder="服务器描述（可选）" /></Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
}
