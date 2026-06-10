import { useCallback, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type OnConnect,
  type Node,
  type Edge,
  ConnectionMode,
  useOnSelectionChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Card, Empty, Tooltip, Button, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

import AgentNode from './nodes/AgentNode';
import DebateNode from './nodes/DebateNode';
import InputNode from './nodes/InputNode';
import OutputNode from './nodes/OutputNode';
import type { AgentNodeData } from './nodes/AgentNode';
import type { DebateNodeData } from './nodes/DebateNode';
import type { InputNodeData } from './nodes/InputNode';
import type { OutputNodeData } from './nodes/OutputNode';
import SessionBoundarySelector from './SessionBoundarySelector';
import type { SessionBoundary } from './useSessionBoundary';

export type WorkflowNode = Node<AgentNodeData | DebateNodeData | InputNodeData | OutputNodeData>;

const nodeTypes = {
  agentNode: AgentNode,
  debateNode: DebateNode,
  inputNode: InputNode,
  outputNode: OutputNode,
};

const agentPalette = [
  { type: 'agentNode', label: 'Macro Scout', agentType: 'macro-scout', icon: '🌐' },
  { type: 'agentNode', label: 'Sector Rotator', agentType: 'sector-rotator', icon: '📊' },
  { type: 'agentNode', label: 'Sentiment Decoder', agentType: 'sentiment-decoder', icon: '📰' },
  { type: 'agentNode', label: 'Technical Chartist', agentType: 'technical-chartist', icon: '📈' },
  { type: 'agentNode', label: 'Fundamental Auditor', agentType: 'fundamental-auditor', icon: '🔍' },
  { type: 'agentNode', label: 'Smart Money Hound', agentType: 'smart-money-hound', icon: '🐾' },
  { type: 'agentNode', label: 'Risk Gatekeeper', agentType: 'risk-gatekeeper', icon: '🛡️' },
  { type: 'debateNode', label: 'Debate Block', agentType: 'debate', icon: '⚔️' },
];

const initialNodes: WorkflowNode[] = [
  {
    id: 'input-1',
    type: 'inputNode',
    position: { x: 50, y: 200 },
    data: { label: 'Market Query', value: '' },
  },
  {
    id: 'agent-1',
    type: 'agentNode',
    position: { x: 300, y: 150 },
    data: { label: 'Macro Scout', agentType: 'macro-scout', status: 'idle' },
  },
  {
    id: 'agent-2',
    type: 'agentNode',
    position: { x: 300, y: 280 },
    data: { label: 'Sector Rotator', agentType: 'sector-rotator', status: 'idle' },
  },
  {
    id: 'output-1',
    type: 'outputNode',
    position: { x: 550, y: 200 },
    data: { label: 'Analysis Result' },
  },
];

const initialEdges: Edge[] = [
  { id: 'e-input-agent1', source: 'input-1', target: 'agent-1', type: 'smoothstep' },
  { id: 'e-input-agent2', source: 'input-1', target: 'agent-2', type: 'smoothstep' },
  { id: 'e-agent1-output', source: 'agent-1', target: 'output-1', type: 'smoothstep' },
  { id: 'e-agent2-output', source: 'agent-2', target: 'output-1', type: 'smoothstep' },
];

const WorkflowCanvas = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [sessionBoundaries, setSessionBoundaries] = useState<SessionBoundary[]>([]);

  const handleBoundaryCreated = useCallback((boundary: SessionBoundary) => {
    setSessionBoundaries((prev) => [...prev, boundary]);
    // Optionally update node data to reflect the boundary
    setNodes((nds) =>
      nds.map((n) =>
        boundary.nodeIds.includes(n.id)
          ? { ...n, data: { ...n.data, sessionBoundaryId: boundary.id, sessionBoundaryColor: boundary.color } }
          : n,
      ),
    );
  }, [setNodes]);

  const onSelectionChange = useCallback(({ nodes: selectedNodes }: { nodes: Node[] }) => {
    // Could be used to track selection or update UI
  }, []);

  const onConnect: OnConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, type: 'smoothstep' }, eds)),
    [setEdges],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const dataStr = event.dataTransfer.getData('application/reactflow');
      if (!dataStr) return;

      try {
        const { type, label, agentType } = JSON.parse(dataStr);
        const position = {
          x: event.clientX - 400,
          y: event.clientY - 100,
        };

        const newNode: WorkflowNode = {
          id: `${type}-${Date.now()}`,
          type,
          position,
          data: { label, agentType, status: 'idle' },
        };

        setNodes((nds) => [...nds, newNode]);
      } catch {
        // ignore invalid drops
      }
    },
    [setNodes],
  );

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: WorkflowNode) => {
      const newPrompt = window.prompt('Edit agent prompt:', (node.data as AgentNodeData).prompt || '');
      if (newPrompt !== null) {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === node.id ? { ...n, data: { ...n.data, prompt: newPrompt } } : n,
          ),
        );
      }
    },
    [setNodes],
  );

  // Track selection via React Flow's built-in selection mechanism
  useOnSelectionChange({ onChange: onSelectionChange });

  const nodeColor = useCallback((node: WorkflowNode) => {
    const boundary = sessionBoundaries.find((b) => b.nodeIds.includes(node.id));
    if (boundary) {
      return boundary.color;
    }
    switch (node.type) {
      case 'agentNode':
        return 'rgba(139, 157, 195, 0.3)';
      case 'debateNode':
        return 'rgba(184, 160, 204, 0.3)';
      case 'inputNode':
        return 'rgba(139, 157, 195, 0.2)';
      case 'outputNode':
        return 'rgba(107, 142, 123, 0.3)';
      default:
        return '#222222';
    }
  }, [sessionBoundaries]);

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%' }}>
      <div
        style={{
          width: 240,
          background: '#1A1A1A',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          padding: 16,
          overflowY: 'auto',
        }}
      >
        <div style={{ marginBottom: 16, fontWeight: 600, fontSize: 14, color: '#E5E5E5' }}>
          Agent Palette
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {agentPalette.map((agent) => (
            <div
              key={`${agent.type}-${agent.label}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/reactflow', JSON.stringify(agent));
                e.dataTransfer.effectAllowed = 'move';
              }}
              style={{
                padding: '10px 12px',
                background: 'rgba(139,157,195,0.08)',
                border: '1px solid rgba(139,157,195,0.18)',
                borderRadius: 8,
                cursor: 'grab',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                color: '#E5E5E5',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(139,157,195,0.14)';
                e.currentTarget.style.borderColor = 'rgba(139,157,195,0.28)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(139,157,195,0.08)';
                e.currentTarget.style.borderColor = 'rgba(139,157,195,0.18)';
              }}
            >
              <span style={{ fontSize: 16 }}>{agent.icon}</span>
              <span style={{ flex: 1 }}>{agent.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onNodeDoubleClick={onNodeDoubleClick}
          nodeTypes={nodeTypes}
          connectionMode={ConnectionMode.Loose}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          style={{ background: '#121212' }}
        >
          <Background gap={20} size={1} color="rgba(255,255,255,0.04)" />
          <Controls position="bottom-left" />
          <MiniMap
            nodeColor={nodeColor}
            nodeStrokeWidth={3}
            pannable
            zoomable
            position="top-right"
            style={{ background: '#1A1A1A' }}
          />
          <SessionBoundarySelector
            onBoundaryCreated={handleBoundaryCreated}
            nodes={nodes}
          />
        </ReactFlow>
      </div>
    </div>
  );
};

export default WorkflowCanvas;

export { nodeTypes };