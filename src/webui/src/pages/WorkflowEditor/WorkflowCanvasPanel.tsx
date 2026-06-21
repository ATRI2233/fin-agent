/**
 * WorkflowCanvasPanel — center panel of the workflow editor.
 *
 * Wraps `@xyflow/react`'s `<ReactFlow>` with the editor's custom node
 * renderers (agent, debate, workflow-block, input, output) and the custom
 * `EdgeWithLabel` edge renderer. The panel is a controlled component:
 * the parent owns the `nodes`/`edges` arrays plus the `useNodesState` /
 * `useEdgesState` handlers, so changes flow back through the callbacks.
 *
 * Drag/drop semantics
 * -------------------
 * The drop handler is the parent's `onDrop` — the parent owns the palette
 * (so it knows which agent types resolve to which node factories). The
 * panel only wires `onDragOver` to allow the drop and forwards the
 * `React.DragEvent` through.
 *
 * Edge creation
 * -------------
 * `onConnect` is also forwarded to the parent. The parent is responsible
 * for stamping `type: 'smoothstep'`, `animated`, and the default
 * `EdgePromptData` (`{ prompt: '', promptType: 'context' }`) onto new
 * edges. Centralising this logic keeps edge style consistent regardless
 * of how the connection was initiated.
 */

import { useCallback } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  Panel,
  type OnConnect,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type NodeProps,
  type EdgeProps,
  type OnNodesChange,
  type OnEdgesChange,
  Handle,
  Position,
  EdgeLabelRenderer,
  BaseEdge,
  getBezierPath,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Typography } from 'antd';

import DebateNodeComponent from '../../components/workflow/nodes/DebateNode';
import InputNodeComponent from '../../components/workflow/nodes/InputNode';
import OutputNodeComponent from '../../components/workflow/nodes/OutputNode';
import type {
  AgentNodeData,
  WorkflowBlockNodeData,
  EdgePromptData,
  WorkflowEdge,
  WorkflowNode,
  PromptType,
} from './index';

/* ─── Edge type config (icon per prompt kind) ─────────────────────────── */

const PROMPT_TYPE_ICONS: Record<PromptType, string> = {
  context: '📝',
  instruction: '⚡',
  constraint: '🔒',
  data: '📊',
};

/* ─── Custom edge with prompt-type label ───────────────────────────────── */

function EdgeWithLabel({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd,
  selected,
}: EdgeProps<WorkflowEdge>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const promptType = data?.promptType ?? 'context';
  const hasPrompt = Boolean(data?.prompt?.trim());
  const icon = PROMPT_TYPE_ICONS[promptType];

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {(hasPrompt || selected) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              cursor: 'pointer',
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: hasPrompt ? 28 : 20,
              height: hasPrompt ? 28 : 20,
              borderRadius: '50%',
              background: selected ? 'rgba(139,157,195,0.3)' : 'rgba(30,30,30,0.85)',
              border: selected ? '1.5px solid #8B9DC3' : '1px solid rgba(139,157,195,0.3)',
              backdropFilter: 'blur(4px)',
              transition: 'all 0.15s ease',
            }}
            className="nodrag nopan"
          >
            {icon}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/* ─── Custom node renderers ────────────────────────────────────────────── */

const HANDLE_STYLE: React.CSSProperties = {
  width: 16,
  height: 16,
  border: '3px solid #121212',
  borderRadius: '50%',
};

function AgentPaletteNode({ data }: NodeProps) {
  const nodeData = data as unknown as AgentNodeData;
  return (
    <div style={{
      padding: '8px 16px',
      background: 'rgba(139,157,195,0.10)',
      border: '1px solid rgba(139,157,195,0.25)',
      borderRadius: 10,
      minWidth: 120,
      textAlign: 'center',
    }}>
      <Handle type="target" position={Position.Top} style={{ ...HANDLE_STYLE, background: '#8B9DC3', top: -8 }} />
      <div style={{ fontSize: 13, fontWeight: 600, color: '#E5E5E5' }}>{nodeData.label}</div>
      <div style={{ fontSize: 11, color: '#A0A0A0' }}>{nodeData.agentType}</div>
      <Handle type="source" position={Position.Bottom} style={{ ...HANDLE_STYLE, background: '#8B9DC3', bottom: -8 }} />
    </div>
  );
}

