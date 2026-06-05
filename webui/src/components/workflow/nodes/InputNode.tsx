import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Input } from 'antd';

export type InputNodeData = {
  label: string;
  value?: string;
};

const InputNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as InputNodeData;

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 10,
        background: 'rgba(139, 157, 195, 0.08)',
        border: selected ? '2px solid #8B9DC3' : '1px solid rgba(139, 157, 195, 0.2)',
        minWidth: 120,
      }}
    >
      <div style={{ marginBottom: 8, fontWeight: 600, color: '#8B9DC3' }}>
        Input
      </div>
      <div style={{ marginBottom: 8, fontSize: 14, color: '#E5E5E5' }}>{nodeData.label || 'Enter input'}</div>
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: '#8B9DC3',
          width: 10,
          height: 10,
        }}
      />
    </div>
  );
});

InputNode.displayName = 'InputNode';

export default InputNode;
