/**
 * AgentPerformancePanel — left card showing the agent list with click-to-expand.
 *
 * Owns the `expandedAgent` UI state internally (only `useState`, no data
 * fetching). When expanded, the agent's `tools_whitelist` is revealed.
 */
import { useState } from 'react';
import { Card } from 'antd';
import { RobotOutlined, ToolOutlined } from '@ant-design/icons';
import type { Agent } from '../../domain/agent';

interface AgentPerformancePanelProps {
  agents: Agent[];
}

const agentRowStyle = { borderBottom: '1px solid var(--border-subtle)' } as const;

function Empty({ msg }: { msg: string }) {
  return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)', fontSize: 15 }}>{msg}</div>;
}

export function AgentPerformancePanel({ agents }: AgentPerformancePanelProps) {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  return (
    <Card
      title={
        <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>
          <RobotOutlined style={{ marginRight: 10, color: '#6B8EC4', opacity: 0.65 }} /> Agent Performance
        </span>
      }
      className="card-spacious fade-in fade-in-2"
    >
      {agents.length === 0 ? (
        <Empty msg="暂无 Agent 数据" />
      ) : (
        <div className="scroll-container">
          {agents.map((agent, index) => {
            const isExpanded = expandedAgent === agent.name;
            const agentTags = agent.tags ?? [];
            const agentToolWhitelist = agent.tools_whitelist ?? [];
            const isLast = index === agents.length - 1;
            return (
              <div key={agent.name}>
                <div
                  className="list-row"
                  style={{ ...(index < agents.length - 1 || isExpanded ? agentRowStyle : {}), cursor: 'pointer' }}
                  onClick={() => setExpandedAgent(isExpanded ? null : agent.name)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                    <span className={`status-dot ${agent.mode === 'primary' ? 'active' : ''}`} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="list-row-name">{agent.name}</div>
                      <div className="list-row-desc">{agent.description || '暂无描述'}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, marginLeft: 16 }}>
                    <span style={{ color: 'var(--text-secondary)', background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)', padding: '1px 8px', borderRadius: 'var(--radius-sm)', fontSize: 11, fontWeight: 500 }}>
                      {agent.mode}
                    </span>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {agentTags.map((tag) => (
                        <span key={tag} style={{ fontSize: 12, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '2px 10px', borderRadius: 8, fontWeight: 500 }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 500 }}>
                      <ToolOutlined style={{ fontSize: 12 }} />
                      {agentToolWhitelist.length}
                    </div>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ padding: '12px 0 12px 18px', ...(isLast ? {} : agentRowStyle), background: 'var(--bg-elevated)' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tools</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {agentToolWhitelist.map((tool) => (
                        <span key={tool} style={{ fontSize: 13, color: 'var(--text-secondary)', background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)', padding: '4px 12px', borderRadius: 8, fontFamily: 'var(--font-mono)', fontWeight: 400 }}>
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
  );
}