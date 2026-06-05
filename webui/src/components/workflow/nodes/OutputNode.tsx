import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';

export type OutputNodeData = {
  label: string;
};

const OutputNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as OutputNodeData;

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 10,
        background: 'rgba(107, 142, 123, 0.08)',
        border: selected ? '2px solid #6B8E7B' : '1px solid rgba(107, 142, 123, 0.2)',
        minWidth: 120,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: '#6B8E7B',
          width: 10,
          height: 10,
        }}
      />
      <div style={{ marginBottom: 8, fontWeight: 600, color: '#6B8E7B' }}>
        Output
      </div>
      <div style={{ fontSize: 14, color: '#E5E5E5' }}>{nodeData.label || 'Result'}</div>
    </div>
  );
});

OutputNode.displayName = 'OutputNode';

export default OutputNode;
