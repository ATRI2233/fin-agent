import React from 'react';
import { Timeline, Tag, Typography, Tooltip, Spin } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, SyncOutlined, ClockCircleOutlined, ForwardOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface NodeExec {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
  agentResponse?: string;
  startedAt?: string;
  completedAt?: string;
}

const STATUS_COLOR: Record<NodeExec['status'], string> = {
  pending: '#6B6B6B',
  running: '#8B9DC3',
  completed: '#6B8E7B',
  failed: '#C47C7C',
  skipped: '#C4A882',
};

const STATUS_TAG: Record<NodeExec['status'], string> = {
  pending: 'default',
  running: 'processing',
  completed: 'success',
  failed: 'error',
  skipped: 'warning',
};

const STATUS_ICON: Record<NodeExec['status'], React.ReactNode> = {
  pending: <ClockCircleOutlined style={{ color: STATUS_COLOR.pending }} />,
  running: <SyncOutlined spin style={{ color: STATUS_COLOR.running }} />,
  completed: <CheckCircleOutlined style={{ color: STATUS_COLOR.completed }} />,
  failed: <CloseCircleOutlined style={{ color: STATUS_COLOR.failed }} />,
  skipped: <ForwardOutlined style={{ color: STATUS_COLOR.skipped }} />,
};

function formatDuration(start?: string, end?: string): string {
  if (!start) return '--';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const ms = e - s;
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

function formatTime(ts?: string): string {
  if (!ts) return '--';
  return new Date(ts).toLocaleTimeString();
}

function jsonPreview(data: unknown, maxLen = 200): string {
  if (data === undefined || data === null) return '--';
  const str = JSON.stringify(data);
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

interface Props {
  nodes: NodeExec[];
}

export default function ExecutionTimeline({ nodes }: Props) {
  const sorted = [...nodes];

  return (
    <div style={{
      padding: '20px 24px',
      overflowY: 'auto',
      height: '100%',
      background: '#0d1117',
    }}>
      <Text style={{
        color: '#8b949e',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        display: 'block',
        marginBottom: 16,
      }}>
        Execution Order
      </Text>

      <Timeline
        mode="left"
        items={sorted.map((node) => {
          const isActive = node.status === 'running';
          const dot = isActive
            ? <Spin size="small" />
            : STATUS_ICON[node.status];

          return {
            dot,
            color: STATUS_COLOR[node.status],
            children: (
              <div style={{
                background: isActive ? 'rgba(22, 119, 255, 0.06)' : 'rgba(22, 27, 34, 0.6)',
                border: `1px solid ${isActive ? 'rgba(22, 119, 255, 0.25)' : '#21262d'}`,
                borderRadius: 8,
                padding: '10px 14px',
                marginLeft: 8,
                minWidth: 280,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text strong style={{ color: '#e6edf3', fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
                    {node.name}
                  </Text>
                  <Tag color={STATUS_TAG[node.status]} style={{ fontSize: 10, marginBottom: 0 }}>
                    {node.status.toUpperCase()}
                  </Tag>
                </div>

                <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                  <Tooltip title="Start time">
                    <Text style={{ color: '#8b949e', fontSize: 11 }}>
                      🕐 {formatTime(node.startedAt)}
                    </Text>
                  </Tooltip>
                  <Tooltip title="Duration">
                    <Text style={{ color: '#8b949e', fontSize: 11 }}>
                      ⏱ {formatDuration(node.startedAt, node.completedAt)}
                    </Text>
                  </Tooltip>
                </div>

                {(node.inputs || node.outputs) && (
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {node.inputs && (
                      <Text style={{ color: '#484f58', fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
                        IN: {jsonPreview(node.inputs, 80)}
                      </Text>
                    )}
                    {node.outputs && (
                      <Text style={{ color: '#484f58', fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
                        OUT: {jsonPreview(node.outputs, 80)}
                      </Text>
                    )}
                  </div>
                )}

                {node.error && (
                  <Tooltip title={node.error}>
                    <Text style={{ color: '#C47C7C', fontSize: 10, display: 'block', marginTop: 4 }} ellipsis>
                      ⚠ {node.error.slice(0, 60)}{node.error.length > 60 ? '…' : ''}
                    </Text>
                  </Tooltip>
                )}
              </div>
            ),
          };
        })}
      />
    </div>
  );
}