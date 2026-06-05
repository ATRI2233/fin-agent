import { useEffect, useState, useMemo, useCallback } from 'react';
import { Row, Col, Card, Spin } from 'antd';
import {
  RobotOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  DashboardOutlined,
  CloudServerOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  CloseCircleOutlined,
  PercentageOutlined,
  BarChartOutlined,
  DatabaseOutlined,
  FileTextOutlined,
} from '@ant-design/icons';

/* ═══════════════════════════════════════════════════════════════════
   CONSTANTS & API — only real endpoints
   ═══════════════════════════════════════════════════════════════════ */

const API_V1 = '/api/v1';

const STATUS_COLORS: Record<string, string> = {
  completed: '#5A9E7B',
  running: '#6B8EC4',
  pending: '#D4A85A',
  failed: '#D47070',
};

/* ═══════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════ */

interface HealthStatus {
  status: string;
  timestamp: string;
}

interface SystemStatus {
  jobExecutor: string;
  concurrency: number;
  scheduler: { pending: number; scheduled: number };
  sessions: number;
  timestamp: string;
}

interface WorkflowStats {
  running: number;
  completed: number;
  failed: number;
  successRate: string;
}

interface Job {
  id: string;
  agent: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  created_at: string;
  result: unknown | null;
}

interface AgentInfo {
  name: string;
  description: string;
  capabilities: string[];
  tools: string[];
  mode: string;
}

interface ToolInfo {
  name: string;
  description: string;
  server: string;
}

interface SkillInfo {
  name: string;
  description: string;
  agents: string[];
}

interface ServerGroup {
  name: string;
  tools: ToolInfo[];
}

interface JobStats {
  total: number;
  by_status: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
  };
  by_agent: Record<string, number>;
  success_rate: string | null;
}

interface AgentStatItem {
  name: string;
  description: string;
  mode: string;
  jobs_total: number;
  jobs_completed: number;
  jobs_failed: number;
  success_rate: string | null;
}

interface LogStats {
  active_jobs_with_logs: number;
  total_log_entries: number;
  top_jobs: Record<string, number>;
}

interface CacheStats {
  workflow_cache: {
    size: number;
    max_size: number;
    usage_pct: number;
  };
  concurrency: {
    active: number;
    max: number;
    available: number;
    usage_pct: number;
  };
}

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════ */

const timeAgo = (dateStr: string) => {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max) + '...' : s);

/* ═══════════════════════════════════════════════════════════════════
   DASHBOARD COMPONENT
   ═══════════════════════════════════════════════════════════════════ */

