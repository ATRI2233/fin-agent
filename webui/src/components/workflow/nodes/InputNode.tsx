import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ImportOutlined } from '@ant-design/icons';

export type InputNodeData = {
  label: string;
  params?: Array<{ key: string; type: string; default: string }>;
  value?: string;
};

const InputNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as InputNodeData;
  const paramCount = nodeData.params?.length ?? 0;

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 10,
        background: '#1A1A1A',
        border: selected ? '2px solid #5A9E7B' : '1px solid rgba(255,255,255,0.10)',
        minWidth: 160,
        boxShadow: selected ? '0 0 0 2px rgba(90, 158, 123, 0.15)' : '0 2px 8px rgba(0,0,0,0.2)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'rgba(90, 158, 123, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ImportOutlined style={{ fontSize: 18, color: '#5A9E7B' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#5A9E7B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {nodeData.label}
          </div>
          <div style={{ fontSize: 11, color: '#A0A0A0' }}>
            Input{paramCount > 0 ? ` · ${paramCount} params` : ''}
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: '#5A9E7B',
          width: 20,
          height: 20,
          right: -10,
          border: '3px solid #1A1A1A',
          borderRadius: '50%',
        }}
      />
    </div>
  );
});

InputNode.displayName = 'InputNode';

export default InputNode;
