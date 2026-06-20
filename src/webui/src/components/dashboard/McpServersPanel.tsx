/**
 * McpServersPanel — right card showing aggregated MCP server groups.
 *
 * Pure render: receives pre-grouped `serverGroups` from the container.
 * Each group row displays the server name, a tool-name preview, and the
 * tool count.
 */
import { Card } from 'antd';
import { CloudServerOutlined, ToolOutlined } from '@ant-design/icons';
import type { ToolItem } from '../../domain/agent';

export interface ServerGroup {
  name: string;
  tools: ToolItem[];
}

interface McpServersPanelProps {
  serverGroups: ServerGroup[];
}

function groupStyle(last: boolean) {
  return { borderBottom: last ? 'none' : '1px solid var(--border-subtle)' } as const;
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)', fontSize: 15 }}>{msg}</div>;
}

export function McpServersPanel({ serverGroups }: McpServersPanelProps) {
  return (
    <Card
      title={
        <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>
          <CloudServerOutlined style={{ marginRight: 10, color: '#D4A85A', opacity: 0.65 }} /> MCP Servers
        </span>
      }
      className="card-spacious fade-in fade-in-3"
    >
      {serverGroups.length === 0 ? (
        <Empty msg="暂无 MCP 服务器数据" />
      ) : (
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
                  <ToolOutlined style={{ fontSize: 12 }} />
                  {group.tools.length} tools
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}