export default function Dashboard() {
  /* ─── State ─── */
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [workflowStats, setWorkflowStats] = useState<WorkflowStats | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [jobStats, setJobStats] = useState<JobStats | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStatItem[]>([]);
  const [logStats, setLogStats] = useState<LogStats | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  /* ─── Fetch all data once ─── */
  const fetchAll = useCallback(async () => {
    const results = await Promise.allSettled([
      fetch(`${API_V1}/health`).then((r) => r.json()),
      fetch(`${API_V1}/system/status`).then((r) => r.json()),
      fetch(`${API_V1}/workflows/stats`).then((r) => r.json()),
      fetch(`${API_V1}/jobs`).then((r) => r.json()),
      fetch(`${API_V1}/agents`).then((r) => r.json()),
      fetch(`${API_V1}/tools`).then((r) => r.json()),
      fetch(`${API_V1}/skills`).then((r) => r.json()),
      fetch(`${API_V1}/jobs/stats`).then((r) => r.json()),
      fetch(`${API_V1}/agents/stats`).then((r) => r.json()),
      fetch(`${API_V1}/system/logs/stats`).then((r) => r.json()),
      fetch(`${API_V1}/system/cache`).then((r) => r.json()),
    ]);

    if (results[0].status === 'fulfilled') setHealth(results[0].value);
    if (results[1].status === 'fulfilled') setSystemStatus(results[1].value);
    if (results[2].status === 'fulfilled') setWorkflowStats(results[2].value);
    if (results[3].status === 'fulfilled') setJobs(results[3].value);
    if (results[4].status === 'fulfilled') setAgents(results[4].value);
    if (results[5].status === 'fulfilled') setTools(results[5].value);
    if (results[6].status === 'fulfilled') setSkills(results[6].value);
    if (results[7].status === 'fulfilled') setJobStats(results[7].value);
    if (results[8].status === 'fulfilled') setAgentStats(results[8].value);
    if (results[9].status === 'fulfilled') setLogStats(results[9].value);
    if (results[10].status === 'fulfilled') setCacheStats(results[10].value);
    setLoading(false);
  }, []);

  /* ─── Polling helpers ─── */
  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`${API_V1}/jobs`);
      if (res.ok) setJobs(await res.json());
    } catch { /* keep last good data */ }
  }, []);

  const fetchSystemStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_V1}/system/status`);
      if (res.ok) setSystemStatus(await res.json());
    } catch { /* keep last good data */ }
  }, []);

  const fetchWorkflowStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_V1}/workflows/stats`);
      if (res.ok) setWorkflowStats(await res.json());
    } catch { /* keep last good data */ }
  }, []);

  const fetchJobStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_V1}/jobs/stats`);
      if (res.ok) setJobStats(await res.json());
    } catch { /* keep last good data */ }
  }, []);

  const fetchAgentStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_V1}/agents/stats`);
      if (res.ok) setAgentStats(await res.json());
    } catch { /* keep last good data */ }
  }, []);

  const fetchLogStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_V1}/system/logs/stats`);
      if (res.ok) setLogStats(await res.json());
    } catch { /* keep last good data */ }
  }, []);

  const fetchCacheStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_V1}/system/cache`);
      if (res.ok) setCacheStats(await res.json());
    } catch { /* keep last good data */ }
  }, []);

  /* ─── Init + polling ─── */
  useEffect(() => {
    fetchAll();
    const jobsInterval = setInterval(fetchJobs, 5000);
    const statusInterval = setInterval(fetchSystemStatus, 10000);
    const workflowsInterval = setInterval(fetchWorkflowStats, 10000);
    const jobStatsInterval = setInterval(fetchJobStats, 10000);
    const cacheStatsInterval = setInterval(fetchCacheStats, 10000);
    const agentStatsInterval = setInterval(fetchAgentStats, 30000);
    const logStatsInterval = setInterval(fetchLogStats, 30000);
    return () => {
      clearInterval(jobsInterval);
      clearInterval(statusInterval);
      clearInterval(workflowsInterval);
      clearInterval(jobStatsInterval);
      clearInterval(cacheStatsInterval);
      clearInterval(agentStatsInterval);
      clearInterval(logStatsInterval);
    };
  }, [fetchAll, fetchJobs, fetchSystemStatus, fetchWorkflowStats, fetchJobStats, fetchCacheStats, fetchAgentStats, fetchLogStats]);

  /* ─── Derived data ─── */
  const recentJobs = useMemo(
    () =>
      [...jobs]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 20),
    [jobs],
  );

  const serverGroups = useMemo(() => {
    const map: Record<string, ServerGroup> = {};
    for (const tool of tools) {
      const key = tool.server || 'unknown';
      if (!map[key]) map[key] = { name: key, tools: [] };
      map[key].tools.push(tool);
    }
    return Object.values(map).sort((a, b) => b.tools.length - a.tools.length);
  }, [tools]);

  const isOnline = health?.status === 'ok' || health?.status === 'healthy';

  const agentStatsMap = useMemo(() => {
    const map: Record<string, AgentStatItem> = {};
    for (const stat of agentStats) {
      map[stat.name] = stat;
    }
    return map;
  }, [agentStats]);

  /* ─── Loading gate ─── */
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#787878', fontSize: 14 }}>加载中...</div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════ */

  return (
    <div className="page-container fade-in">
      {/* ─── Hero Header ─── */}
      <div className="page-hero fade-in fade-in-1">
        <h1 className="page-hero-title">
          <DashboardOutlined style={{ marginRight: 12, opacity: 0.4, fontSize: '0.85em' }} />
          Dashboard
        </h1>
        <p className="page-hero-subtitle">金融分析系统控制中心</p>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          TOP ROW — 4 stat cards: Agents / Skills / Tools / System
          ═══════════════════════════════════════════════════════════ */}
      <Row gutter={[20, 20]} style={{ marginBottom: 28 }}>
        <Col xs={12} sm={6}>
          <div className="stat-card fade-in fade-in-1">
            <div className="stat-card-icon" style={{ color: '#6B8EC4' }}>
              <RobotOutlined />
            </div>
            <div className="stat-card-number">{agents.length}</div>
            <div className="stat-card-label">Agents</div>
          </div>
        </Col>

        <Col xs={12} sm={6}>
          <div className="stat-card fade-in fade-in-1">
            <div className="stat-card-icon" style={{ color: '#5A9E7B' }}>
              <ThunderboltOutlined />
            </div>
            <div className="stat-card-number">{skills.length}</div>
            <div className="stat-card-label">Skills</div>
          </div>
        </Col>

        <Col xs={12} sm={6}>
          <div className="stat-card fade-in fade-in-2">
            <div className="stat-card-icon" style={{ color: '#D4A85A' }}>
              <ToolOutlined />
            </div>
            <div className="stat-card-number">{tools.length}</div>
            <div className="stat-card-label">Tools</div>
          </div>
        </Col>

        <Col xs={12} sm={6}>
          <div className="stat-card fade-in fade-in-2">
            <div className="stat-card-icon" style={{ color: isOnline ? '#5A9E7B' : '#D47070' }}>
              <CloudServerOutlined />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-1)' }}>
              <span
                className={`status-dot ${isOnline ? 'active' : 'error'}`}
                style={{ width: 8, height: 8 }}
              />
              <span
                style={{
                  fontSize: 'var(--text-lg)',
                  fontWeight: 600,
                  color: isOnline ? 'var(--accent-muted)' : 'var(--accent-danger)',
                  fontFamily: 'var(--font-display)',
                }}
              >
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
            <div className="stat-card-label" style={{ marginBottom: 0 }}>
              {systemStatus ? `Executor: ${systemStatus.jobExecutor}` : 'System'}
            </div>
          </div>
        </Col>
      </Row>

      {/* ═══════════════════════════════════════════════════════════
          MIDDLE ROW — Job Statistics + Recent Activity
          ═══════════════════════════════════════════════════════════ */}
      <Row gutter={[20, 20]} style={{ marginBottom: 28 }}>
        {/* Job Statistics */}
        <Col xs={24} lg={12}>
          <Card
            title={
              <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>
                <BarChartOutlined style={{ marginRight: 10, color: 'var(--accent)', opacity: 0.65 }} />
                Job Statistics
              </span>
            }
            className="card-spacious fade-in fade-in-2"
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 24,
              }}
            >
              {/* Total */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--accent-dim)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <BarChartOutlined style={{ color: 'var(--accent)', fontSize: 18 }} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 'var(--text-2xl)',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-display)',
                      lineHeight: 1,
                    }}
                  >
                    {jobStats?.total ?? 0}
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: 4 }}>
                    Total
                  </div>
                </div>
              </div>

              {/* Completed */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--accent-muted-dim)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CheckCircleOutlined style={{ color: 'var(--accent-muted)', fontSize: 18 }} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 'var(--text-2xl)',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-display)',
                      lineHeight: 1,
                    }}
                  >
                    {jobStats?.by_status?.completed ?? 0}
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: 4 }}>
                    Completed
                  </div>
                </div>
              </div>

              {/* Failed */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--accent-danger-dim)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CloseCircleOutlined style={{ color: 'var(--accent-danger)', fontSize: 18 }} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 'var(--text-2xl)',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-display)',
                      lineHeight: 1,
                    }}
                  >
                    {jobStats?.by_status?.failed ?? 0}
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: 4 }}>
                    Failed
                  </div>
                </div>
              </div>

              {/* Success Rate */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--accent-warm-dim)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <PercentageOutlined style={{ color: 'var(--accent-warm)', fontSize: 18 }} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 'var(--text-2xl)',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-display)',
                      lineHeight: 1,
                    }}
                  >
                    {jobStats?.success_rate ?? '--'}
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: 4 }}>
                    Success Rate
                  </div>
                </div>
              </div>
            </div>

            {/* Per-agent breakdown */}
            {jobStats?.by_agent && Object.keys(jobStats.by_agent).length > 0 && (
              <div
                style={{
                  marginTop: 20,
                  paddingTop: 16,
                  borderTop: '1px solid var(--border-subtle)',
                  display: 'flex',
                  gap: 16,
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-tertiary)',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 'var(--text-xs)' }}>
                  By Agent:
                </span>
                {Object.entries(jobStats.by_agent).map(([agent, count]) => (
                  <span key={agent}>
                    <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{agent}</span>
                    <span style={{ color: 'var(--text-tertiary)', margin: '0 4px' }}>({count})</span>
                  </span>
                ))}
              </div>
            )}
          </Card>
        </Col>

        {/* Recent Activity */}
        <Col xs={24} lg={12}>
          <Card
            title={
              <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>
                <DashboardOutlined style={{ marginRight: 10, color: 'var(--accent-warm)', opacity: 0.65 }} />
                Recent Activity
              </span>
            }
            className="card-spacious fade-in fade-in-3"
          >
            {recentJobs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)', fontSize: 15 }}>
                暂无任务记录
              </div>
            ) : (
              <div className="scroll-container">
                {recentJobs.map((job) => (
                  <div key={job.id} className="activity-feed-item">
                    <span
                      className="activity-feed-dot"
                      style={{ background: STATUS_COLORS[job.status] || 'var(--text-tertiary)' }}
                    />
                    <div className="activity-feed-body">
                      <div className="activity-feed-agent">{job.agent}</div>
                      <div className="activity-feed-action">{truncate(job.prompt, 50)}</div>
                    </div>
                    <div className="activity-feed-time">{timeAgo(job.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* ═══════════════════════════════════════════════════════════
          BOTTOM ROW — Agent Performance + MCP Servers
          ═══════════════════════════════════════════════════════════ */}
      <Row gutter={[20, 20]}>
        {/* Agent Performance */}
        <Col xs={24} lg={12}>
          <Card
            title={
              <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>
                <RobotOutlined style={{ marginRight: 10, color: '#6B8EC4', opacity: 0.65 }} />
                Agent Performance
              </span>
            }
            className="card-spacious fade-in fade-in-3"
          >
            {agents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)', fontSize: 15 }}>
                暂无 Agent 数据
              </div>
            ) : (
              <div className="scroll-container">
                {agents.map((agent, index) => {
                  const isExpanded = expandedAgent === agent.name;
                  const stats = agentStatsMap[agent.name];
                  return (
                    <div key={agent.name}>
                      <div
                        className="list-row"
                        style={{
                          borderBottom:
                            index < agents.length - 1 || isExpanded ? '1px solid var(--border-subtle)' : 'none',
                          cursor: 'pointer',
                        }}
                        onClick={() => setExpandedAgent(isExpanded ? null : agent.name)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                          <span className={`status-dot ${agent.mode === 'primary' ? 'active' : ''}`} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="list-row-name">{agent.name}</div>
                            <div className="list-row-desc">{agent.description || '暂无描述'}</div>
                          </div>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            flexShrink: 0,
                            marginLeft: 16,
                          }}
                        >
                          {/* Performance stats (from agents/stats API) */}
                          {stats && (
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                fontSize: 12,
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--text-tertiary)',
                              }}
                            >
                              <span
                                style={{
                                  color: 'var(--text-secondary)',
                                  background: 'var(--bg-overlay)',
                                  border: '1px solid var(--border-subtle)',
                                  padding: '1px 8px',
                                  borderRadius: 'var(--radius-sm)',
                                  fontSize: 11,
                                  fontWeight: 500,
                                }}
                              >
                                {stats.mode}
                              </span>
                              <span title="Total jobs">{stats.jobs_total}</span>
                              <span style={{ color: 'var(--accent-muted)' }} title="Completed">{stats.jobs_completed}</span>
                              <span style={{ color: 'var(--accent-danger)' }} title="Failed">{stats.jobs_failed}</span>
                              <span style={{ color: 'var(--accent-warm)', fontWeight: 600 }} title="Success rate">
                                {stats.success_rate ?? '--'}
                              </span>
                            </div>
                          )}

                          {/* Capability tags */}
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {agent.capabilities.map((cap) => (
                              <span
                                key={cap}
                                style={{
                                  fontSize: 12,
                                  color: 'var(--accent)',
                                  background: 'var(--accent-dim)',
                                  padding: '2px 10px',
                                  borderRadius: 8,
                                  fontWeight: 500,
                                }}
                              >
                                {cap}
                              </span>
                            ))}
                          </div>

                          {/* Tools count */}
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                              fontSize: 13,
                              color: 'var(--text-tertiary)',
                              fontWeight: 500,
                            }}
                          >
                            <ToolOutlined style={{ fontSize: 12 }} />
                            {agent.tools.length}
                          </div>
                        </div>
                      </div>

                      {/* Expanded tools list */}
                      {isExpanded && (
                        <div
                          style={{
                            padding: '12px 0 12px 18px',
                            borderBottom:
                              index < agents.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                            background: 'var(--bg-elevated)',
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              color: 'var(--text-tertiary)',
                              marginBottom: 8,
                              fontWeight: 600,
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                            }}
                          >
                            Tools
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {agent.tools.map((tool) => (
                              <span
                                key={tool}
                                style={{
                                  fontSize: 13,
                                  color: 'var(--text-secondary)',
                                  background: 'var(--bg-overlay)',
                                  border: '1px solid var(--border-subtle)',
                                  padding: '4px 12px',
                                  borderRadius: 8,
                                  fontFamily: 'var(--font-mono)',
                                  fontWeight: 400,
                                }}
                              >
                                {tool}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </Col>

        {/* MCP Servers */}
        <Col xs={24} lg={12}>
          <Card
            title={
              <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>
                <CloudServerOutlined style={{ marginRight: 10, color: '#D4A85A', opacity: 0.65 }} />
                MCP Servers
              </span>
            }
            className="card-spacious fade-in fade-in-4"
          >
            {serverGroups.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)', fontSize: 15 }}>
                暂无 MCP 服务器数据
              </div>
            ) : (
              <div className="scroll-container">
                {serverGroups.map((group, index) => (
                  <div
                    key={group.name}
                    className="list-row"
                    style={{
                      borderBottom: index < serverGroups.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                      <span className="status-dot active" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="list-row-name">{group.name}</div>
                        <div className="list-row-desc">
                          {group.tools.map((t) => t.name).join(', ')}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, marginLeft: 16 }}>
                      <span
                        style={{
                          fontSize: 12,
                          color: '#5A9E7B',
                          background: 'rgba(90, 158, 123, 0.14)',
                          padding: '2px 10px',
                          borderRadius: 8,
                          fontWeight: 500,
                        }}
                      >
                        enabled
                      </span>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          fontSize: 13,
                          color: 'var(--text-tertiary)',
                          fontWeight: 500,
                        }}
                      >
                        <ToolOutlined style={{ fontSize: 12 }} />
                        {group.tools.length} tools
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* ═══════════════════════════════════════════════════════════
          SYSTEM RESOURCES ROW — Cache / Concurrency / Logs
          ═══════════════════════════════════════════════════════════ */}
      <Row gutter={[20, 20]} style={{ marginTop: 0 }}>
        <Col xs={24}>
          <Card
            title={
              <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>
                <DatabaseOutlined style={{ marginRight: 10, color: 'var(--accent-muted)', opacity: 0.65 }} />
                System Resources
              </span>
            }
            className="card-spacious fade-in fade-in-5"
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 28,
              }}
            >
              {/* Workflow Cache */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--accent-muted-dim)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <DatabaseOutlined style={{ color: 'var(--accent-muted)', fontSize: 18 }} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 'var(--text-lg)',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-display)',
                      lineHeight: 1,
                    }}
                  >
                    {cacheStats
                      ? `${cacheStats.workflow_cache.size}/${cacheStats.workflow_cache.max_size}`
                      : '加载中...'}
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: 4 }}>
                    Cache{cacheStats ? ` (${cacheStats.workflow_cache.usage_pct}%)` : ''}
                  </div>
                </div>
              </div>

              {/* Concurrency */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--accent-dim)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <SyncOutlined style={{ color: 'var(--accent)', fontSize: 18 }} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 'var(--text-lg)',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-display)',
                      lineHeight: 1,
                    }}
                  >
                    {cacheStats
                      ? `${cacheStats.concurrency.active}/${cacheStats.concurrency.max}`
                      : '加载中...'}
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: 4 }}>
                    Concurrency{cacheStats ? ` (${cacheStats.concurrency.usage_pct}%)` : ''}
                  </div>
                </div>
              </div>

              {/* Logs */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--accent-warm-dim)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <FileTextOutlined style={{ color: 'var(--accent-warm)', fontSize: 18 }} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 'var(--text-lg)',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-display)',
                      lineHeight: 1,
                    }}
                  >
                    {logStats
                      ? `${logStats.total_log_entries.toLocaleString()} entries`
                      : '加载中...'}
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: 4 }}>
                    {logStats
                      ? `across ${logStats.active_jobs_with_logs} jobs`
                      : 'Logs'}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
