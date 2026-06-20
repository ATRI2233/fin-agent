import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Typography, Row, Col, Card, Table, Tag, Space, Button, Spin, Alert,
  Tooltip, Popconfirm, message, Modal,
} from 'antd';
import {
  CloudServerOutlined,
  ReloadOutlined,
  RocketOutlined,
  SyncOutlined,
  DeleteOutlined,
  SearchOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { SESSION_STATUS_CONFIG } from '../utils/statusConfig';
import type { ColumnsType } from 'antd/es/table';
import { formatTime, timeAgo, nowBeijing } from '../utils/time';

const { Text } = Typography;

// ── Types ───────────────────────────────────────────────────────────
// SessionInfo from the API (snake_case)
interface SessionRow {
  session_id: string;
  source: string;
  execution_id: string | null;
  node_id: string | null;
  agent: string | null;
  status: string;
  created_at: string | null;
}

interface SystemStatus {
  opencode: { online: boolean; binary: string };
  concurrency: { current: number; max: number };
  jobExecutor: { running: boolean };
}

// ── Component ───────────────────────────────────────────────────────
export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // System status (OpenCode + concurrency stat cards)
  const [sysStatus, setSysStatus] = useState<SystemStatus | null>(null);
  const [sysLoading, setSysLoading] = useState(true);

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);

  // Detail modal
  const [detailModal, setDetailModal] = useState<{ open: boolean; session: SessionRow | null }>({
    open: false,
    session: null,
  });
  const [detailLoading, setDetailLoading] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const data: SessionListResponse = await listSessions();
      setSessions(data.sessions);
      setTotal(data.total);
      setActiveCount(data.active_count);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : '获取会话列表失败');
    } finally {
      setLoading(false);
      setLastUpdated(new Date());
    }
  }, []);

  const fetchSystemStatus = useCallback(async () => {
    try {
      const data = await getSystemStatus();
      setSysStatus(data as unknown as SystemStatus);
    } catch {
      // non-critical — stat cards just go stale
    } finally {
      setSysLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchSessions(), fetchSystemStatus()]);
  }, [fetchSessions, fetchSystemStatus]);

  useEffect(() => {
    refresh();
    pollingRef.current = setInterval(fetchSystemStatus, 5000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [refresh, fetchSystemStatus]);

  // ── Row actions ─────────────────────────────────────────────────────
  const handleDelete = async (sessionId: string) => {
    setDeletingId(sessionId);
    try {
      await deleteSession(sessionId);
      message.success('会话已删除');
      await fetchSessions();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  const handleCleanupAll = async () => {
    setCleaning(true);
    try {
      const result = await cleanupSessions({ all_expired: true });
      message.success(`已清理 ${result.cleaned} 个会话，失败 ${result.failed} 个`);
      await fetchSessions();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '批量清理失败');
    } finally {
      setCleaning(false);
    }
  };

  const openDetail = async (sessionId: string) => {
    setDetailModal({ open: true, session: null });
    setDetailLoading(true);
    try {
      const session = await getSession(sessionId);
      setDetailModal({ open: true, session: session as unknown as SessionRow });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '获取详情失败');
      setDetailModal({ open: false, session: null });
    } finally {
      setDetailLoading(false);
    }
  };

  // ── Table columns ──────────────────────────────────────────────────
  const sessionColumns: ColumnsType<SessionRow> = [
    {
      title: '会话 ID',
      dataIndex: 'session_id',
      key: 'session_id',
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
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 100,
      render: (v: string) => (
        <Tag color={v === 'workflow' ? 'blue' : 'green'}>{v === 'workflow' ? '工作流' : '对话'}</Tag>
      ),
    },
    {
      title: 'Agent',
      dataIndex: 'agent',
      key: 'agent',
      width: 140,
      render: (v: string | null) => <Text style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{v || '—'}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      filters: [
        { text: '活跃', value: 'active' },
        { text: '非活跃', value: 'inactive' },
        { text: '已清理', value: 'cleaned_up' },
        { text: '未知', value: 'unknown' },
      ],
      onFilter: (value, record) => record.status === value,
      render: (s: string) => {
        const cfg = SESSION_STATUS_CONFIG[s as keyof typeof SESSION_STATUS_CONFIG];
        return (
          <Tag color={cfg?.color ?? 'default'}>
            {cfg?.label ?? s}
          </Tag>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 160,
      sorter: (a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime(),
      render: (ts: string | null) => (
        <Text type="secondary" style={{ fontSize: 13 }}>{formatTime(ts)}</Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<SearchOutlined />}
            onClick={() => openDetail(record.session_id)}
          >
            详情
          </Button>
          <Popconfirm
            title="确认删除此会话？"
            icon={<ExclamationCircleOutlined />}
            onConfirm={() => handleDelete(record.session_id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true, loading: deletingId === record.session_id }}
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deletingId === record.session_id}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const ocOnline = sysStatus?.opencode?.online ?? false;
  const concurrency = sysStatus?.concurrency ?? { current: 0, max: 0 };

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="page-container fade-in">
      {/* ── Hero Header ─────────────────────────────────────────── */}
      <div style={{ marginBottom: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="page-hero" style={{ marginBottom: 0 }}>
          <h1 className="page-hero-title">Sessions</h1>
          <p className="page-hero-subtitle">代理会话监控</p>
        </div>
        <Space size={12}>
          {lastUpdated && <Text type="secondary" style={{ fontSize: 12 }}>更新于 {nowBeijing()}</Text>}
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>刷新</Button>
        </Space>
      </div>

      {/* ── Error ───────────────────────────────────────────────── */}
      {fetchError && (
        <Alert
          type="warning"
          message="部分数据加载失败"
          description={fetchError}
          style={{ marginBottom: 24 }}
          showIcon
          closable
          onClose={() => setFetchError(null)}
        />
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
              <span className="stat-card-number" style={{ fontSize: 32 }}>
                {sysLoading ? '-' : ocOnline ? '在线' : '离线'}
              </span>
            </div>
            <div className="stat-card-label">OpenCode</div>
          </div>
        </Col>

        <Col xs={12} sm={8}>
          <div className="stat-card fade-in fade-in-1">
            <div className="stat-card-icon" style={{ color: '#6B8EC4' }}>
              <SyncOutlined />
            </div>
            <div className="stat-card-number">
              {loading ? <Spin size="small" /> : total}
            </div>
            <div className="stat-card-label">
              会话
              {activeCount > 0 && (
                <span style={{ color: '#5A9E7B', marginLeft: 6 }}>
                  {activeCount} 活跃
                </span>
              )}
            </div>
          </div>
        </Col>

        <Col xs={12} sm={8}>
          <div className="stat-card fade-in fade-in-2">
            <div className="stat-card-icon" style={{ color: '#D4A85A' }}>
              <RocketOutlined />
            </div>
            <div className="stat-card-number">
              {concurrency.current}
              <span style={{ fontSize: 20, color: 'var(--text-tertiary)' }}>
                /{concurrency.max}
              </span>
            </div>
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
            <Tag style={{ marginLeft: 10 }} color="blue">{total}</Tag>
          </span>
        }
        extra={
          <Popconfirm
            title="清理所有过期会话？"
            description="此操作不可逆。"
            icon={<ExclamationCircleOutlined />}
            onConfirm={handleCleanupAll}
            okText="清理"
            cancelText="取消"
            okButtonProps={{ danger: true, loading: cleaning }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} loading={cleaning}>
              清理全部过期
            </Button>
          </Popconfirm>
        }
      >
        <Table<SessionRow>
          columns={sessionColumns}
          dataSource={sessions}
          rowKey="session_id"
          loading={loading}
          pagination={total > 10 ? { pageSize: 10 } : false}
          size="middle"
          locale={{ emptyText: '暂无会话' }}
        />
      </Card>

      {/* ── Detail Modal ─────────────────────────────────────────── */}
      <Modal
        title="会话详情"
        open={detailModal.open}
        onCancel={() => setDetailModal({ open: false, session: null })}
        footer={
          <Button onClick={() => setDetailModal({ open: false, session: null })}>
            关闭
          </Button>
        }
        destroyOnClose
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <Spin />
          </div>
        ) : detailModal.session ? (
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px' }}>
            <dt style={{ color: 'var(--text-tertiary)' }}>会话 ID</dt>
            <dd>
              <Text copyable={{ text: detailModal.session.session_id }} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
                {detailModal.session.session_id}
              </Text>
            </dd>
            <dt style={{ color: 'var(--text-tertiary)' }}>来源</dt>
            <dd>{detailModal.session.source === 'workflow' ? '工作流' : '对话'}</dd>
            <dt style={{ color: 'var(--text-tertiary)' }}>Execution ID</dt>
            <dd>{detailModal.session.execution_id ?? '—'}</dd>
            <dt style={{ color: 'var(--text-tertiary)' }}>Node ID</dt>
            <dd>{detailModal.session.node_id ?? '—'}</dd>
            <dt style={{ color: 'var(--text-tertiary)' }}>Agent</dt>
            <dd>{detailModal.session.agent ?? '—'}</dd>
            <dt style={{ color: 'var(--text-tertiary)' }}>状态</dt>
            <dd>
              <Tag color={SESSION_STATUS_CONFIG[detailModal.session.status as keyof typeof SESSION_STATUS_CONFIG]?.color ?? 'default'}>
                {SESSION_STATUS_CONFIG[detailModal.session.status as keyof typeof SESSION_STATUS_CONFIG]?.label ?? detailModal.session.status}
              </Tag>
            </dd>
            <dt style={{ color: 'var(--text-tertiary)' }}>创建时间</dt>
            <dd>{formatTime(detailModal.session.created_at)}</dd>
          </dl>
        ) : null}
      </Modal>
    </div>
  );
}
