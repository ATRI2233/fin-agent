import { useEffect, useState } from 'react';
import { Typography, Table, Button, Tag, Space, Modal, Form, Input, Select, Card, Alert, Spin, message, Popconfirm } from 'antd';
import { ReloadOutlined, EditOutlined, DeleteOutlined, PlusOutlined, SaveOutlined, SafetyOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useOpencodePermissions, useUpdateOpencodePermissions } from '../hooks/useOpencode';

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
  const [permissions, setPermissions] = useState<PermissionsConfig>({ rules: [], defaultAction: 'allow' });
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // KNOWN LIMITATION: `hydrated` flag prevents re-population from server data
  // after local edits, protecting against overwrites. This means server-side
  // updates (e.g. from another tab or a config reload) will NOT be reflected
  // until the page is hard-refreshed. A future improvement should diff or
  // prompt the user to merge.

  const [editVisible, setEditVisible] = useState(false);
  const [editIndex, setEditIndex] = useState<number>(-1);
  const [form] = Form.useForm();
  const [defaultAction, setDefaultAction] = useState<'allow' | 'deny'>('allow');

  const { data, isLoading, error: queryError, refetch } = useOpencodePermissions();
  const updatePerms = useUpdateOpencodePermissions();

  useEffect(() => {
    if (data && !hydrated) {
      setPermissions({ rules: data.rules as PermissionRule[], defaultAction: data.defaultAction as 'allow' | 'deny' });
      setDefaultAction(data.defaultAction as 'allow' | 'deny');
      setHydrated(true);
    }
  }, [data, hydrated]);

  const handleSaveAll = () => {
    setSaving(true);
    updatePerms.mutate(
      { rules: permissions.rules as unknown[], defaultAction },
      {
        onSuccess: () => {
          message.success('权限已保存');
          setSaving(false);
        },
        onError: (err: unknown) => {
          message.error(err instanceof Error ? err.message : '保存失败');
          setSaving(false);
        },
      }
    );
  };

  const handleAdd = () => {
    setEditIndex(-1);
    form.resetFields();
    form.setFieldsValue({ tool: '', action: 'allow', agents: '', description: '' });
    setEditVisible(true);
  };

  const handleEdit = (i: number) => {
    const r = permissions.rules[i];
    setEditIndex(i);
    form.setFieldsValue({ tool: r.tool, action: r.action, agents: r.agents?.join(', ') ?? '', description: r.description ?? '' });
    setEditVisible(true);
  };

  const handleDelete = (i: number) => {
    const nr = [...permissions.rules]; nr.splice(i, 1);
    setPermissions({ ...permissions, rules: nr });
  };

  const handleModalSave = async () => {
    try {
      const v = await form.validateFields();
      const rule: PermissionRule = { tool: v.tool, action: v.action, agents: v.agents ? v.agents.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined, description: v.description || undefined };
      const nr = [...permissions.rules];
      if (editIndex >= 0) nr[editIndex] = rule; else nr.push(rule);
      setPermissions({ ...permissions, rules: nr });
      setEditVisible(false);
      form.resetFields();
    } catch {}
  };

  const columns: ColumnsType<PermissionRule> = [
    { title: '工具', dataIndex: 'tool', key: 'tool', sorter: (a, b) => a.tool.localeCompare(b.tool), render: (t: string) => <Space><SafetyOutlined style={{ color: '#8B9DC3' }} /><Text strong>{t}</Text></Space> },
    { title: '动作', dataIndex: 'action', key: 'action', width: 120, filters: [{ text: '允许', value: 'allow' }, { text: '拒绝', value: 'deny' }], onFilter: (v, r) => r.action === v, render: (a: string) => <Tag color={a === 'allow' ? 'green' : 'red'}>{a === 'allow' ? '允许' : '拒绝'}</Tag> },
    { title: '代理', dataIndex: 'agents', key: 'agents', render: (a?: string[]) => <Space wrap size={[0, 4]}>{a && a.length > 0 ? a.map((x) => <Tag key={x} color="blue">{x}</Tag>) : <Text type="secondary">全部代理</Text>}</Space> },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true, render: (d?: string) => <Text type="secondary">{d || '-'}</Text> },
    { title: '操作', key: 'actions', width: 150, render: (_, _r, i) => (
      <Space>
        <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(i)}>编辑</Button>
        <Popconfirm title="删除此规则？" onConfirm={() => handleDelete(i)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm>
      </Space>
    )},
  ];

  if (isLoading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>权限</Title>
          <Text type="secondary">管理代理的工具访问权限</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isLoading}>刷新</Button>
          <Button icon={<PlusOutlined />} type="primary" onClick={handleAdd}>添加规则</Button>
          <Button icon={<SaveOutlined />} type="primary" onClick={handleSaveAll} loading={saving || updatePerms.isPending}>全部保存</Button>
        </Space>
      </div>
      {queryError && <Alert type="error" message="加载权限失败" description={queryError instanceof Error ? queryError.message : 'Failed to load'} showIcon closable style={{ marginBottom: 16 }} />}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Text strong>默认动作：</Text>
          <Select value={defaultAction} onChange={setDefaultAction} style={{ width: 150 }} options={[{ label: '允许', value: 'allow' }, { label: '拒绝', value: 'deny' }]} />
          <Text type="secondary">{defaultAction === 'allow' ? '默认允许所有工具，除非明确拒绝' : '默认拒绝所有工具，除非明确允许'}</Text>
        </div>
      </Card>
      <Table<PermissionRule> columns={columns} dataSource={permissions.rules} rowKey={(_, i) => String(i)} pagination={{ pageSize: 10 }} />
      <Modal title={editIndex >= 0 ? '编辑权限规则' : '添加权限规则'} open={editVisible} onCancel={() => { setEditVisible(false); form.resetFields(); }} footer={<Space><Button onClick={() => setEditVisible(false)}>取消</Button><Button type="primary" icon={<SaveOutlined />} onClick={handleModalSave}>保存</Button></Space>} width={500} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item label="工具名称" name="tool" rules={[{ required: true }]}><Input placeholder="例如 bash, read, write" /></Form.Item>
          <Form.Item label="动作" name="action" rules={[{ required: true }]}><Select options={[{ label: '允许', value: 'allow' }, { label: '拒绝', value: 'deny' }]} /></Form.Item>
          <Form.Item label="代理" name="agents"><Input placeholder="逗号分隔的代理名称（空 = 所有代理）" /></Form.Item>
          <Form.Item label="描述" name="description"><Input.TextArea rows={2} placeholder="规则描述（可选）" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}