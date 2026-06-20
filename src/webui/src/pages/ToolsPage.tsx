import { Typography, Table, Tag, Space, Switch, Alert, Card, Button } from 'antd';
import { ReloadOutlined, ToolOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTools } from '../hooks/useMcp';
import type { ToolItem } from '../types/agent';

const { Text } = Typography;

interface ToolRow extends ToolItem {
  key: string;
}

export default function ToolsPage() {
  const { data, isLoading, error, refetch } = useTools();

  const tools: ToolRow[] = (data ?? []).map((t) => ({
    ...t,
    key: t.server ? `${t.server}_${t.name}` : t.name,
  }));

  const loading = isLoading;
  const errorMessage = error instanceof Error ? error.message : '加载工具失败';

  const sourceColorMap: Record<string, string> = { builtin: 'green', mcp: 'purple', custom: 'orange' };

  const columns: ColumnsType<ToolRow> = [
    { title: '名称', dataIndex: 'key', key: 'key', sorter: (a, b) => a.key.localeCompare(b.key), render: (k: string) => <Space><ToolOutlined style={{ color: '#6B8EC4' }} /><Text strong style={{ fontSize: 15 }}>{k}</Text></Space> },
    { title: '显示名称', dataIndex: 'name', key: 'name', render: (n: string) => <Text style={{ fontSize: 14 }}>{n}</Text> },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true, render: (d?: string) => <Text type="secondary" style={{ fontSize: 14 }}>{d || '-'}</Text> },
    { title: '来源', dataIndex: 'source', key: 'source', width: 120, filters: [{ text: 'builtin', value: 'builtin' }, { text: 'mcp', value: 'mcp' }, { text: 'custom', value: 'custom' }], onFilter: (v, r) => r.source === v, render: (s?: string) => <Tag color={sourceColorMap[s ?? ''] ?? 'default'}>{s ?? '-'}</Tag> },
    { title: 'MCP 服务器', dataIndex: 'server', key: 'server', ellipsis: true, render: (s?: string) => <Text code style={{ fontSize: 13 }}>{s || '-'}</Text> },
    { title: '分类', dataIndex: 'category', key: 'category', ellipsis: true, render: (c?: string) => <Text style={{ fontSize: 13 }}>{c || '-'}</Text> },
    { title: '启用', dataIndex: 'enabled', key: 'enabled', width: 100, filters: [{ text: '启用', value: 'true' }, { text: '禁用', value: 'false' }], onFilter: (v, r) => String(r.enabled) === v, render: (e?: boolean) => <Switch checked={e !== false} disabled size="small" /> },
  ];

  return (
    <div className="page-container fade-in">
      <div style={{ marginBottom: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="page-hero" style={{ marginBottom: 0 }}>
          <h1 className="page-hero-title">工具</h1>
          <p className="page-hero-subtitle">查看所有可用工具（builtin + MCP + custom）</p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading} size="large">刷新</Button>
      </div>
      {error && <Alert type="error" message="加载工具失败" description={errorMessage} showIcon closable style={{ marginBottom: 24 }} />}
      <Card className="card-spacious fade-in fade-in-2">
        <Table<ToolRow> columns={columns} dataSource={tools} rowKey="key" loading={loading} pagination={{ pageSize: 15 }} size="middle" />
      </Card>
    </div>
  );
}