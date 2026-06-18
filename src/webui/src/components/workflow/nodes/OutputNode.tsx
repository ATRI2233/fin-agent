import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ExportOutlined } from '@ant-design/icons';

export type OutputNodeData = {
  label: string;
  outputKey?: string;
};

const OutputNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as OutputNodeData;

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 10,
        background: '#1A1A1A',
        border: selected ? '2px solid #D4A85A' : '1px solid rgba(255,255,255,0.10)',
        minWidth: 160,
        boxShadow: selected ? '0 0 0 2px rgba(212, 168, 90, 0.15)' : '0 2px 8px rgba(0,0,0,0.2)',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: '#D4A85A',
          width: 20,
          height: 20,
          left: -10,
          border: '3px solid #1A1A1A',
          borderRadius: '50%',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'rgba(212, 168, 90, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ExportOutlined style={{ fontSize: 18, color: '#D4A85A' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#D4A85A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {nodeData.label}
          </div>
          <div style={{ fontSize: 11, color: '#A0A0A0' }}>
            Output{nodeData.outputKey ? ` · ${nodeData.outputKey}` : ''}
          </div>
        </div>
      </div>
    </div>
  );
});

OutputNode.displayName = 'OutputNode';

export default OutputNode;
