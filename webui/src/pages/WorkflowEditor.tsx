import { useEffect, useState, useCallback, useRef } from 'react';
import { Typography, Button, Space, Spin, Alert, message, Modal, Form, Input, Select, Popconfirm, Tag } from 'antd';
import { SaveOutlined, PlayCircleOutlined, SettingOutlined, ArrowLeftOutlined, DeleteOutlined, PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Node,
  Edge,
  Panel,
  NodeTypes,
  Handle,
  Position,
  EdgeLabelRenderer,
  BaseEdge,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import DebateNodeComponent from '../components/workflow/nodes/DebateNode';

// --- Edge Data Types ---
type PromptType = 'context' | 'instruction' | 'constraint' | 'data';

interface EdgePromptData {
  prompt: string;
  promptType: PromptType;
  [key: string]: unknown;
}

type WorkflowEdge = Edge<EdgePromptData>;

const PROMPT_TYPE_OPTIONS: Array<{ label: string; value: PromptType; icon: string }> = [
  { label: '上下文信息', value: 'context', icon: '📝' },
  { label: '执行指令', value: 'instruction', icon: '⚡' },
  { label: '约束条件', value: 'constraint', icon: '🔒' },
  { label: '数据传递', value: 'data', icon: '📊' },
];

const PROMPT_TYPE_ICONS: Record<PromptType, string> = {
  context: '📝',
  instruction: '⚡',
  constraint: '🔒',
  data: '📊',
};

// --- Agent Node Data ---
interface AgentNodeData {
  label: string;
  agentType: string;
  prompt?: string;
  parameters?: Record<string, string>;
  tools?: string[];
  inputs: Record<string, string>;
  [key: string]: unknown;
}

export type AgentNode = Node<AgentNodeData, 'agent'>;

// --- Debate Node Data ---
interface DebateNodeData {
  label: string;
  agents: string[];
  judge: string;
  prompt: string;
  [key: string]: unknown;
}

export type DebateNode = Node<DebateNodeData, 'debate'>;

type WorkflowNode = AgentNode | DebateNode;

// --- Agent Palette Node Component ---
function AgentPaletteNode({ data }: { data: AgentNodeData }) {
  return (
    <div style={{
      padding: '8px 16px',
      background: 'rgba(139,157,195,0.10)',
      border: '1px solid rgba(139,157,195,0.25)',
      borderRadius: 10,
      minWidth: 120,
      textAlign: 'center',
    }}>
      <Handle type="target" position={Position.Top} style={{ background: '#8B9DC3' }} />
      <div style={{ fontSize: 13, fontWeight: 600, color: '#E5E5E5' }}>{data.label}</div>
      <div style={{ fontSize: 11, color: '#A0A0A0' }}>{data.agentType}</div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#8B9DC3' }} />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  agent: AgentPaletteNode,
  debate: DebateNodeComponent,
};

const edgeTypes = {
  default: EdgeWithLabel,
};

// --- Agent Palette ---
const PALETTE_AGENTS = [
  { type: 'macro-scout', label: '宏观侦察员', description: '判断天时' },
  { type: 'sector-rotator', label: '板块轮动雷达', description: '判断地利' },
  { type: 'sentiment-decoder', label: '新闻情绪解码器', description: '捕捉人和' },
  { type: 'technical-chartist', label: '技术形态绘图师', description: '判断时机' },
  { type: 'fundamental-auditor', label: '基本面估值审计师', description: '判断质地' },
  { type: 'smart-money-hound', label: '聪明钱追踪犬', description: '判断主力' },
  { type: 'risk-gatekeeper', label: '风控仓位守门员', description: '判断安全' },
  { type: 'fusion-brain', label: '融合计算引擎', description: '多信号融合' },
  { type: 'debate', label: '辩论块', description: '多Agent辩论+裁判' },
];

// --- Available Tools ---
const AVAILABLE_TOOLS = [
  'market_snapshot', 'technical_levels', 'fundamental_scan',
  'news_sentiment', 'sector_rotation', 'insider_trading',
  'fear_greed_index', 'earnings_calendar', 'analyst_ratings',
  'sec_filings', 'options_greeks', 'commodity_prices',
];

// --- Debatable Agents (exclude debate itself) ---
const DEBATABLE_AGENTS = PALETTE_AGENTS.filter((a) => a.type !== 'debate');

// --- Agent Node Properties Panel ---
interface NodePropertiesPanelProps {
  selectedNode: AgentNode;
  onUpdateNode: (id: string, data: Partial<AgentNodeData>) => void;
  onDeleteNode: (id: string) => void;
}

function NodePropertiesPanel({ selectedNode, onUpdateNode, onDeleteNode }: NodePropertiesPanelProps) {
  const [paramRows, setParamRows] = useState<Array<{ key: string; value: string }>>([]);

  useEffect(() => {
    const params = selectedNode.data.parameters ?? {};
    setParamRows(Object.entries(params).map(([key, value]) => ({ key, value })));
  }, [selectedNode.id, selectedNode.data.parameters]);

  const commitParams = (rows: Array<{ key: string; value: string }>) => {
    const obj: Record<string, string> = {};
    rows.forEach((r) => { if (r.key.trim()) obj[r.key.trim()] = r.value; });
    onUpdateNode(selectedNode.id, { parameters: obj });
  };

  const addParam = () => {
    const next = [...paramRows, { key: '', value: '' }];
    setParamRows(next);
  };

  const removeParam = (idx: number) => {
    const next = paramRows.filter((_, i) => i !== idx);
    setParamRows(next);
    commitParams(next);
  };

  const updateParam = (idx: number, field: 'key' | 'value', val: string) => {
    const next = paramRows.map((r, i) => (i === idx ? { ...r, [field]: val } : r));
    setParamRows(next);
    commitParams(next);
  };

  return (
    <div style={{ padding: 16 }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 12, fontSize: 14, color: '#E5E5E5' }}>
        <Tag color="blue">{selectedNode.data.agentType}</Tag> 节点属性
      </Typography.Text>
      <Form layout="vertical" size="small">
        <Form.Item label="名称">
          <Input
            value={selectedNode.data.label}
            onChange={(e) => onUpdateNode(selectedNode.id, { label: e.target.value })}
          />
        </Form.Item>

        <Form.Item label="提示词">
          <Input.TextArea
            rows={4}
            value={selectedNode.data.prompt ?? ''}
            onChange={(e) => onUpdateNode(selectedNode.id, { prompt: e.target.value })}
            placeholder="Agent 指令 / 系统提示词"
          />
        </Form.Item>

        <Form.Item label="参数">
          {paramRows.map((row, idx) => (
            <Space key={idx} style={{ display: 'flex', marginBottom: 4 }} align="start">
              <Input
                placeholder="键"
                value={row.key}
                onChange={(e) => updateParam(idx, 'key', e.target.value)}
                style={{ width: 90 }}
              />
              <Input
                placeholder="值"
                value={row.value}
                onChange={(e) => updateParam(idx, 'value', e.target.value)}
                style={{ width: 90 }}
              />
              <MinusCircleOutlined
                style={{ color: '#C47C7C', cursor: 'pointer', paddingTop: 8 }}
                onClick={() => removeParam(idx)}
              />
            </Space>
          ))}
          <Button type="dashed" onClick={addParam} icon={<PlusOutlined />} size="small" block>
            添加参数
          </Button>
        </Form.Item>

        <Form.Item label="工具">
          <Select
            mode="multiple"
            value={selectedNode.data.tools ?? []}
            onChange={(val) => onUpdateNode(selectedNode.id, { tools: val })}
            options={AVAILABLE_TOOLS.map((t) => ({ label: t, value: t }))}
            placeholder="选择工具"
            style={{ width: '100%' }}
            maxTagCount="responsive"
          />
        </Form.Item>

        <Form.Item>
          <Popconfirm
            title="删除此节点？"
            description="此操作不可撤销。"
            onConfirm={() => onDeleteNode(selectedNode.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />} block>
              删除节点
            </Button>
          </Popconfirm>
        </Form.Item>
      </Form>
    </div>
  );
}

// --- Debate Node Properties Panel ---
interface DebatePropertiesPanelProps {
  selectedNode: DebateNode;
  onUpdateNode: (id: string, data: Partial<DebateNodeData>) => void;
  onDeleteNode: (id: string) => void;
}

function DebatePropertiesPanel({ selectedNode, onUpdateNode, onDeleteNode }: DebatePropertiesPanelProps) {
  const data = selectedNode.data;

  const addAgent = () => {
    onUpdateNode(selectedNode.id, { agents: [...data.agents, ''] });
  };

  const removeAgent = (idx: number) => {
    const removed = data.agents[idx];
    const next = data.agents.filter((_, i) => i !== idx);
    const update: Partial<DebateNodeData> = { agents: next };
    if (data.judge === removed) {
      update.judge = '';
    }
    onUpdateNode(selectedNode.id, update);
  };

  const updateAgent = (idx: number, val: string) => {
    const old = data.agents[idx];
    const next = data.agents.map((a, i) => (i === idx ? val : a));
    const update: Partial<DebateNodeData> = { agents: next };
    if (data.judge === old) {
      update.judge = val;
    }
    onUpdateNode(selectedNode.id, update);
  };

  const judgeOptions = data.agents
    .filter((a) => a)
    .map((a) => {
      const agent = PALETTE_AGENTS.find((pa) => pa.type === a);
      return { label: agent ? `${agent.label} (${a})` : a, value: a };
    });

  return (
    <div style={{ padding: 16 }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 12, fontSize: 14, color: '#E5E5E5' }}>
        <Tag color="purple">debate</Tag> 辩论属性
      </Typography.Text>
      <Form layout="vertical" size="small">
        <Form.Item label="辩论名称">
          <Input
            value={data.label}
            onChange={(e) => onUpdateNode(selectedNode.id, { label: e.target.value })}
          />
        </Form.Item>

        <Form.Item label="参与 Agent">
          {data.agents.map((agent, idx) => (
            <Space key={idx} style={{ display: 'flex', marginBottom: 4 }} align="start">
              <Select
                value={agent || undefined}
                onChange={(val) => updateAgent(idx, val)}
                placeholder="选择 Agent"
                style={{ width: 180 }}
                options={DEBATABLE_AGENTS.map((a) => ({
                  label: `${a.label} (${a.type})`,
                  value: a.type,
                }))}
                allowClear
              />
              <MinusCircleOutlined
                style={{ color: '#C47C7C', cursor: 'pointer', paddingTop: 8 }}
                onClick={() => removeAgent(idx)}
              />
            </Space>
          ))}
          <Button type="dashed" onClick={addAgent} icon={<PlusOutlined />} size="small" block>
            添加 Agent
          </Button>
        </Form.Item>

        <Form.Item label="裁判 Agent">
          <Select
            value={data.judge || undefined}
            onChange={(val) => onUpdateNode(selectedNode.id, { judge: val })}
            placeholder="选择裁判"
            options={judgeOptions}
            allowClear
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item label="辩论提示词">
          <Input.TextArea
            rows={4}
            value={data.prompt}
            onChange={(e) => onUpdateNode(selectedNode.id, { prompt: e.target.value })}
            placeholder="所有 Agent 共享的分析提示词"
          />
        </Form.Item>

        <Form.Item>
          <Popconfirm
            title="删除此辩论节点？"
            description="此操作不可撤销。"
            onConfirm={() => onDeleteNode(selectedNode.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />} block>
              删除节点
            </Button>
          </Popconfirm>
        </Form.Item>
      </Form>
    </div>
  );
}

// --- Workflow Settings Modal ---
interface WorkflowSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  workflowId: string;
  workflowName: string;
  onNameChange: (name: string) => void;
}

function WorkflowSettingsModal({ visible, onClose, workflowId, workflowName, onNameChange }: WorkflowSettingsModalProps) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && workflowId !== 'new') {
      fetch(`/api/v1/workflows/${workflowId}/settings`)
        .then((r) => r.ok ? r.json() : {})
        .catch(() => ({}))
        .then((data: Record<string, string>) => {
          form.setFieldsValue({
            name: data.name ?? workflowName,
            triggerType: data.triggerType ?? 'manual',
            cronExpression: data.cronExpression ?? '',
            commandString: data.commandString ?? '',
          });
        });
    } else if (visible) {
      form.setFieldsValue({ name: workflowName, triggerType: 'manual' });
    }
  }, [visible, workflowId]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const res = await fetch(`/api/v1/workflows/${workflowId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onNameChange(values.name);
      message.success('Settings saved');
      onClose();
    } catch {
      message.error('Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="工作流设置"
      open={visible}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={loading}>
            保存
          </Button>
        </Space>
      }
      width={520}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="name" label="工作流名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input placeholder="我的工作流" />
        </Form.Item>
        <Form.Item name="triggerType" label="触发方式" initialValue="manual">
          <Select
            options={[
              { label: '手动', value: 'manual' },
              { label: '定时 (Cron)', value: 'schedule' },
              { label: '命令', value: 'command' },
            ]}
          />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev: Record<string, string>, curr: Record<string, string>) => prev.triggerType !== curr.triggerType}>
          {({ getFieldValue }) => {
            if (getFieldValue('triggerType') === 'schedule') {
              return (
                <Form.Item
                  name="cronExpression"
                  label="Cron 表达式"
                  rules={[{ required: true, message: '请输入 Cron 表达式' }]}
                >
                  <Input placeholder="0 * * * * *" />
                </Form.Item>
              );
            }
            if (getFieldValue('triggerType') === 'command') {
              return (
                <Form.Item
                  name="commandString"
                  label="命令字符串"
                  rules={[{ required: true, message: '请输入命令' }]}
                >
                  <Input placeholder="例如 /workflow/my-workflow" />
                </Form.Item>
              );
            }
            return null;
          }}
        </Form.Item>
      </Form>
    </Modal>
  );
}

// --- Edge with Prompt Label ---
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

// --- Edge Prompt Editor (inline Popover) ---
interface EdgePromptEditorProps {
  edge: WorkflowEdge;
  onUpdateEdge: (edgeId: string, data: Partial<EdgePromptData>) => void;
  onClose: () => void;
}

function EdgePromptEditor({ edge, onUpdateEdge, onClose }: EdgePromptEditorProps) {
  const [prompt, setPrompt] = useState(edge.data?.prompt ?? '');
  const [promptType, setPromptType] = useState<PromptType>(edge.data?.promptType ?? 'context');

  const handleSave = () => {
    onUpdateEdge(edge.id, { prompt, promptType });
    onClose();
  };

  return (
    <div style={{ width: 260, padding: 4 }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 8, fontSize: 12, color: '#E5E5E5' }}>
        连接提示词
      </Typography.Text>
      <Form layout="vertical" size="small">
        <Form.Item label="提示词类型" style={{ marginBottom: 8 }}>
          <Select<PromptType>
            value={promptType}
            onChange={setPromptType}
            options={PROMPT_TYPE_OPTIONS.map((o) => ({
              label: `${o.icon} ${o.label}`,
              value: o.value,
            }))}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item label="提示词内容" style={{ marginBottom: 8 }}>
          <Input.TextArea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述此连接的传递内容..."
            style={{ fontSize: 12 }}
          />
        </Form.Item>
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button size="small" onClick={onClose}>取消</Button>
          <Button size="small" type="primary" onClick={handleSave}>保存</Button>
        </Space>
      </Form>
    </div>
  );
}

// --- Main Workflow Editor ---
export default function WorkflowEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowEdge>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [workflowName, setWorkflowName] = useState('');
  const autoSaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const isDirty = useRef(false);

  const fetchWorkflow = useCallback(async () => {
    if (!id || id === 'new') {
      setNodes([]);
      setEdges([]);
      setWorkflowName('新建工作流');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/workflows/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNodes((data.nodes ?? []) as WorkflowNode[]);
      setEdges((data.edges ?? []) as WorkflowEdge[]);
      setWorkflowName(data.name ?? 'Workflow');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '加载工作流失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [id, setNodes, setEdges]);

  useEffect(() => {
    fetchWorkflow();
  }, [fetchWorkflow]);

  // 每 30 秒自动保存
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
  }, [id]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, animated: true, data: { prompt: '', promptType: 'context' as PromptType } }, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback((_: unknown, node: WorkflowNode) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }, []);

  const onEdgeClick = useCallback((_: unknown, edge: WorkflowEdge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const onUpdateEdge = useCallback((edgeId: string, data: Partial<EdgePromptData>) => {
    setEdges((eds) =>
      eds.map((e) => {
        if (e.id !== edgeId) return e;
        return { ...e, data: { ...e.data, ...data } } as WorkflowEdge;
      })
    );
    isDirty.current = true;
  }, [setEdges]);

  const onUpdateNode = useCallback((nodeId: string, data: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== nodeId) return n;
        return { ...n, data: { ...n.data, ...data } } as WorkflowNode;
      })
    );
    isDirty.current = true;
  }, [setNodes]);

  const onDeleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNodeId(null);
    isDirty.current = true;
  }, [setNodes, setEdges]);

  const handleSave = async (isAuto = false) => {
    if (!id || id === 'new') {
      try {
        setSaving(true);
        const res = await fetch('/api/v1/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: workflowName, nodes, edges }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const newId = data.id ?? data._id;
        if (!isAuto) message.success('工作流已创建');
        isDirty.current = false;
        navigate(`/workflows/${newId}/edit`);
      } catch {
        if (!isAuto) message.error('创建工作流失败');
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      setSaving(true);
      const res = await fetch(`/api/v1/workflows/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, edges, name: workflowName }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
      const res = await fetch(`/api/v1/workflows/${id}/trigger`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      message.success('工作流已启动');
    } catch {
      message.error('运行工作流失败');
    }
  };

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const agentType = event.dataTransfer.getData('application/reactflow');
      if (!agentType) return;
      const position = { x: event.clientX - 280, y: event.clientY - 60 };
      const agent = PALETTE_AGENTS.find((a) => a.type === agentType);

      if (agentType === 'debate') {
        const newNode: DebateNode = {
          id: `debate-${Date.now()}`,
          type: 'debate',
          position,
          data: { label: 'Debate', agents: [], judge: '', prompt: '' },
        };
        setNodes((nds) => [...nds, newNode]);
      } else {
        const newNode: AgentNode = {
          id: `${agentType}-${Date.now()}`,
          type: 'agent',
          position,
          data: { label: agent?.label ?? agentType, agentType, inputs: {} },
        };
        setNodes((nds) => [...nds, newNode]);
      }
      isDirty.current = true;
    },
    [setNodes]
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: 'calc(100vh - 52px)',
      margin: '-32px -40px',
    }}>
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
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/workflows')}>返回</Button>
          <Typography.Text strong style={{ fontSize: 16, color: '#E5E5E5' }}>{workflowName}</Typography.Text>
        </Space>
        <Space>
          <Button icon={<SettingOutlined />} onClick={() => setSettingsVisible(true)}>设置</Button>
          <Button icon={<SaveOutlined />} onClick={() => handleSave(false)} loading={saving}>保存</Button>
          <Button icon={<PlayCircleOutlined />} type="primary" onClick={handleRun}>运行</Button>
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
        <div style={{
          width: 240,
          borderRight: '1px solid rgba(255,255,255,0.06)',
          background: '#1A1A1A',
          overflowY: 'auto',
          padding: 16,
        }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#E5E5E5' }}>Agent 列表</Typography.Text>
          <Typography.Text style={{ fontSize: 11, display: 'block', marginBottom: 12, color: '#6B6B6B' }}>拖拽 Agent 到画布</Typography.Text>
          {PALETTE_AGENTS.map((agent) => (
            <div
              key={agent.type}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData('application/reactflow', agent.type); e.dataTransfer.effectAllowed = 'move'; }}
              style={{
                padding: '8px 12px',
                marginBottom: 6,
                background: 'rgba(139,157,195,0.08)',
                border: '1px solid rgba(139,157,195,0.18)',
                borderRadius: 8,
                cursor: 'grab',
                fontSize: 12,
                transition: 'all 0.2s ease',
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
              <div style={{ fontWeight: 600, color: '#E5E5E5' }}>{agent.type}</div>
              <div style={{ color: '#6B6B6B', fontSize: 11 }}>{agent.label} - {agent.description}</div>
            </div>
          ))}
        </div>

        {/* Center: React Flow */}
        <div style={{ flex: 1, background: '#121212' }} onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            style={{ width: '100%', height: '100%' }}
          >
            <Controls />
            <Background color="rgba(255,255,255,0.04)" gap={20} />
            <Panel position="top-left">
              <Typography.Text style={{ fontSize: 11, color: '#6B6B6B' }}>自动保存：每 30 秒</Typography.Text>
            </Panel>
          </ReactFlow>
        </div>

        {/* Right: Node Properties */}
        <div style={{
          width: 260,
          borderLeft: '1px solid rgba(255,255,255,0.06)',
          background: '#1A1A1A',
          overflowY: 'auto',
        }}>
          {selectedNode ? (
            selectedNode.type === 'debate' ? (
              <DebatePropertiesPanel
                selectedNode={selectedNode as DebateNode}
                onUpdateNode={onUpdateNode}
                onDeleteNode={onDeleteNode}
              />
            ) : (
              <NodePropertiesPanel
                selectedNode={selectedNode as AgentNode}
                onUpdateNode={onUpdateNode}
                onDeleteNode={onDeleteNode}
              />
            )
          ) : selectedEdge ? (
            <EdgePromptEditor
              edge={selectedEdge}
              onUpdateEdge={onUpdateEdge}
              onClose={() => setSelectedEdgeId(null)}
            />
          ) : (
            <div style={{ padding: 16, color: '#6B6B6B', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
              选择节点或连接以编辑属性
            </div>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      <WorkflowSettingsModal
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        workflowId={id ?? 'new'}
        workflowName={workflowName}
        onNameChange={setWorkflowName}
      />
    </div>
  );
}
