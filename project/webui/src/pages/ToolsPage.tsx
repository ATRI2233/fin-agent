import { useEffect, useState, useCallback } from 'react';
import { Typography, Table, Button, Tag, Space, Modal, Form, Input, Select, Switch, Alert, Spin, message, Card } from 'antd';
import { ReloadOutlined, EditOutlined, ToolOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Text } = Typography;

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

  const [editVisible, setEditVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<ToolRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const fetchTools = useCallback(async () => {
    setLoading(true);
    setError(null);
    let allRows: ToolRow[] = [];
    try {
      const res = await fetch('/api/tools');
      if (res.ok) {
        const data: Record<string, ToolConfig> = await res.json();
        allRows = [...allRows, ...Object.entries(data).map(([k, c]) => ({ ...c, key: k }))];
      }
    } catch {}
    try {
      const mcpRes = await fetch('/api/mcp');
      if (mcpRes.ok) {
        const mcpData: Record<string, any> = await mcpRes.json();
        // 展开每个 MCP 服务器的 tools 列表
        for (const [serverName, serverConfig] of Object.entries(mcpData)) {
          const serverEnabled = serverConfig.enabled !== false;
          const mcpTools = serverConfig.tools || [];
          if (Array.isArray(mcpTools) && mcpTools.length > 0) {
            // 有 tools 字段：展开每个 tool
            for (const tool of mcpTools) {
              allRows.push({
                key: `${serverName}_${tool.name}`,
                name: tool.name,
                description: tool.description || '',
                enabled: serverEnabled,
                source: 'mcp' as const,
                mcpServer: serverName,
              });
            }
          } else {
            // 没有 tools 字段：显示 MCP 服务器本身
            allRows.push({
              key: `mcp:${serverName}`,
              name: serverName,
              description: serverConfig.description || `MCP server: ${serverName}`,
              enabled: serverEnabled,
              source: 'mcp' as const,
              mcpServer: serverName,
            });
          }
        }
      }
    } catch {}
    const builtin: ToolRow[] = [
      { key: 'read', name: 'Read', description: '从磁盘读取文件', enabled: true, source: 'builtin' },
      { key: 'edit', name: 'Edit', description: '编辑磁盘文件', enabled: true, source: 'builtin' },
      { key: 'bash', name: 'Bash', description: '执行 Shell 命令', enabled: true, source: 'builtin' },
      { key: 'grep', name: 'Grep', description: '搜索文件内容', enabled: true, source: 'builtin' },
      { key: 'glob', name: 'Glob', description: '按模式查找文件', enabled: true, source: 'builtin' },
      { key: 'websearch', name: 'Web Search', description: '搜索网页', enabled: true, source: 'builtin' },
      { key: 'webfetch', name: 'Web Fetch', description: '获取 URL', enabled: true, source: 'builtin' },
      { key: 'lsp_diagnostics', name: 'LSP Diagnostics', description: '获取 LSP 错误/警告', enabled: true, source: 'builtin' },
    ];
    setTools([...allRows, ...builtin]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTools(); }, [fetchTools]);

  const handleEdit = (r: ToolRow) => {
    setEditTarget(r);
    form.setFieldsValue({ name: r.name, description: r.description ?? '', enabled: r.enabled, source: r.source, mcpServer: r.mcpServer ?? '' });
    setEditVisible(true);
  };

  const handleSave = async () => {
    if (!editTarget) return;
    try {
      const v = await form.validateFields();
      setSaving(true);
      const res = await fetch(`/api/tools/${editTarget.key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: v.name, description: v.description || undefined, enabled: v.enabled, source: v.source, mcpServer: v.mcpServer || undefined }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      message.success(`${editTarget.key} 已更新`);
      setEditVisible(false);
      setEditTarget(null);
      form.resetFields();
      fetchTools();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally { setSaving(false); }
  };

  const sourceColorMap: Record<string, string> = { builtin: 'green', mcp: 'purple', custom: 'orange' };

  const columns: ColumnsType<ToolRow> = [
    { title: '名称', dataIndex: 'key', key: 'key', sorter: (a, b) => a.key.localeCompare(b.key), render: (k: string) => <Space><ToolOutlined style={{ color: '#6B8EC4' }} /><Text strong style={{ fontSize: 15 }}>{k}</Text></Space> },
    { title: '显示名称', dataIndex: 'name', key: 'name', render: (n: string) => <Text style={{ fontSize: 14 }}>{n}</Text> },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true, render: (d?: string) => <Text type="secondary" style={{ fontSize: 14 }}>{d || '-'}</Text> },
    { title: '来源', dataIndex: 'source', key: 'source', width: 120, filters: [{ text: 'builtin', value: 'builtin' }, { text: 'mcp', value: 'mcp' }, { text: 'custom', value: 'custom' }], onFilter: (v, r) => r.source === v, render: (s: string) => <Tag color={sourceColorMap[s] ?? 'default'}>{s}</Tag> },
    { title: 'MCP 服务器', dataIndex: 'mcpServer', key: 'mcpServer', ellipsis: true, render: (s?: string) => <Text code style={{ fontSize: 13 }}>{s || '-'}</Text> },
    { title: '启用', dataIndex: 'enabled', key: 'enabled', width: 100, filters: [{ text: '启用', value: 'true' }, { text: '禁用', value: 'false' }], onFilter: (v, r) => String(r.enabled) === v, render: (e: boolean) => <Switch checked={e} disabled size="small" /> },
    { title: '操作', key: 'actions', width: 100, render: (_, r) => <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button> },
  ];

  return (
    <div className="page-container fade-in">
      {/* Hero Header */}
      <div style={{ marginBottom: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="page-hero" style={{ marginBottom: 0 }}>
          <h1 className="page-hero-title">工具</h1>
          <p className="page-hero-subtitle">管理工具配置和权限</p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={fetchTools} loading={loading} size="large">刷新</Button>
      </div>
      {error && <Alert type="error" message="加载工具失败" description={error} showIcon closable onClose={() => setError(null)} style={{ marginBottom: 24 }} />}
      <Card className="card-spacious fade-in fade-in-2">
        <Table<ToolRow> columns={columns} dataSource={tools} rowKey="key" loading={loading} pagination={{ pageSize: 15 }} size="middle" />
      </Card>
      <Modal title={editTarget ? `编辑: ${editTarget.key}` : '编辑工具'} open={editVisible} onCancel={() => { setEditVisible(false); setEditTarget(null); form.resetFields(); }} footer={<Space><Button onClick={() => setEditVisible(false)}>取消</Button><Button type="primary" icon={<EditOutlined />} onClick={handleSave} loading={saving}>保存</Button></Space>} width={600} destroyOnClose>
        {editTarget && (
          <Form form={form} layout="vertical" initialValues={{ name: editTarget.name, description: editTarget.description ?? '', enabled: editTarget.enabled, source: editTarget.source, mcpServer: editTarget.mcpServer ?? '' }}>
            <Form.Item label="显示名称" name="name" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item label="描述" name="description"><Input.TextArea rows={2} /></Form.Item>
            <Form.Item label="来源" name="source" rules={[{ required: true }]}><Select options={[{ label: '内置', value: 'builtin' }, { label: 'MCP 服务器', value: 'mcp' }, { label: '自定义', value: 'custom' }]} /></Form.Item>
            <Form.Item label="MCP 服务器" name="mcpServer"><Input placeholder="MCP 服务器名称（如果来源是 MCP）" /></Form.Item>
            <Form.Item label="启用" name="enabled" valuePropName="checked"><Switch /></Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
}
