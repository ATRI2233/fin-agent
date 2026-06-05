import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { RobotOutlined } from '@ant-design/icons';

export type AgentNodeData = {
  label: string;
  agentType?: string;
  status?: 'idle' | 'running' | 'done' | 'error';
  prompt?: string;
  avatar?: string;
};

const statusColors = {
  idle: '#6B6B6B',
  running: '#8B9DC3',
  done: '#6B8E7B',
  error: '#C47C7C',
};

const AgentNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as AgentNodeData;
  const status = nodeData.status || 'idle';
  const statusColor = statusColors[status];

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 10,
        background: '#1A1A1A',
        border: selected ? '2px solid #8B9DC3' : '1px solid rgba(255,255,255,0.10)',
        minWidth: 160,
        boxShadow: selected ? '0 0 0 2px rgba(139, 157, 195, 0.15)' : '0 2px 8px rgba(0,0,0,0.2)',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: '#8B9DC3',
          width: 10,
          height: 10,
          left: -5,
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'rgba(139, 157, 195, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {nodeData.avatar ? (
            <img src={nodeData.avatar} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />
          ) : (
            <RobotOutlined style={{ fontSize: 18, color: '#8B9DC3' }} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#E5E5E5' }}>
            {nodeData.label || 'Agent'}
          </div>
          {nodeData.agentType && (
            <div style={{ fontSize: 11, color: '#A0A0A0' }}>{nodeData.agentType}</div>
          )}
        </div>
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: statusColor,
          }}
          title={status}
        />
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: '#8B9DC3',
          width: 10,
          height: 10,
          right: -5,
        }}
      />
    </div>
  );
});

AgentNode.displayName = 'AgentNode';

export default AgentNode;
