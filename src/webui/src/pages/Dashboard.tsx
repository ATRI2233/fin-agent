/**
 * Dashboard — read-only overview page.
 * All server data is fetched via `useDashboardData` (React Query).
 * No local `useState` for server data; only `expandedAgent` for UI state.
 */
import { useMemo, useState } from 'react';
import { Row, Col, Card, Spin, Alert } from 'antd';
import { RobotOutlined, ToolOutlined, DashboardOutlined, CloudServerOutlined } from '@ant-design/icons';
import { useDashboardData } from '../hooks/useDashboardData';
import type { ToolItem } from '../types/agent';

interface ServerGroup { name: string; tools: ToolItem[]; }

const agentRowStyle = { borderBottom: '1px solid var(--border-subtle)' } as const;
const groupStyle = (last: boolean) => ({ borderBottom: last ? 'none' : '1px solid var(--border-subtle)' });

export default function Dashboard() {
  const { agents, tools, servers, isLoading, isError, refetch } = useDashboardData();
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const serverGroups = useMemo<ServerGroup[]>(() => {
    const map: Record<string, ServerGroup> = {};
    for (const tool of tools) {
      const key = tool.server || 'unknown';
      (map[key] ??= { name: key, tools: [] }).tools.push(tool);
    }
    return Object.values(map).sort((a, b) => b.tools.length - a.tools.length);
  }, [tools]);

  if (isLoading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}><Spin size="large" /></div>;
  if (isError) return <div style={{ padding: 40 }}><Alert type="error" message="加载失败" description="无法获取 Dashboard 数据" showIcon action={<a onClick={refetch}>重试</a>} /></div>;

  return (
    <div className="page-container fade-in">
      <div className="page-hero fade-in fade-in-1">
        <h1 className="page-hero-title">
          <DashboardOutlined style={{ marginRight: 12, opacity: 0.4, fontSize: '0.85em' }} /> Dashboard
        </h1>
        <p className="page-hero-subtitle">金融分析系统控制中心</p>
      </div>

      <Row gutter={[20, 20]} style={{ marginBottom: 28 }}>
        <Col xs={8}>
          <div className="stat-card fade-in fade-in-1">
            <div className="stat-card-icon" style={{ color: '#6B8EC4' }}><RobotOutlined /></div>
            <div className="stat-card-number">{agents.length}</div>
            <div className="stat-card-label">Agents</div>
          </div>
        </Col>
        <Col xs={8}>
          <div className="stat-card fade-in fade-in-2">
            <div className="stat-card-icon" style={{ color: '#D4A85A' }}><ToolOutlined /></div>
            <div className="stat-card-number">{tools.length}</div>
            <div className="stat-card-label">Tools</div>
          </div>
        </Col>
        <Col xs={8}>
          <div className="stat-card fade-in fade-in-3">
            <div className="stat-card-icon" style={{ color: '#5A9E7B' }}><CloudServerOutlined /></div>
            <div className="stat-card-number">{servers.length}</div>
            <div className="stat-card-label">Servers</div>
          </div>
        </Col>
      </Row>

      <Row gutter={[20, 20]}>
        <Col xs={24} lg={12}>
          <Card title={<span style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}><RobotOutlined style={{ marginRight: 10, color: '#6B8EC4', opacity: 0.65 }} /> Agent Performance</span>} className="card-spacious fade-in fade-in-2">
            {agents.length === 0 ? <Empty msg="暂无 Agent 数据" /> : (
              <div className="scroll-container">
                {agents.map((agent, index) => {
                  const isExpanded = expandedAgent === agent.name;
                  const agentTags = agent.tags ?? [];
                  const agentToolWhitelist = agent.tools_whitelist ?? [];
                  const isLast = index === agents.length - 1;
                  return (
                    <div key={agent.name}>
                      <div className="list-row" style={{ ...(index < agents.length - 1 || isExpanded ? agentRowStyle : {}), cursor: 'pointer' }} onClick={() => setExpandedAgent(isExpanded ? null : agent.name)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                          <span className={`status-dot ${agent.mode === 'primary' ? 'active' : ''}`} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="list-row-name">{agent.name}</div>
                            <div className="list-row-desc">{agent.description || '暂无描述'}</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, marginLeft: 16 }}>
                          <span style={{ color: 'var(--text-secondary)', background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)', padding: '1px 8px', borderRadius: 'var(--radius-sm)', fontSize: 11, fontWeight: 500 }}>{agent.mode}</span>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {agentTags.map((tag) => <span key={tag} style={{ fontSize: 12, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '2px 10px', borderRadius: 8, fontWeight: 500 }}>{tag}</span>)}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 500 }}>
                            <ToolOutlined style={{ fontSize: 12 }} />{agentToolWhitelist.length}
                          </div>
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: '12px 0 12px 18px', ...(isLast ? {} : agentRowStyle), background: 'var(--bg-elevated)' }}>
                          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tools</div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {agentToolWhitelist.map((tool) => <span key={tool} style={{ fontSize: 13, color: 'var(--text-secondary)', background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)', padding: '4px 12px', borderRadius: 8, fontFamily: 'var(--font-mono)', fontWeight: 400 }}>{tool}</span>)}
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

        <Col xs={24} lg={12}>
          <Card title={<span style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}><CloudServerOutlined style={{ marginRight: 10, color: '#D4A85A', opacity: 0.65 }} /> MCP Servers</span>} className="card-spacious fade-in fade-in-3">
            {serverGroups.length === 0 ? <Empty msg="暂无 MCP 服务器数据" /> : (
              <div className="scroll-container">
                {serverGroups.map((group, index) => (
                  <div key={group.name} className="list-row" style={groupStyle(index === serverGroups.length - 1)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                      <span className="status-dot active" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="list-row-name">{group.name}</div>
                        <div className="list-row-desc">{group.tools.map((t) => t.name).join(', ')}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, marginLeft: 16 }}>
                      <span style={{ fontSize: 12, color: '#5A9E7B', background: 'rgba(90, 158, 123, 0.14)', padding: '2px 10px', borderRadius: 8, fontWeight: 500 }}>enabled</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 500 }}>
                        <ToolOutlined style={{ fontSize: 12 }} />{group.tools.length} tools
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)', fontSize: 15 }}>{msg}</div>;
}
