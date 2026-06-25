import React from 'react';
import { Typography, Card, Tag, Spin, Descriptions, Divider, Empty } from 'antd';
import { RightOutlined } from '@ant-design/icons';
import { NODE_STATUS_CONFIG, type NodeStatusKey } from '../utils/statusConfig';
import { formatTime } from '../utils/time';

const { Title, Text, Paragraph } = Typography;

interface NodeExec {
  id: string;
  name: string;
  status: NodeStatusKey;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
  agentResponse?: string;
  startedAt?: string;
  completedAt?: string;
}

function formatDuration(ms?: number): string {
  if (!ms) return '--';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function jsonPreview(data: unknown, maxLen = 300): string {
  if (data === undefined || data === null) return '--';
  const str = JSON.stringify(data, null, 2);
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

interface Props {
  node: NodeExec;
  onClose: () => void;
}

export default function NodeDataPanel({ node, onClose }: Props) {
  const durationMs = node.startedAt && node.completedAt
    ? new Date(node.completedAt).getTime() - new Date(node.startedAt).getTime()
    : node.startedAt
      ? Date.now() - new Date(node.startedAt).getTime()
      : undefined;

  return (
    <div style={{
      width: 340,
      flexShrink: 0,
      borderLeft: '1px solid #21262d',
      background: '#161b22',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #21262d',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {React.createElement(NODE_STATUS_CONFIG[node.status]?.icon ?? NODE_STATUS_CONFIG.pending.icon, { style: { color: NODE_STATUS_CONFIG[node.status]?.color ?? '#6B6B6B' } })}
          <Title level={5} style={{ color: '#e6edf3', margin: 0, fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>
            {node.name}
          </Title>
        </div>
        <a onClick={onClose} style={{ color: '#8b949e', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>
          <RightOutlined />
        </a>
      </div>

      {/* Status badge */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #21262d' }}>
        <Tag color={NODE_STATUS_CONFIG[node.status]?.tag ?? 'default'} style={{ fontSize: 12 }}>
          {node.status.toUpperCase()}
        </Tag>
        <Text style={{ color: '#8b949e', fontSize: 11, marginLeft: 8 }}>ID: {node.id}</Text>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>

        {/* Execution times */}
        <Descriptions
          title={<Text style={{ color: '#8b949e', fontSize: 11 }}>执行时间</Text>}
          column={1}
          size="small"
          labelStyle={{ color: '#8b949e', fontSize: 11 }}
          contentStyle={{ color: '#e6edf3', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}
        >
          <Descriptions.Item label="开始时间">
            {node.startedAt ? formatTime(node.startedAt) : '--'}
          </Descriptions.Item>
          <Descriptions.Item label="完成时间">
            {node.completedAt ? formatTime(node.completedAt) : '--'}
          </Descriptions.Item>
          <Descriptions.Item label="耗时">
            {node.status === 'running'
              ? <Spin size="small" style={{ marginRight: 6 }} />
              : null}
            {formatDuration(durationMs)}
          </Descriptions.Item>
        </Descriptions>

        <Divider style={{ margin: '12px 0', borderColor: '#21262d' }} />

        {/* Error */}
        {node.error && (
          <>
            <Text style={{ color: '#8b949e', fontSize: 11, display: 'block', marginBottom: 4 }}>错误</Text>
            <div style={{
              background: 'rgba(255, 77, 79, 0.08)',
              border: '1px solid rgba(255, 77, 79, 0.3)',
              borderRadius: 6,
              padding: '8px 10px',
              marginBottom: 12,
            }}>
              <Paragraph style={{ color: '#C47C7C', fontSize: 12, margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>
                {node.error}
              </Paragraph>
            </div>
          </>
        )}

        {/* Agent response preview */}
        {node.agentResponse && (
          <>
            <Text style={{ color: '#8b949e', fontSize: 11, display: 'block', marginBottom: 4 }}>代理响应</Text>
            <div style={{
              background: 'rgba(22, 119, 255, 0.08)',
              border: '1px solid rgba(22, 119, 255, 0.2)',
              borderRadius: 6,
              padding: '8px 10px',
              marginBottom: 12,
              maxHeight: 120,
              overflow: 'hidden',
              position: 'relative',
            }}>
              <Paragraph
                style={{ color: '#79c0ff', fontSize: 12, margin: 0, fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'pre-wrap' }}
                ellipsis={{ rows: 5, expandable: false }}
              >
                {node.agentResponse}
              </Paragraph>
            </div>
          </>
        )}

        {/* Inputs */}
        <Text style={{ color: '#8b949e', fontSize: 11, display: 'block', marginBottom: 4 }}>输入数据</Text>
        <Card
          size="small"
          bodyStyle={{ padding: '8px 10px' }}
          style={{ background: '#0d1117', border: '1px solid #21262d', marginBottom: 12 }}
        >
          {node.inputs ? (
            <pre style={{
              color: '#8b949e',
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {jsonPreview(node.inputs)}
            </pre>
          ) : (
            <Empty description={<Text style={{ color: '#484f58', fontSize: 11 }}>暂无输入数据</Text>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Card>

        {/* Outputs */}
        <Text style={{ color: '#8b949e', fontSize: 11, display: 'block', marginBottom: 4 }}>输出数据</Text>
        <Card
          size="small"
          bodyStyle={{ padding: '8px 10px' }}
          style={{ background: '#0d1117', border: '1px solid #21262d' }}
        >
          {node.outputs ? (
            <pre style={{
              color: '#8b949e',
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {jsonPreview(node.outputs)}
            </pre>
          ) : (
            <Empty description={<Text style={{ color: '#484f58', fontSize: 11 }}>暂无输出数据</Text>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Card>
      </div>
    </div>
  );
}