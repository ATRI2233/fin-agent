import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { UsergroupAddOutlined, RobotOutlined } from '@ant-design/icons';

export type DebateNodeData = {
  label: string;
  agents?: string[];
};

const DebateNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as DebateNodeData;
  const agents = nodeData.agents || ['Agent A', 'Agent B', 'Judge'];

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 10,
        background: '#1A1A1A',
        border: selected ? '2px solid #B8A0CC' : '1px solid rgba(255,255,255,0.10)',
        minWidth: 180,
        boxShadow: selected ? '0 0 0 2px rgba(184, 160, 204, 0.15)' : '0 2px 8px rgba(0,0,0,0.2)',
      }}
    >
      <div style={{ marginBottom: 8, fontWeight: 600, color: '#B8A0CC', fontSize: 14 }}>
        Debate
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {agents.slice(0, -1).map((_, i) => (
          <Handle
            key={i}
            type="target"
            position={Position.Left}
            id={`agent-${i}`}
            style={{
              background: '#B8A0CC',
              width: 18,
              height: 18,
              left: -9,
              border: '3px solid #1A1A1A',
              borderRadius: '50%',
              top: `${40 + i * 20}%`,
            }}
          />
        ))}
        <Handle
          type="source"
          position={Position.Right}
          style={{
            background: '#B8A0CC',
            width: 20,
            height: 20,
            right: -10,
            border: '3px solid #1A1A1A',
            borderRadius: '50%',
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <UsergroupAddOutlined style={{ fontSize: 20, color: '#B8A0CC' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: '#E5E5E5' }}>{agents.slice(0, -1).join(' vs ')}</div>
          <div style={{ fontSize: 12, color: '#A0A0A0' }}>
            <RobotOutlined /> {agents[agents.length - 1]}
          </div>
        </div>
      </div>
    </div>
  );
});

DebateNode.displayName = 'DebateNode';

export default DebateNode;