function WorkflowBlockNodeComponent({ data }: NodeProps) {
  const nodeData = data as unknown as WorkflowBlockNodeData;
  return (
    <div style={{
      padding: '10px 16px',
      background: 'rgba(82, 196, 26, 0.08)',
      border: '1.5px dashed rgba(82, 196, 26, 0.4)',
      borderRadius: 10,
      minWidth: 140,
      textAlign: 'center',
      position: 'relative',
    }}>
      <Handle type="target" position={Position.Top} style={{ ...HANDLE_STYLE, background: '#52C41A', top: -8 }} />
      <div style={{ fontSize: 11, color: '#52C41A', marginBottom: 2 }}>工作流块</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#E5E5E5' }}>{nodeData.label}</div>
      <div style={{ fontSize: 11, color: '#A0A0A0', marginTop: 2 }}>
        {nodeData.childNodeIds.length} 个节点
      </div>
      <Handle type="source" position={Position.Bottom} style={{ ...HANDLE_STYLE, background: '#52C41A', bottom: -8 }} />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  agent: AgentPaletteNode,
  debate: DebateNodeComponent,
  'workflow-block': WorkflowBlockNodeComponent,
  input: InputNodeComponent,
  output: OutputNodeComponent,
};

const edgeTypes: EdgeTypes = {
  default: EdgeWithLabel,
};

/* ─── Public component ─────────────────────────────────────────────────── */

export interface WorkflowCanvasPanelProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  onNodesChange: OnNodesChange<WorkflowNode>;
  onEdgesChange: OnEdgesChange<WorkflowEdge>;
  onNodeClick: (event: React.MouseEvent, node: WorkflowNode) => void;
  onEdgeClick: (event: React.MouseEvent, edge: WorkflowEdge) => void;
  onPaneClick?: () => void;
  onConnect?: OnConnect;
  onDrop?: (event: React.DragEvent) => void;
  onDragOver?: (event: React.DragEvent) => void;
}

export default function WorkflowCanvasPanel({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  onConnect,
  onDrop,
  onDragOver,
}: WorkflowCanvasPanelProps) {
  // Stable no-op fallbacks so ReactFlow always has a callback to invoke,
  // even when the parent only wires the click handlers from the spec.
  const handlePaneClick = useCallback(() => {
    onPaneClick?.();
  }, [onPaneClick]);

  return (
    <ReactFlow
      nodes={nodes as unknown as Node[]}
      edges={edges as unknown as Edge[]}
      onNodesChange={onNodesChange as unknown as OnNodesChange}
      onEdgesChange={onEdgesChange as unknown as OnEdgesChange}
      onConnect={onConnect}
      onNodeClick={onNodeClick as unknown as (event: React.MouseEvent, node: Node) => void}
      onEdgeClick={onEdgeClick as unknown as (event: React.MouseEvent, edge: Edge) => void}
      onPaneClick={handlePaneClick}
      onDrop={onDrop}
      onDragOver={onDragOver}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={{
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#6B6B6B', strokeWidth: 2 },
      }}
      fitView
      style={{ width: '100%', height: '100%' }}
    >
      <Controls />
      <Background color="rgba(255,255,255,0.04)" gap={20} />
      <Panel position="top-left">
        <Typography.Text style={{ fontSize: 11, color: '#6B6B6B' }}>
          自动保存：每 30 秒
        </Typography.Text>
      </Panel>
    </ReactFlow>
  );
}

/* Re-export the local type so other modules in this package can stay
 * decoupled from the index barrel (e.g. for testing). */
export type { EdgePromptData };
