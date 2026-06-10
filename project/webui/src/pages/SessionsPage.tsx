import { useEffect, useState, useCallback, useRef } from 'react';
import { Typography, Row, Col, Card, Table, Tag, Space, Button, Spin, Alert, Tooltip } from 'antd';
import {
  CloudServerOutlined,
  ReloadOutlined,
  RocketOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  PauseCircleOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Text } = Typography;

// ── Types ───────────────────────────────────────────────────────────
interface SessionInfo {
  sessionId: string;
  status: string;
  agent: string;
  startedAt?: string;
  updatedAt?: string;
}

interface ConcurrencyStatus {
  current: number;
  max: number;
}

interface OpenCodeStatus {
  online: boolean;
  binary: string;
}

interface SystemStatus {
  opencode: OpenCodeStatus;
  sessions: { active: SessionInfo[]; count: number };
  concurrency: ConcurrencyStatus;
  jobExecutor: { running: boolean };
  timestamp?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────
const sessionStatusColors: Record<string, string> = {
  active: 'green',
  inactive: 'default',
};

function timeAgo(ts?: string): string {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  return `${days} 天前`;
}

function formatTime(ts?: string): string {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return ts;
  }
}

// ── Component ───────────────────────────────────────────────────────
export default function SessionsPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/system/status', { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
    } finally {
      setLoading(false);
      setLastUpdated(new Date());
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    pollingRef.current = setInterval(fetchStatus, 5000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [fetchStatus]);

  // ── Loading ─────────────────────────────────────────────────────
  if (loading && !status) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: 'var(--text-tertiary)', fontSize: 14 }}>正在加载状态…</div>
        </div>
      </div>
    );
  }

  const ocOnline = status?.opencode?.online ?? false;
  const sessions: SessionInfo[] = Array.isArray(status?.sessions?.active) ? status.sessions.active : [];
  const concurrency = status?.concurrency ?? { current: 0, max: 0 };
  const activeCount = sessions.filter((s) => s.status === 'active').length;

  // ── Session table columns ───────────────────────────────────────
  const sessionColumns: ColumnsType<SessionInfo> = [
    {
      title: '会话 ID',
      dataIndex: 'sessionId',
      key: 'sessionId',
      ellipsis: true,
      render: (id: string) => (
        <Tooltip title="点击复制">
          <Text
            copyable={{ text: id }}
            style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}
          >
            {id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: 'Agent',
      dataIndex: 'agent',
      key: 'agent',
      width: 140,
      render: (agent: string) => <Text style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{agent || '—'}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      filters: [
        { text: '活跃', value: 'active' },
        { text: '非活跃', value: 'inactive' },
      ],
      onFilter: (value, record) => record.status === value,
      render: (s: string) => (
        <Tag color={sessionStatusColors[s] ?? 'default'}>{s === 'active' ? '活跃' : s === 'inactive' ? '非活跃' : s}</Tag>
      ),
    },
    {
      title: '启动时间',
      dataIndex: 'startedAt',
      key: 'startedAt',
      width: 160,
      sorter: (a, b) => new Date(a.startedAt ?? 0).getTime() - new Date(b.startedAt ?? 0).getTime(),
      render: (ts?: string) => <Text type="secondary" style={{ fontSize: 13 }}>{formatTime(ts)}</Text>,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 140,
      render: (ts?: string) => <Text type="secondary" style={{ fontSize: 13 }}>{timeAgo(ts)}</Text>,
    },
  ];

  // ── Main ────────────────────────────────────────────────────────
  return (
    <div className="page-container fade-in">
      {/* ── Hero Header ─────────────────────────────────────────── */}
      <div style={{ marginBottom: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="page-hero" style={{ marginBottom: 0 }}>
          <h1 className="page-hero-title">Sessions</h1>
          <p className="page-hero-subtitle">代理会话监控</p>
        </div>
        <Space size={12}>
          {lastUpdated && <Text type="secondary" style={{ fontSize: 12 }}>更新于 {lastUpdated.toLocaleTimeString()}</Text>}
          <Button icon={<ReloadOutlined />} onClick={fetchStatus} loading={loading}>刷新</Button>
        </Space>
      </div>

      {/* ── Error ───────────────────────────────────────────────── */}
      {error && (
        <Alert type="warning" message="部分数据加载失败" description={error} style={{ marginBottom: 24 }} showIcon closable onClose={() => setError(null)} />
      )}

      {/* ── Stat Cards ──────────────────────────────────────────── */}
      <Row gutter={[20, 20]} style={{ marginBottom: 28 }}>
        <Col xs={12} sm={8}>
          <div className="stat-card fade-in fade-in-1">
            <div className="stat-card-icon" style={{ color: ocOnline ? '#5A9E7B' : '#D47070' }}>
              <CloudServerOutlined />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-1)' }}>
              <span className={`status-dot ${ocOnline ? 'active' : 'offline'}`} />
              <span className="stat-card-number" style={{ fontSize: 32 }}>{ocOnline ? '在线' : '离线'}</span>
            </div>
            <div className="stat-card-label">OpenCode</div>
          </div>
        </Col>

        <Col xs={12} sm={8}>
          <div className="stat-card fade-in fade-in-1">
            <div className="stat-card-icon" style={{ color: '#6B8EC4' }}>
              <SyncOutlined />
            </div>
            <div className="stat-card-number">{sessions.length}</div>
            <div className="stat-card-label">
              会话{activeCount > 0 && <span style={{ color: '#5A9E7B', marginLeft: 6 }}>{activeCount} 活跃</span>}
            </div>
          </div>
        </Col>

        <Col xs={12} sm={8}>
          <div className="stat-card fade-in fade-in-2">
            <div className="stat-card-icon" style={{ color: '#D4A85A' }}>
              <RocketOutlined />
            </div>
            <div className="stat-card-number">{concurrency.current}<span style={{ fontSize: 20, color: 'var(--text-tertiary)' }}>/{concurrency.max}</span></div>
            <div className="stat-card-label">并发</div>
          </div>
        </Col>
      </Row>

      {/* ── Sessions Table ──────────────────────────────────────── */}
      <Card
        className="card-spacious fade-in fade-in-3"
        style={{ marginBottom: 28 }}
        title={
          <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>
            <SyncOutlined spin={activeCount > 0} style={{ marginRight: 10, color: 'var(--accent)', opacity: 0.65 }} />
            会话列表
            <Tag style={{ marginLeft: 10 }} color="blue">{sessions.length}</Tag>
          </span>
        }
      >
        <Table<SessionInfo>
          columns={sessionColumns}
          dataSource={sessions}
          rowKey="sessionId"
          pagination={sessions.length > 10 ? { pageSize: 10 } : false}
          size="middle"
          locale={{ emptyText: '暂无会话' }}
        />
      </Card>
    </div>
  );
}
