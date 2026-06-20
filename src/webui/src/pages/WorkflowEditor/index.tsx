/**
 * WorkflowEditor (orchestrator) — `/pages/WorkflowEditor/index.tsx`
 *
 * Top-level container for the workflow DAG editor. Owns the editor's
 * state (nodes / edges / selections / autosave timer) and wires the
 * three panels (palette / canvas / inspector) together.
 *
 * Sibling tasks
 * -------------
 * - 6.3b: extracts the inspector property panels into `NodeInspector.tsx`
 * + 5 property-panel files. The current inspector is a shim that
 * surfaces the selected node / edge id so the user can verify selection
 * state, but the property editors themselves live in the legacy
 * `pages/WorkflowEditor.tsx` for now.
 * - 6.3c: extracts the 2 modals (Settings, BlockSelector) below into
 * dedicated files, creates 3 hooks, deletes the legacy
 * `pages/WorkflowEditor.tsx`, and rewires `App.tsx` to import the
 * barrel `./pages/WorkflowEditor` (i.e. this file).
 *
 * Auto-save
 * ---------
 * A `setInterval` fires every 30 s. If `isDirty.current === true` AND the
 * route is an existing workflow (not `/workflows/new/edit`), `handleSave`
 * is invoked with `isAuto=true` — that suppresses the success toast and
 * the navigate-to-new-id branch (which only matters on the "new" path).
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { Typography, Button, Space, Spin, Alert, message, Modal } from 'antd';
import {
  SaveOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  ArrowLeftOutlined,
  BlockOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import {
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
} from '@xyflow/react';

import { useAgents } from '../../hooks/useAgents';
import {
  useWorkflow,
  useCreateWorkflow,
  useUpdateWorkflow,
  useTriggerWorkflow,
} from '../../hooks/useWorkflows';
import { WorkflowProvider, useWorkflowContext } from './WorkflowContext';

import AgentPalettePanel, {
  type PaletteAgent,
  type PaletteWorkflowBlock,
} from './AgentPalettePanel';
import WorkflowCanvasPanel from './WorkflowCanvasPanel';
import NodeInspector from './NodeInspector';
import WorkflowSettingsModal from './WorkflowSettingsModal';

/* ─── Domain types (ReactFlow-specific, editor-only) ──────────────────── */

export type PromptType = 'context' | 'instruction' | 'constraint' | 'data';

export interface EdgePromptData {
  prompt: string;
  promptType: PromptType;
  [key: string]: unknown;
}

export type WorkflowEdge = Edge<EdgePromptData>;

export interface AgentNodeData {
  label: string;
  agentType: string;
  prompt?: string;
  parameters?: Record<string, string>;
  tools?: string[];
  inputs: Record<string, string>;
  [key: string]: unknown;
}

export type AgentNode = Node<AgentNodeData, 'agent'>;

export interface DebateNodeData {
  label: string;
  agents: string[];
  judge: string;
  prompt: string;
  [key: string]: unknown;
}

export type DebateNode = Node<DebateNodeData, 'debate'>;

export interface WorkflowBlockNodeData {
  label: string;
  workflowId: string;
  workflowName: string;
  childNodeIds: string[];
  inputs: Record<string, string>;
  [key: string]: unknown;
}

export type WorkflowBlockNode = Node<WorkflowBlockNodeData, 'workflow-block'>;

import type { InputNodeData } from '../../components/workflow/nodes/InputNode';
import type { OutputNodeData } from '../../components/workflow/nodes/OutputNode';

export type InputNode = Node<InputNodeData, 'input'>;
export type OutputNode = Node<OutputNodeData, 'output'>;

export type WorkflowNode =
  | AgentNode
  | DebateNode
  | WorkflowBlockNode
  | InputNode
  | OutputNode;

/* ─── Orchestrator ─────────────────────────────────────────────────────── */

export default function WorkflowEditor() {
  return (
    <WorkflowProvider>
      <WorkflowEditorInner />
    </WorkflowProvider>
  );
}

function WorkflowEditorInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowEdge>([]);

  const { data: workflow, loading: workflowLoading, error: workflowError } =
    useWorkflow(id ?? null);

  // Selection state — owned by the React Context (WorkflowProvider).
  const { selectedNodeId, setSelectedNode, selectedEdgeId, setSelectedEdge } = useWorkflowContext();
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(workflowError?.message ?? null);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [workflowName, setWorkflowName] = useState('');
  const [blockSelectorVisible, setBlockSelectorVisible] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const isDirty = useRef(false);

  // Real agents from the registry. Built-ins are merged in the palette
  // panel itself, so the orchestrator only owns the API-backed slice.
  const { data: agentsData } = useAgents();
  const paletteAgents: PaletteAgent[] = (agentsData ?? [])
    .filter((a) => a.name !== 'fin-orchestrator')
    .map((a) => ({
      type: a.name,
      label: a.name,
      description: a.description,
    }));

  // Hydrate local state from the typed fetch.
  useEffect(() => {
    if (id === 'new' || id === undefined) {
      setNodes([]);
      setEdges([]);
      setWorkflowName('新建工作流');
      return;
    }
    if (!workflow) return;
    // Deduplicate nodes by id (safety net for legacy data with duplicates)
    const rawNodes = (workflow.nodes ?? []) as unknown as WorkflowNode[];
    const seenIds = new Set<string>();
    const dedupedNodes = rawNodes.filter((n) => {
      if (seenIds.has(n.id)) return false;
      seenIds.add(n.id);
      return true;
    });
    setNodes(dedupedNodes);
    setEdges((workflow.edges ?? []) as unknown as WorkflowEdge[]);
    setWorkflowName(workflow.name ?? 'Workflow');
  }, [workflow, id, setNodes, setEdges]);

  // 30 s auto-save. Re-establishes the timer whenever the route id
  // changes (so navigating between workflows resets the cycle).
  useEffect(() => {
    if (autoSaveTimer.current) clearInterval(autoSaveTimer.current);
    autoSaveTimer.current = setInterval(() => {
      if (isDirty.current && id && id !== 'new') {
        handleSave(true);
      }
    }, 30000);
    return () => {
      if (autoSaveTimer.current) clearInterval(autoSaveTimer.current);
    };
    // `handleSave` reads current closure values via refs/state — re-
    // establishing the timer on `id` change is the public re-run knob.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const createMut = useCreateWorkflow();
  const updateMut = useUpdateWorkflow();
  const triggerMut = useTriggerWorkflow();

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#6B6B6B', strokeWidth: 2 },
            data: { prompt: '', promptType: 'context' as PromptType },
          },
          eds,
        ),
      ),
    [setEdges],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: WorkflowNode) => {
      setSelectedNode(node.id);
      setSelectedEdge(null);
    },
    [setSelectedNode, setSelectedEdge],
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: WorkflowEdge) => {
      setSelectedEdge(edge.id);
      setSelectedNode(null);
    },
    [setSelectedEdge, setSelectedNode],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, [setSelectedNode, setSelectedEdge]);

  const onUpdateNode = useCallback(
    (nodeId: string, data: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          return { ...n, data: { ...n.data, ...data } } as WorkflowNode;
        }),
      );
      isDirty.current = true;
    },
    [setNodes],
  );

  const onDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNode(null);
      isDirty.current = true;
    },
    [setNodes, setEdges, setSelectedNode],
  );

  const onUpdateEdge = useCallback(
    (edgeId: string, data: Record<string, unknown>) => {
      setEdges((eds) =>
        eds.map((e) => {
          if (e.id !== edgeId) return e;
          return { ...e, data: { ...e.data, ...data } } as WorkflowEdge;
        }),
      );
      isDirty.current = true;
    },
    [setEdges],
  );

  const onCloseEdge = useCallback(() => {
    setSelectedEdge(null);
  }, [setSelectedEdge]);

  const onDeleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      setSelectedEdge(null);
      isDirty.current = true;
    },
    [setEdges, setSelectedEdge],
  );

  const onDeleteBlock = useCallback(
    (blockId: string) => {
      const block = nodes.find((n) => n.id === blockId) as WorkflowBlockNode | undefined;
      const childIds = new Set(block?.data?.childNodeIds ?? []);
      setNodes((nds) => nds.filter((n) => n.id !== blockId && !childIds.has(n.id)));
      setEdges((eds) =>
        eds.filter((e) => e.source !== blockId && e.target !== blockId && !childIds.has(e.source) && !childIds.has(e.target)),
      );
      setSelectedNode(null);
      isDirty.current = true;
    },
    [nodes, setNodes, setEdges, setSelectedNode],
  );

  const onUngroupBlock = useCallback(
    (blockId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== blockId));
      setEdges((eds) => eds.filter((e) => e.source !== blockId && e.target !== blockId));
      setSelectedNode(null);
      isDirty.current = true;
    },
    [setNodes, setEdges, setSelectedNode],
  );

  const handleSave = async (isAuto = false) => {
    if (!id || id === 'new') {
      try {
        setSaving(true);
        const created = await createMut.mutate({
          name: workflowName,
          nodes: nodes as unknown as Parameters<typeof createMut.mutate>[0]['nodes'],
          edges: edges as unknown as Parameters<typeof createMut.mutate>[0]['edges'],
        });
        if (!isAuto) message.success('工作流已创建');
        isDirty.current = false;
        navigate(`/workflows/${created.id}/edit`);
      } catch {
        if (!isAuto) message.error('创建工作流失败');
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      setSaving(true);
      await updateMut.mutate({
        id,
        data: {
          nodes: nodes as unknown as Parameters<typeof updateMut.mutate>[0]['data']['nodes'],
          edges: edges as unknown as Parameters<typeof updateMut.mutate>[0]['data']['edges'],
          name: workflowName,
        },
      });
      if (!isAuto) message.success('工作流已保存');
      isDirty.current = false;
    } catch {
      if (!isAuto) message.error('保存工作流失败');
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    try {
      if (id && id !== 'new') await handleSave(true);
      await triggerMut.mutate({ id: id!, params: {} });
      message.success('工作流已启动');
    } catch {
      message.error('运行工作流失败');
    }
  };

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handlePaletteDragStart = useCallback(
    (agentType: string) => (event: React.DragEvent) => {
      event.dataTransfer.setData('application/reactflow', agentType);
      event.dataTransfer.effectAllowed = 'move';
    },
    [],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const agentType = event.dataTransfer.getData('application/reactflow');
      if (!agentType) return;
      const position = { x: event.clientX - 280, y: event.clientY - 60 };
      const builtins: PaletteAgent[] = [
        { type: 'input', label: '输入节点', description: '工作流入口' },
        { type: 'output', label: '输出节点', description: '工作流出口' },
        { type: 'debate', label: '辩论块', description: '多Agent辩论+裁判' },
      ];
      const allPalette = [...builtins, ...paletteAgents];
      const agent = allPalette.find((a) => a.type === agentType);

      if (agentType === 'debate') {
        const newNode: DebateNode = {
          id: `debate-${Date.now()}`,
          type: 'debate',
          position,
          data: { label: 'Debate', agents: [], judge: '', prompt: '' },
        };
        setNodes((nds) => [...nds, newNode]);
      } else if (agentType === 'input') {
        const newNode: InputNode = {
          id: `input-${Date.now()}`,
          type: 'input',
          position,
          data: { label: '输入', params: [] },
        };
        setNodes((nds) => [...nds, newNode]);
      } else if (agentType === 'output') {
        const newNode: OutputNode = {
          id: `output-${Date.now()}`,
          type: 'output',
          position,
          data: { label: '输出', outputKey: '' },
        };
        setNodes((nds) => [...nds, newNode]);
      } else {
        const newNode: AgentNode = {
          id: `${agentType}-${Date.now()}`,
          type: 'agent',
          position,
          data: { label: agent?.label ?? agentType, agentType, inputs: {} },
          agent: agentType,
        } as AgentNode;
        setNodes((nds) => [...nds, newNode]);
      }
      isDirty.current = true;
    },
    [setNodes, paletteAgents],
  );

  // Surface fetch errors from the typed `useWorkflow` hook.
  useEffect(() => {
    if (workflowError) setError(workflowError.message);
  }, [workflowError]);

  if (workflowLoading && id && id !== 'new') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  // Surface workflow-block nodes for the palette's "Reuse" list.
  const workflowBlocks: PaletteWorkflowBlock[] = (nodes as WorkflowNode[])
    .filter((n): n is WorkflowBlockNode => n.type === 'workflow-block')
    .map((b) => ({
      id: b.id,
      workflowName: b.data.workflowName,
      childNodeIds: b.data.childNodeIds,
    }));

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 52px)',
        width: '100%',
      }}
    >
      {/* Top Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: '#1A1A1A',
        }}
      >
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/workflows')}>
            返回
          </Button>
          <Typography.Text strong style={{ fontSize: 16, color: '#E5E5E5' }}>
            {workflowName}
          </Typography.Text>
        </Space>
        <Space>
          <Button icon={<SettingOutlined />} onClick={() => setSettingsVisible(true)}>
            设置
          </Button>
          <Button icon={<SaveOutlined />} onClick={() => handleSave(false)} loading={saving}>
            保存
          </Button>
          <Button
            icon={<PlayCircleOutlined />}
            type="primary"
            onClick={handleRun}
            loading={triggerMut.loading}
          >
            运行
          </Button>
        </Space>
      </div>

      {error && (
        <Alert
          type="error"
          message="加载工作流失败"
          description={error}
          showIcon
          closable
          onClose={() => setError(null)}
          style={{ margin: '8px 16px' }}
        />
      )}

      {/* 3-Panel Layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left: Agent Palette */}
        <div
          style={{
            width: 240,
            borderRight: '1px solid rgba(255,255,255,0.06)',
            background: '#1A1A1A',
            overflowY: 'auto',
            padding: 16,
          }}
        >
          <AgentPalettePanel
            paletteAgents={paletteAgents}
            onDragStart={handlePaletteDragStart}
            workflowBlocks={workflowBlocks}
            onSelectBlock={(blockId) => {
              setSelectedNode(blockId);
              setSelectedEdge(null);
            }}
            onOpenBlockSelector={() => setBlockSelectorVisible(true)}
          />
        </div>

        {/* Center: React Flow canvas */}
        <div
          style={{ flex: 1, background: '#121212' }}
          onDrop={onDrop}
          onDragOver={onDragOver}
        >
          <WorkflowCanvasPanel
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
          />
        </div>

        {/* Right: Inspector — NodeInspector routes to the correct
            property panel based on selected node/edge type. */}
        <div
          style={{
            width: 260,
            borderLeft: '1px solid rgba(255,255,255,0.06)',
            background: '#1A1A1A',
            overflowY: 'auto',
          }}
        >
          <NodeInspector
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            onUpdateNode={onUpdateNode}
            onDeleteNode={onDeleteNode}
            onDeleteEdge={onDeleteEdge}
            onDeleteBlock={onDeleteBlock}
            onUngroupBlock={onUngroupBlock}
            onUpdateEdge={onUpdateEdge as (edgeId: string, data: Record<string, unknown>) => void}
            onCloseEdge={onCloseEdge}
            agents={paletteAgents}
          />
        </div>
      </div>

      {/* Modal 1: Settings */}
      <WorkflowSettingsModal
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        workflowId={id ?? 'new'}
        initialName={workflowName}
        initialTriggerType={workflow?.trigger_type ?? 'manual'}
        initialCronExpression={(workflow?.config?.cron_expression as string) ?? ''}
        initialCommandString={(workflow?.config?.command_string as string) ?? ''}
        onSaved={(next) => {
          setWorkflowName(next.name);
        }}
      />

      {/* Modal 2: BlockSelector ( replaces with the extracted
          full implementation). */}
      <BlockSelectorModalShell
        visible={blockSelectorVisible}
        onClose={() => setBlockSelectorVisible(false)}
        currentWorkflowId={id}
      />
    </div>
  );
}

