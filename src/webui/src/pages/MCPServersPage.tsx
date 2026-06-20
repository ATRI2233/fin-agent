import { useEffect, useState } from 'react';
import {
  Typography, Table, Button, Tag, Space, Modal, Switch, Form, Input, Select,
  Alert, Segmented, Popconfirm, message, Card,
} from 'antd';
import { ReloadOutlined, EditOutlined, DeleteOutlined, SwapOutlined, GlobalOutlined, FolderOutlined, CloudServerOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  useOpencodeConfigScope,
  useOpencodeMcpServers,
  useSetOpencodeConfigScope,
  useToggleOpencodeMcpServer,
  useMoveOpencodeMcpServer,
  useUpsertOpencodeMcpServer,
  useDeleteOpencodeMcpServer,
} from '../hooks/useOpencode';

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
  const [scope, setScope] = useState<Scope>('global');

  const [editVisible, setEditVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<McpServerRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const scopeQuery = useOpencodeConfigScope();
  const mcpServers = useOpencodeMcpServers<McpServerConfig>(scope);
  const setScopeMutation = useSetOpencodeConfigScope();
  const toggleMutation = useToggleOpencodeMcpServer();
  const moveMutation = useMoveOpencodeMcpServer();
  const upsertMutation = useUpsertOpencodeMcpServer();
  const deleteMutation = useDeleteOpencodeMcpServer();

  useEffect(() => {
    if (scopeQuery.data?.mcp && scope === 'global') {
      setScope(scopeQuery.data.mcp as Scope);
    }
  }, [scopeQuery.data?.mcp, scope]);

  const servers: McpServerRow[] = mcpServers.data
    ? Object.entries(mcpServers.data).map(([name, cfg]) => ({ ...cfg, name }))
    : [];
  const loading = mcpServers.isLoading;
  const error = mcpServers.error?.message ?? null;

  const handleScopeChange = (s: Scope) => {
    setScope(s);
    setScopeMutation.mutate(
      { mcp: s },
      { onError: () => message.error('作用域切换失败') },
    );
  };

  const handleToggle = (name: string) => {
    toggleMutation.mutate(
      { name, scope },
      {
        onSuccess: (data) => {
          message.success(`${name} ${data.enabled ? '已启用' : '已禁用'}`);
        },
        onError: (err: unknown) => {
          message.error(err instanceof Error ? err.message : '操作失败');
        },
      },
    );
  };

  const handleDelete = (name: string) => {
    deleteMutation.mutate(
      { name, scope },
      {
        onSuccess: () => {
          message.success(`${name} 已删除`);
        },
        onError: (err: unknown) => {
          message.error(err instanceof Error ? err.message : '操作失败');
        },
      },
    );
  };

  const handleMove = (name: string) => {
    moveMutation.mutate(
      { name, from: scope },
      {
        onSuccess: (data) => {
          message.success(`已移至 ${data.to}`);
        },
        onError: (err: unknown) => {
          message.error(err instanceof Error ? err.message : '操作失败');
        },
      },
    );
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
      upsertMutation.mutate(
        { name: editTarget.name, scope, body: payload as unknown as Record<string, unknown> },
        {
          onSuccess: () => {
            message.success(`${editTarget.name} 已更新`);
            setEditVisible(false);
            setEditTarget(null);
            form.resetFields();
          },
          onError: (err: unknown) => {
            if (err && typeof err === 'object' && 'errorFields' in err) return;
            message.error(err instanceof Error ? err.message : '保存失败');
          },
        },
      );
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
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
          <Button icon={<ReloadOutlined />} onClick={() => mcpServers.refetch()} loading={loading} size="large">刷新</Button>
        </Space>
      </div>
      {error && <Alert type="error" message="加载 MCP 服务器失败" description={error} showIcon closable onClose={() => {}} style={{ marginBottom: 24 }} />}
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