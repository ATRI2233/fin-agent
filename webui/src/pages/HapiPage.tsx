import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Typography,
  Card,
  Spin,
  Button,
  Descriptions,
  Table,
  Tag,
  Badge,
  Collapse,
  Space,
  Alert,
  Tooltip,
} from 'antd';
import {
  CloudServerOutlined,
  ReloadOutlined,
  LinkOutlined,
  ExpandOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  PauseCircleOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Text } = Typography;

// ── Types ───────────────────────────────────────────────────────────
interface SessionInfo {
  sessionId: string;
  status: string;
  agent: string;
  startedAt?: string;
}

interface JobExecutorStatus {
  running: boolean;
  pendingJobs?: number;
  activeJobs?: number;
  completedJobs?: number;
}

interface ConcurrencyStatus {
  current: number;
  max: number;
}

interface HubStatus {
  online: boolean;
  uptime?: number;
  version?: string;
}

interface SystemStatus {
  hub: HubStatus;
  sessions: {
    active: SessionInfo[];
    count: number;
  };
  concurrency: ConcurrencyStatus;
  jobExecutor: JobExecutorStatus;
  timestamp?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────
const sessionStatusColors: Record<string, string> = {
  active: 'green',
  idle: 'blue',
  busy: 'gold',
  error: 'red',
  closed: 'default',
};

function formatUptime(seconds?: number): string {
  if (seconds == null) return '—';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

// ── Component ───────────────────────────────────────────────────────
export default function HapiPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [iframeExpanded, setIframeExpanded] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fallback: basic connectivity check via /hapi-api/
  const checkBasicStatus = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/hapi-api/', {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/system/status', {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SystemStatus = await res.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      // Fallback: try basic connectivity check
      const online = await checkBasicStatus();
      setStatus((prev) => {
        if (prev) return { ...prev, hub: { ...prev.hub, online } };
        return {
          hub: { online },
          sessions: { active: [], count: 0 },
          concurrency: { current: 0, max: 0 },
          jobExecutor: { running: false },
        };
      });
      if (!status) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch status';
        setError(msg);
      }
    } finally {
      setLoading(false);
      setLastUpdated(new Date());
    }
  }, [checkBasicStatus, status]);

  useEffect(() => {
    fetchStatus();
    pollingRef.current = setInterval(fetchStatus, 5000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchStatus]);

  // ── Loading state ───────────────────────────────────────────────
  if (loading && !status) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#787878', fontSize: 14 }}>
            正在连接 HAPI Hub...
          </div>
        </div>
      </div>
    );
  }

  const hubOnline = status?.hub?.online ?? false;

  // ── Offline state ───────────────────────────────────────────────
  if (!hubOnline && !loading) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', paddingTop: 80 }} className="fade-in">
        <Card style={{ textAlign: 'center', padding: '48px 32px' }}>
          <CloudServerOutlined style={{ fontSize: 48, color: '#787878', marginBottom: 20 }} />
          <h3 style={{ color: '#F0F0F0', marginBottom: 10, fontWeight: 600, fontSize: 22 }}>
            HAPI Hub 离线
          </h3>
          <Text style={{ color: '#B0B0B0', display: 'block', marginBottom: 28, fontSize: 15 }}>
            HAPI Hub 服务未运行。请启动以访问代理运行时功能。
          </Text>
          {error && (
            <Alert
              type="warning"
              message={error}
              style={{ marginBottom: 20, textAlign: 'left' }}
              showIcon
            />
          )}
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 10,
            padding: '16px 20px',
            fontFamily: "'JetBrains Mono', 'SF Mono', 'Menlo', monospace",
            fontSize: 14,
            color: '#6B8EC4',
            textAlign: 'left',
            marginBottom: 28,
          }}>
            <div>cd agents/hapi-hub</div>
            <div>set CLI_API_TOKEN=your_token</div>
            <div>npx hapi hub</div>
          </div>
          <Space size={12}>
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={fetchStatus}
              loading={loading}
              size="large"
            >
              重试连接
            </Button>
            <Button
              icon={<LinkOutlined />}
              href="http://localhost:3006"
              target="_blank"
              size="large"
            >
              打开 HAPI Hub
            </Button>
          </Space>
        </Card>
      </div>
    );
  }

  // ── Session table columns ───────────────────────────────────────
  const sessionColumns: ColumnsType<SessionInfo> = [
    {
      title: '会话 ID',
      dataIndex: 'sessionId',
      key: 'sessionId',
      ellipsis: true,
      render: (id: string) => (
        <Text
          copyable={{ text: id }}
          style={{ fontFamily: "'JetBrains Mono', 'SF Mono', 'Menlo', monospace", fontSize: 13 }}
        >
          {id.length > 20 ? `${id.slice(0, 8)}...${id.slice(-6)}` : id}
        </Text>
      ),
    },
    {
      title: 'Agent',
      dataIndex: 'agent',
      key: 'agent',
      width: 180,
      render: (agent: string) => (
        <Text style={{ color: '#F0F0F0', fontWeight: 500, fontSize: 15 }}>{agent || '—'}</Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (s: string) => (
        <Tag color={sessionStatusColors[s] ?? 'default'}>{s}</Tag>
      ),
    },
    {
      title: '启动时间',
      dataIndex: 'startedAt',
      key: 'startedAt',
      width: 200,
      render: (ts?: string) => (
        <Text type="secondary" style={{ fontSize: 13 }}>{ts ?? '—'}</Text>
      ),
    },
  ];

  const activeSessions = status?.sessions?.active ?? [];
  const concurrency = status?.concurrency ?? { current: 0, max: 0 };
  const jobExecutor = status?.jobExecutor ?? { running: false };

  // ── Main view ───────────────────────────────────────────────────
  return (
    <div className="page-container fade-in">
      {/* Hero Header */}
      <div style={{ marginBottom: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="page-hero" style={{ marginBottom: 0 }}>
          <h1 className="page-hero-title">HAPI Hub</h1>
          <p className="page-hero-subtitle">代理运行时监控</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Connection badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 14px',
            background: hubOnline ? 'rgba(90,158,123,0.14)' : 'rgba(212,112,112,0.14)',
            borderRadius: 10,
          }}>
            <Badge status={hubOnline ? 'processing' : 'error'} />
            <span style={{ fontSize: 14, color: hubOnline ? '#5A9E7B' : '#D47070', fontWeight: 500 }}>
              {hubOnline ? '已连接' : '未连接'}
            </span>
          </div>
          {lastUpdated && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              更新于 {lastUpdated.toLocaleTimeString()}
            </Text>
          )}
          <Button icon={<ReloadOutlined />} onClick={fetchStatus} size="large" loading={loading}>
            刷新
          </Button>
          <Button icon={<LinkOutlined />} href="http://localhost:3006" target="_blank" size="large">
            在新窗口打开
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <Alert
          type="warning"
          message="部分数据 — 使用备用健康检查"
          description={error}
          style={{ marginBottom: 24 }}
          showIcon
          closable
          onClose={() => setError(null)}
        />
      )}

      {/* System Status Card — hero status bar */}
      <Card className="card-spacious fade-in fade-in-1" style={{ marginBottom: 32 }}>
        <div style={{ padding: '4px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <RocketOutlined style={{ color: '#6B8EC4', fontSize: 20 }} />
            <span style={{ fontWeight: 600, fontSize: 16, color: '#F0F0F0' }}>系统状态</span>
          </div>
          <Descriptions
            column={{ xs: 1, sm: 2, md: 3 }}
            size="default"
          >
            <Descriptions.Item label="Hub 状态">
              <Badge
                status={hubOnline ? 'success' : 'error'}
                text={<span style={{ fontSize: 15, fontWeight: 500 }}>{hubOnline ? '在线' : '离线'}</span>}
              />
            </Descriptions.Item>
            <Descriptions.Item label="运行时间">
              <Text style={{ fontSize: 15 }}>{formatUptime(status?.hub?.uptime)}</Text>
            </Descriptions.Item>
            {status?.hub?.version && (
              <Descriptions.Item label="版本">
                <Tag>{status.hub.version}</Tag>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="活跃会话">
              <Text strong style={{ fontSize: 15 }}>{status?.sessions?.count ?? 0}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="并发数">
              <Text style={{ fontSize: 15 }}>
                <Text strong>{concurrency.current}</Text>
                <Text type="secondary"> / {concurrency.max}</Text>
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="任务执行器">
              <Space size={6}>
                {jobExecutor.running ? (
                  <CheckCircleOutlined style={{ color: '#5A9E7B', fontSize: 16 }} />
                ) : (
                  <PauseCircleOutlined style={{ color: '#787878', fontSize: 16 }} />
                )}
                <Text style={{ color: jobExecutor.running ? '#5A9E7B' : '#787878', fontSize: 15, fontWeight: 500 }}>
                  {jobExecutor.running ? '运行中' : '已停止'}
                </Text>
              </Space>
            </Descriptions.Item>
            {jobExecutor.running && (
              <>
                <Descriptions.Item label="活跃任务">
                  <Text style={{ fontSize: 15 }}>{jobExecutor.activeJobs ?? 0}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="待处理任务">
                  <Text style={{ fontSize: 15 }}>{jobExecutor.pendingJobs ?? 0}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="已完成任务">
                  <Text type="secondary" style={{ fontSize: 15 }}>{jobExecutor.completedJobs ?? 0}</Text>
                </Descriptions.Item>
              </>
            )}
          </Descriptions>
        </div>
      </Card>

      {/* Active Sessions Table */}
      <Card
        className="card-spacious fade-in fade-in-2"
        style={{ marginBottom: 32 }}
        title={
          <span style={{ fontWeight: 600, fontSize: 16, color: '#F0F0F0' }}>
            <SyncOutlined spin={activeSessions.some((s) => s.status === 'active')} style={{ marginRight: 10, color: '#6B8EC4' }} />
            活跃会话
            <Tag style={{ marginLeft: 10 }} color="blue">{activeSessions.length}</Tag>
          </span>
        }
      >
        <Table<SessionInfo>
          columns={sessionColumns}
          dataSource={activeSessions}
          rowKey="sessionId"
          pagination={activeSessions.length > 10 ? { pageSize: 10 } : false}
          size="middle"
          locale={{ emptyText: '暂无活跃会话' }}
        />
      </Card>

      {/* Collapsible Iframe */}
      <Collapse
        ghost
        expandIconPosition="end"
        items={[
          {
            key: 'iframe',
            label: (
              <span style={{ fontWeight: 600, fontSize: 16, color: '#F0F0F0' }}>
                <ExpandOutlined style={{ marginRight: 10, color: '#6B8EC4' }} />
                HAPI Hub 仪表盘（内嵌）
              </span>
            ),
            children: (
              <Card bodyStyle={{ padding: 0 }} style={{ overflow: 'hidden' }}>
                <iframe
                  src="http://localhost:3006"
                  title="HAPI Hub"
                  style={{
                    width: '100%',
                    height: 600,
                    border: 'none',
                    borderRadius: '0 0 14px 14px',
                  }}
                />
              </Card>
            ),
          },
        ]}
        style={{ background: 'transparent' }}
      />
    </div>
  );
}