/* ─── Modal shells ( target) ────────────────────────────────────
 *
 * The full implementation of BlockSelector (search/import flow) lives in the
 * legacy `pages/WorkflowEditor.tsx` and will be extracted into a dedicated
 * file by 6.3c. The shell below exists so the orchestrator can render the
 * modal slot today and 6.3c can swap it in place.
 */

interface BlockSelectorModalShellProps {
  visible: boolean;
  onClose: () => void;
  currentWorkflowId?: string;
}

function BlockSelectorModalShell({ visible, onClose, currentWorkflowId }: BlockSelectorModalShellProps) {
  return (
    <Modal
      title={
        <Space>
          <BlockOutlined style={{ color: '#52C41A' }} />
          <span>选择要导入的工作流</span>
        </Space>
      }
      open={visible}
      onCancel={onClose}
      footer={null}
      width={560}
      destroyOnClose
    >
      <div style={{ padding: '24px 0', color: '#A0A0A0', fontSize: 13 }}>
        当前工作流：{currentWorkflowId ?? 'new'} — 完整实现在 中提取。
      </div>
    </Modal>
  );
}

/* Re-export the shared palette types so sibling 6.3b/6.3c and any
 * downstream consumer can import everything from the barrel. */
export type { PaletteAgent, PaletteWorkflowBlock } from './AgentPalettePanel';
