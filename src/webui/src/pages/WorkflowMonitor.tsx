import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Typography, Card, Progress, Tag, Spin, Alert, Tooltip, Badge } from 'antd';
import { ReactFlow, MiniMap, Background, BackgroundVariant, useNodesState, useEdgesState, type Node, type Edge, type NodeTypes, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { getExecution, getExecutionTimeline } from '../api/executions';
import { getWorkflow } from '../api/workflows';
import type { Execution, TimelineResponse, NodeExec as ApiNodeExec } from '../types/execution';
import type { Workflow } from '../types/workflow';
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

interface WorkflowExec {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  nodes: NodeExec[];
  edges: { id: string; source: string; target: string; label?: string }[];
  startedAt: string;
  completedAt?: string;
  estimatedMs?: number;
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

export default function WorkflowMonitor({ executionId: executionIdProp }: Props) {
  const { executionId: executionIdParam } = useParams<{ executionId: string }>();
  const executionId = executionIdProp ?? executionIdParam ?? undefined;

  const [exec, setExec] = useState<WorkflowExec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [view, setView] = useState<'dag' | 'timeline'>('dag');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cache workflow data (edges don't change between polls)
  const workflowCacheRef = useRef<Workflow | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!executionId) return;
    try {
      // Fetch execution + timeline in parallel
      const [execution, timeline] = await Promise.all([
        getExecution(executionId) as Promise<Execution>,
        getExecutionTimeline(executionId) as Promise<TimelineResponse>,
      ]);

      // Fetch workflow only once (edges are static)
      if (!workflowCacheRef.current) {
        workflowCacheRef.current = await getWorkflow(execution.workflow_id) as Workflow;
      }
      const workflow = workflowCacheRef.current;

      // Merge timeline nodes + workflow edges into the local WorkflowExec shape
      const nodes: NodeExec[] = timeline.nodes.map((n: ApiNodeExec) => ({
        id: n.node_id,
        name: n.agent,
        status: n.status,
        inputs: n.inputs,
        outputs: n.outputs,
        error: n.error,
        agentResponse: n.agent_response,
        startedAt: n.started_at,
        completedAt: n.completed_at,
      }));

      const edges = (workflow.edges ?? []).map((e) => ({
        id: e.id ?? `${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        label: typeof e.label === 'string' ? e.label : undefined,
      }));

      const merged: WorkflowExec = {
        id: execution.id,
        name: (execution as Execution & { workflow_name?: string }).workflow_name ?? workflow.name ?? '',
        status: execution.status as WorkflowExec['status'],
        nodes,
        edges,
        startedAt: execution.started_at,
        completedAt: execution.ended_at,
        estimatedMs: execution.duration_ms,
      };

      setExec(merged);
      setError(null);
    } catch (err: unknown) {
      // non-fatal on subsequent polls
    }
  }, [executionId]);

  useEffect(() => {
    if (!executionId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchStatus()
      .finally(() => setLoading(false));

    pollingRef.current = setInterval(fetchStatus, 2000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [executionId, fetchStatus]);

  // Derive nodes/edges for ReactFlow
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    if (!exec) return;
    const y0 = 50;
    const stepY = 120;
    const startX = 250;
    const wfNodes: Node[] = exec.nodes.map((n, i) => ({
      id: n.id,
      position: { x: startX, y: y0 + i * stepY },
      data: { exec: n, selected: n.id === selectedNodeId, onClick: () => setSelectedNodeId(n.id) },
      type: 'custom',
    }));
    const wfEdges: Edge[] = exec.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: (exec.nodes.find((n) => n.id === e.source)?.status === 'running'),
      style: { stroke: '#3d5a80', strokeWidth: 2 },
      labelStyle: { fill: '#8a8a8a', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" },
    }));
    setNodes(wfNodes as Node[]);
    setEdges(wfEdges as Edge[]);
  }, [exec, selectedNodeId, setNodes, setEdges]);

  const nodeTypes: NodeTypes = { custom: WorkflowNode };

  // Progress
  const totalNodes = exec?.nodes.length ?? 0;
  const completedNodes = exec?.nodes.filter((n) => n.status === 'completed' || n.status === 'skipped' || n.status === 'failed').length ?? 0;
  const progressPct = totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0;

  // Elapsed / eta
  const startedAt = exec?.startedAt ? new Date(exec.startedAt) : null;
  const elapsedMs = startedAt ? Date.now() - startedAt.getTime() : 0;
  const elapsedStr = formatDuration(elapsedMs);
  const estRemaining = elapsedMs > 0 && progressPct > 0
    ? formatDuration(Math.round((elapsedMs / progressPct) * (100 - progressPct)))
    : '--';

  const selectedNode = exec?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  if (!executionId) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="info" message="No execution selected. Pass an executionId prop to view workflow progress." />
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" tip="Loading workflow..." />
      </div>
    );
  }

  if (error) {
    return <Alert type="error" message={error} />;
  }

  if (!exec) return null;

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
              {exec.name || `Execution ${executionId}`}
            </Title>
            <Text style={{ color: '#8b949e', fontSize: 12 }}>ID: {executionId}</Text>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag color={exec.status === 'running' ? 'processing' : exec.status === 'completed' ? 'success' : 'error'}>
              {exec.status.toUpperCase()}
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
          ) : (
            <ExecutionTimeline nodes={exec.nodes} />
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