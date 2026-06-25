import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Typography, Progress, Tag, Spin, Alert } from 'antd';
import { ReactFlow, MiniMap, Background, BackgroundVariant, useNodesState, useEdgesState, type Node, type Edge, type NodeTypes, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useExecution } from '../hooks/useExecutions';
import { useWorkflow } from '../hooks/useWorkflows';
import type { NodeExec as ApiNodeExec } from '../domain/execution';
import { NODE_STATUS_CONFIG, type NodeStatusKey } from '../utils/statusConfig';
import NodeDataPanel from './NodeDataPanel';
import ExecutionTimeline from './ExecutionTimeline';

const { Title, Text } = Typography;

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Custom Node ────────────────────────────────────────────────────────────────
const WorkflowNode: React.FC<{ data: { exec: NodeExec; selected: boolean; onClick: () => void } }> = ({ data }) => {
  const { exec, selected, onClick } = data;
  const cfg = NODE_STATUS_CONFIG[exec.status] ?? NODE_STATUS_CONFIG.pending;
  const color = cfg.color;
  const IconComp = cfg.icon;

  return (
    <div
      onClick={onClick}
      style={{
        background: selected ? 'rgba(22, 119, 255, 0.12)' : 'rgba(10, 10, 20, 0.88)',
        border: `2px solid ${color}`,
        borderRadius: 10,
        padding: '10px 14px',
        minWidth: 160,
        cursor: 'pointer',
        boxShadow: selected ? `0 0 0 3px ${color}44, 0 4px 20px rgba(0,0,0,0.5)` : '0 2px 12px rgba(0,0,0,0.4)',
        transition: 'all 0.25s ease',
        position: 'relative',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: color, border: 'none', width: 8, height: 8 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconComp spin={exec.status === 'running'} style={{ color, fontSize: 14 }} />
        <span style={{ color: '#e8e8e8', fontSize: 13, fontWeight: 600, fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
          {exec.name}
        </span>
      </div>
      <Tag color={cfg.tag} style={{ marginTop: 6, marginBottom: 0, fontSize: 11, lineHeight: 1.4 }}>
        {exec.status.toUpperCase()}
      </Tag>
      <Handle type="source" position={Position.Right} style={{ background: color, border: 'none', width: 8, height: 8 }} />
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
interface Props {
  executionId?: string;
}

/**
 * Render the React Flow canvas for an execution. Lives in a child so the
 * `useWorkflow` hook can fire once the parent resolves the execution
 * envelope (we only know `workflow_id` after the first poll).
 */
function MonitorCanvas({
  workflowId,
  execNodes,
  selectedNodeId,
  onSelectNode,
}: {
  workflowId: string | null;
  execNodes: ApiNodeExec[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  // useWorkflow expects a workflow UUID (→ GET /workflows/{id}). The parent
  // passes the resolved workflow_id from the execution envelope; falling back
  // to a node_id here would 404 since the workflow router keys on workflow id.
  const { data: workflow } = useWorkflow(workflowId);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    if (execNodes.length === 0) return;
    const y0 = 50;
    const stepY = 120;
    const startX = 250;
    const wfNodes: Node[] = execNodes.map((n, i) => ({
      id: n.node_id,
      position: { x: startX, y: y0 + i * stepY },
      data: {
        exec: {
          id: n.node_id,
          name: n.agent,
          status: n.status,
          inputs: n.inputs,
          outputs: n.outputs,
          error: n.error,
          agentResponse: n.agent_response,
          startedAt: n.started_at,
          completedAt: n.completed_at,
        },
        selected: n.node_id === selectedNodeId,
        onClick: () => onSelectNode(n.node_id),
      },
      type: 'custom',
    }));
    setNodes(wfNodes);
  }, [execNodes, selectedNodeId, onSelectNode, setNodes]);

  useEffect(() => {
    if (!workflow) return;
    const wfEdges: Edge[] = (workflow.edges ?? []).map((e) => ({
      id: e.id ?? `${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      label: typeof e.label === 'string' ? e.label : undefined,
      animated: (execNodes.find((n) => n.node_id === e.target)?.status === 'running'),
      style: { stroke: '#3d5a80', strokeWidth: 2 },
      labelStyle: { fill: '#8a8a8a', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" },
    }));
    setEdges(wfEdges);
  }, [workflow, execNodes, setEdges]);

  const nodeTypes: NodeTypes = { custom: WorkflowNode };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      style={{ background: '#0d1117' }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#21262d" />
      <MiniMap
        style={{ background: '#161b22', border: '1px solid #21262d' }}
        nodeColor={(n) => {
          const nodeExec = (n.data as { exec: NodeExec }).exec;
          return NODE_STATUS_CONFIG[nodeExec.status]?.color ?? '#6B6B6B';
        }}
      />
    </ReactFlow>
  );
}

export default function WorkflowMonitor({ executionId: executionIdProp }: Props) {
  const { executionId: executionIdParam } = useParams<{ executionId: string }>();
  const executionId = executionIdProp ?? executionIdParam ?? undefined;

  // Hooks are unconditional — pass undefined to disable polling when no id.
  const {
    data: execution,
    loading: execLoading,
    error: execError,
  } = useExecution(executionId);

  // Workflow lookup for header name (separate from canvas edges).
  const { data: workflow } = useWorkflow(execution?.workflow_id ?? null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [view, setView] = useState<'dag' | 'timeline'>('dag');

  // Merge nodes from execution envelope (timeline data now lives in
  // getExecution().nodes after the P2-T3 endpoint consolidation).
  const execNodes: ApiNodeExec[] = useMemo(() => {
    return execution?.nodes ?? [];
  }, [execution]);

  if (!executionId) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="info" message="No execution selected. Pass an executionId prop to view workflow progress." />
      </div>
    );
  }

  if (execLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" tip="Loading workflow..." />
      </div>
    );
  }

  if (execError || !execution) {
    return <Alert type="error" message={execError?.message ?? 'Execution not found'} />;
  }

  // Progress
  const totalNodes = execNodes.length;
  const completedNodes = execNodes.filter(
    (n) => n.status === 'completed' || n.status === 'skipped' || n.status === 'failed',
  ).length;
  const progressPct = totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0;

  // Elapsed / eta
  const startedAt = execution.started_at ? new Date(execution.started_at) : null;
  const elapsedMs = startedAt ? Date.now() - startedAt.getTime() : 0;
  const elapsedStr = formatDuration(elapsedMs);
  const estRemaining = elapsedMs > 0 && progressPct > 0
    ? formatDuration(Math.round((elapsedMs / progressPct) * (100 - progressPct)))
    : '--';

  const selectedNode: NodeExec | null = selectedNodeId
    ? (() => {
        const n = execNodes.find((x) => x.node_id === selectedNodeId);
        if (!n) return null;
        return {
          id: n.node_id,
          name: n.agent,
          status: n.status,
          inputs: n.inputs,
          outputs: n.outputs,
          error: n.error,
          agentResponse: n.agent_response,
          startedAt: n.started_at,
          completedAt: n.completed_at,
        };
      })()
    : null;

  const execName = execution.workflow_name ?? workflow?.name ?? '';
  const execStatus = execution.status;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', gap: 0, background: '#0d1117', borderRadius: 8, overflow: 'hidden' }}>
      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Header bar */}
        <div style={{
          padding: '12px 20px',
          borderBottom: '1px solid #21262d',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          background: '#161b22',
        }}>
          <div style={{ flex: 1 }}>
            <Title level={4} style={{ color: '#e6edf3', margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>
              {execName || `Execution ${execution.id}`}
            </Title>
            <Text style={{ color: '#8b949e', fontSize: 12 }}>ID: {execution.id}</Text>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag color={({ pending: 'default', running: 'processing', completed: 'success', failed: 'error', cancelled: 'warning', cleaned_up: '#9e9e9e', skipped: '#ff9800' })[execStatus]}>
              {execStatus.toUpperCase()}
            </Tag>
          </div>

          <div style={{ minWidth: 200 }}>
            <Text style={{ color: '#8b949e', fontSize: 12 }}>Progress</Text>
            <Progress percent={progressPct} size="small" strokeColor="#58a6ff" trailColor="#21262d" />
          </div>

          <div style={{ textAlign: 'right' }}>
            <Text style={{ color: '#8b949e', fontSize: 11 }}>Elapsed</Text>
            <div style={{ color: '#e6edf3', fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>{elapsedStr}</div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <Text style={{ color: '#8b949e', fontSize: 11 }}>Est. Remaining</Text>
            <div style={{ color: '#e6edf3', fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>{estRemaining}</div>
          </div>

          <div style={{ display: 'flex', gap: 4 }}>
            <Tag color={view === 'dag' ? 'blue' : 'default'} onClick={() => setView('dag')} style={{ cursor: 'pointer' }}>DAG</Tag>
            <Tag color={view === 'timeline' ? 'blue' : 'default'} onClick={() => setView('timeline')} style={{ cursor: 'pointer' }}>Timeline</Tag>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, position: 'relative' }}>
          {view === 'dag' ? (
            <MonitorCanvas
              workflowId={execution.workflow_id ?? null}
              execNodes={execNodes}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
            />
          ) : (
            <ExecutionTimeline nodes={execNodes.map((n) => ({
              id: n.node_id,
              name: n.agent,
              status: n.status,
              inputs: n.inputs,
              outputs: n.outputs,
              error: n.error,
              agentResponse: n.agent_response,
              startedAt: n.started_at,
              completedAt: n.completed_at,
            }))} />
          )}
        </div>
      </div>

      {/* Side panel */}
      {selectedNode && (
        <NodeDataPanel
          node={selectedNode}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 0) return '--';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
