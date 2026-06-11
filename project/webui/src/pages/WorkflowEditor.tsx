import { useEffect, useState, useCallback, useRef } from 'react';
import { Typography, Button, Space, Spin, Alert, message, Modal, Form, Input, Select, Popconfirm, Tag, List, Badge, Tooltip, Divider } from 'antd';
import {
  SaveOutlined, PlayCircleOutlined, SettingOutlined, ArrowLeftOutlined,
  DeleteOutlined, PlusOutlined, MinusCircleOutlined, BlockOutlined,
  LinkOutlined, SearchOutlined, ApartmentOutlined, UngroupOutlined,
} from '@ant-design/icons';
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
import InputNodeComponent, { type InputNodeData } from '../components/workflow/nodes/InputNode';
import OutputNodeComponent, { type OutputNodeData } from '../components/workflow/nodes/OutputNode';
import { CronEditor } from '../components/CronEditor';
import { listAgents } from '../api/agents';
import {
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  triggerWorkflow,
} from '../api/workflows';
import { apiGet, apiPut, buildUrl } from '../api/client';
import { API_V1_BASE } from '../config/env';
import type { Workflow } from '../types/workflow';
import { useWorkflowStore } from '../store/useWorkflowStore';

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

// --- Workflow Block Node Data ---
interface WorkflowBlockNodeData {
  label: string;
  workflowId: string;
  workflowName: string;
  childNodeIds: string[];
  inputs: Record<string, string>;
  [key: string]: unknown;
}

type WorkflowBlockNode = Node<WorkflowBlockNodeData, 'workflow-block'>;

type InputNode = Node<InputNodeData, 'input'>;
type OutputNode = Node<OutputNodeData, 'output'>;

type WorkflowNode = AgentNode | DebateNode | WorkflowBlockNode | InputNode | OutputNode;

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

// --- Workflow Block Node Component ---
function WorkflowBlockNodeComponent({ data }: { data: WorkflowBlockNodeData }) {
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
      <Handle type="target" position={Position.Top} style={{ background: '#52C41A' }} />
      <div style={{ fontSize: 11, color: '#52C41A', marginBottom: 2 }}>
        <BlockOutlined style={{ marginRight: 4 }} />工作流块
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#E5E5E5' }}>{data.label}</div>
      <div style={{ fontSize: 11, color: '#A0A0A0', marginTop: 2 }}>
        <ApartmentOutlined style={{ marginRight: 4 }} />
        {data.childNodeIds.length} 个节点
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#52C41A' }} />
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

const edgeTypes = {
  default: EdgeWithLabel,
};

// --- Palette Agent (fetched from API) ---
interface PaletteAgent {
  type: string;
  label: string;
  description: string;
}

// --- Built-in special node types ---
const BUILTIN_NODES: PaletteAgent[] = [
  { type: 'input', label: '输入节点', description: '工作流入口' },
  { type: 'output', label: '输出节点', description: '工作流出口' },
  { type: 'debate', label: '辩论块', description: '多Agent辩论+裁判' },
];

// --- Available Tools ---
const AVAILABLE_TOOLS = [
  'market_snapshot', 'technical_levels', 'fundamental_scan',
  'news_sentiment', 'sector_rotation', 'insider_trading',
  'fear_greed_index', 'earnings_calendar', 'analyst_ratings',
  'sec_filings', 'options_greeks', 'commodity_prices',
];

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
  agents: PaletteAgent[];
}

function DebatePropertiesPanel({ selectedNode, onUpdateNode, onDeleteNode, agents }: DebatePropertiesPanelProps) {
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
      const agent = agents.find((pa) => pa.type === a);
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
                options={agents.map((a) => ({
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
  const [cronExpression, setCronExpression] = useState('');

  useEffect(() => {
    if (visible && workflowId !== 'new') {
      apiGet<Record<string, string>>(
        buildUrl(API_V1_BASE, `/workflows/${encodeURIComponent(workflowId)}/settings`),
      )
        .catch(() => ({} as Record<string, string>))
        .then((data) => {
          form.setFieldsValue({
            name: data.name ?? workflowName,
            triggerType: data.triggerType ?? 'manual',
            commandString: data.commandString ?? '',
          });
          setCronExpression(data.cronExpression ?? '');
        });
    } else if (visible) {
      form.setFieldsValue({ name: workflowName, triggerType: 'manual' });
      setCronExpression('');
    }
  }, [visible, workflowId]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      // Inject cronExpression from local state for schedule trigger
      if (values.triggerType === 'schedule') {
        values.cronExpression = cronExpression;
      }
      await apiPut(
        buildUrl(API_V1_BASE, `/workflows/${encodeURIComponent(workflowId)}/settings`),
        values,
      );
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
                <div style={{ marginBottom: 16 }}>
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ color: '#F0F0F0' }}>执行计划</span>
                    <span style={{ color: '#D47070', marginLeft: 4 }}>*</span>
                  </div>
                  <CronEditor
                    initialCron={cronExpression}
                    onChange={setCronExpression}
                  />
                </div>
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

// --- Workflow Block Selector Modal ---
interface WorkflowListItem {
  id: string;
  name: string;
  status: string;
  node_count: number;
  created_at: string | null;
}

interface WorkflowBlockSelectorModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (workflowId: string, workflowName: string) => void;
  currentWorkflowId?: string;
}

function WorkflowBlockSelectorModal({ visible, onClose, onSelect, currentWorkflowId }: WorkflowBlockSelectorModalProps) {
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    apiGet<WorkflowListItem[]>(buildUrl(API_V1_BASE, '/workflows'))
      .then((data) => {
        // 排除当前正在编辑的工作流
        setWorkflows(data.filter((w) => w.id !== currentWorkflowId));
      })
      .catch(() => message.error('加载工作流列表失败'))
      .finally(() => setLoading(false));
  }, [visible, currentWorkflowId]);

  const filtered = workflows.filter((w) =>
    w.name.toLowerCase().includes(searchText.toLowerCase())
  );

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
      <Input
        placeholder="搜索工作流名称..."
        prefix={<SearchOutlined />}
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        style={{ marginBottom: 16 }}
        allowClear
      />
      <List
        loading={loading}
        dataSource={filtered}
        locale={{ emptyText: '暂无可用工作流' }}
        style={{ maxHeight: 400, overflowY: 'auto' }}
        renderItem={(item) => (
          <List.Item
            style={{
              cursor: 'pointer',
              padding: '12px 16px',
              borderRadius: 8,
              marginBottom: 4,
              background: 'rgba(139,157,195,0.04)',
              border: '1px solid rgba(139,157,195,0.10)',
              transition: 'all 0.2s',
            }}
            onClick={() => {
              onSelect(item.id, item.name);
              onClose();
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(82, 196, 26, 0.08)';
              e.currentTarget.style.borderColor = 'rgba(82, 196, 26, 0.25)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(139,157,195,0.04)';
              e.currentTarget.style.borderColor = 'rgba(139,157,195,0.10)';
            }}
          >
            <List.Item.Meta
              title={
                <Space>
                  <span style={{ color: '#E5E5E5' }}>{item.name}</span>
                  <Badge
                    status={item.status === 'draft' ? 'default' : item.status === 'running' ? 'processing' : 'success'}
                    text={<span style={{ fontSize: 11, color: '#A0A0A0' }}>{item.status}</span>}
                  />
                </Space>
              }
              description={
                <Space size={16}>
                  <span style={{ fontSize: 12, color: '#6B6B6B' }}>
                    <ApartmentOutlined style={{ marginRight: 4 }} />
                    {item.node_count} 个节点
                  </span>
                  {item.created_at && (
                    <span style={{ fontSize: 12, color: '#6B6B6B' }}>
                      {new Date(item.created_at).toLocaleDateString()}
                    </span>
                  )}
                </Space>
              }
            />
            <Tooltip title="点击导入此工作流">
              <Button type="primary" size="small" ghost icon={<LinkOutlined />}>
                导入
              </Button>
            </Tooltip>
          </List.Item>
        )}
      />
    </Modal>
  );
}

// --- Workflow Block Properties Panel ---
interface WorkflowBlockPropertiesPanelProps {
  selectedNode: WorkflowBlockNode;
  onDeleteBlock: (blockId: string) => void;
  onUngroupBlock: (blockId: string) => void;
}

function WorkflowBlockPropertiesPanel({ selectedNode, onDeleteBlock, onUngroupBlock }: WorkflowBlockPropertiesPanelProps) {
  const data = selectedNode.data;

  return (
    <div style={{ padding: 16 }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 12, fontSize: 14, color: '#E5E5E5' }}>
        <Tag color="green">workflow-block</Tag> 工作流块属性
      </Typography.Text>
      <Form layout="vertical" size="small">
        <Form.Item label="块名称">
          <Input value={data.label} disabled style={{ color: '#E5E5E5' }} />
        </Form.Item>

        <Form.Item label="引用工作流">
          <div style={{
            padding: '8px 12px',
            background: 'rgba(82, 196, 26, 0.06)',
            border: '1px solid rgba(82, 196, 26, 0.15)',
            borderRadius: 6,
          }}>
            <div style={{ color: '#E5E5E5', fontWeight: 500 }}>{data.workflowName}</div>
            <div style={{ fontSize: 11, color: '#6B6B6B', marginTop: 2 }}>ID: {data.workflowId}</div>
          </div>
        </Form.Item>

        <Form.Item label="包含节点">
          <Tag color="blue">{data.childNodeIds.length} 个节点</Tag>
        </Form.Item>

        <Divider style={{ margin: '12px 0', borderColor: 'rgba(255,255,255,0.06)' }} />

        <Form.Item>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Button
              icon={<UngroupOutlined />}
              block
              onClick={() => onUngroupBlock(selectedNode.id)}
              style={{ color: '#52C41A', borderColor: 'rgba(82, 196, 26, 0.3)' }}
            >
              解组（保留子节点）
            </Button>
            <Popconfirm
              title="移除整个工作流块？"
              description="将删除此块及其所有子节点，此操作不可撤销。"
              onConfirm={() => onDeleteBlock(selectedNode.id)}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button danger icon={<DeleteOutlined />} block>
                移除整个块
              </Button>
            </Popconfirm>
          </Space>
        </Form.Item>
      </Form>
    </div>
  );
}

// --- Input Node Properties Panel ---
interface InputNodePropertiesPanelProps {
  selectedNode: InputNode;
  onUpdateNode: (id: string, data: Record<string, unknown>) => void;
  onDeleteNode: (id: string) => void;
}

function InputNodePropertiesPanel({ selectedNode, onUpdateNode, onDeleteNode }: InputNodePropertiesPanelProps) {
  const data = selectedNode.data;
  const params = data.params ?? [];

  const addParam = () => {
    onUpdateNode(selectedNode.id, { params: [...params, { key: '', type: 'string', default: '' }] });
  };

  const removeParam = (idx: number) => {
    onUpdateNode(selectedNode.id, { params: params.filter((_, i) => i !== idx) });
  };

  const updateParam = (idx: number, field: 'key' | 'type' | 'default', val: string) => {
    const next = params.map((p, i) => (i === idx ? { ...p, [field]: val } : p));
    onUpdateNode(selectedNode.id, { params: next });
  };

  return (
    <div style={{ padding: 16 }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 12, fontSize: 14, color: '#E5E5E5' }}>
        <Tag color="green">input</Tag> 输入节点属性
      </Typography.Text>
      <Form layout="vertical" size="small">
        <Form.Item label="名称">
          <Input
            value={data.label}
            onChange={(e) => onUpdateNode(selectedNode.id, { label: e.target.value })}
            placeholder="输入节点名称"
          />
        </Form.Item>

        <Form.Item label="输入参数">
          {params.map((param, idx) => (
            <Space key={idx} style={{ display: 'flex', marginBottom: 4 }} align="start">
              <Input
                placeholder="参数名"
                value={param.key}
                onChange={(e) => updateParam(idx, 'key', e.target.value)}
                style={{ width: 80 }}
              />
              <Select
                value={param.type}
                onChange={(val) => updateParam(idx, 'type', val)}
                style={{ width: 70 }}
                options={[
                  { label: 'string', value: 'string' },
                  { label: 'number', value: 'number' },
                  { label: 'boolean', value: 'boolean' },
                ]}
              />
              <Input
                placeholder="默认值"
                value={param.default}
                onChange={(e) => updateParam(idx, 'default', e.target.value)}
                style={{ width: 60 }}
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

// --- Output Node Properties Panel ---
interface OutputNodePropertiesPanelProps {
  selectedNode: OutputNode;
  onUpdateNode: (id: string, data: Record<string, unknown>) => void;
  onDeleteNode: (id: string) => void;
}

function OutputNodePropertiesPanel({ selectedNode, onUpdateNode, onDeleteNode }: OutputNodePropertiesPanelProps) {
  const data = selectedNode.data;

  return (
    <div style={{ padding: 16 }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 12, fontSize: 14, color: '#E5E5E5' }}>
        <Tag color="gold">output</Tag> 输出节点属性
      </Typography.Text>
      <Form layout="vertical" size="small">
        <Form.Item label="名称">
          <Input
            value={data.label}
            onChange={(e) => onUpdateNode(selectedNode.id, { label: e.target.value })}
            placeholder="输出节点名称"
          />
        </Form.Item>

        <Form.Item label="输出键名（可选）">
          <Input
            value={data.outputKey ?? ''}
            onChange={(e) => onUpdateNode(selectedNode.id, { outputKey: e.target.value })}
            placeholder="从上游结果中提取指定键"
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

// --- Main Workflow Editor ---
export default function WorkflowEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowEdge>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Editor selection state — migrated to zustand store (Wave 4 task 4.5)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdgeId = useWorkflowStore((s) => s.selectedEdgeId);
  const setSelectedEdge = useWorkflowStore((s) => s.setSelectedEdge);
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [workflowName, setWorkflowName] = useState('');
  const [blockSelectorVisible, setBlockSelectorVisible] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const isDirty = useRef(false);

  // --- Palette agents (fetched from API) ---
  const [paletteAgents, setPaletteAgents] = useState<PaletteAgent[]>([]);
  const allPalette = [...BUILTIN_NODES, ...paletteAgents];
  const debatableAgents = paletteAgents; // only real agents, not debate

  useEffect(() => {
    listAgents()
      .then((agents) => {
        setPaletteAgents(
          agents
            .filter((a) => a.name !== 'fin-orchestrator')
            .map((a) => ({
              type: a.name,
              label: a.name,
              description: a.description,
            }))
        );
      })
      .catch(() => {/* keep empty */});
  }, []);

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
      const data = await getWorkflow(id);
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
    (params: Connection) => setEdges((eds) => addEdge({ ...params, type: 'smoothstep', animated: true, style: { stroke: '#6B6B6B', strokeWidth: 2 }, data: { prompt: '', promptType: 'context' as PromptType } }, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback((_: unknown, node: WorkflowNode) => {
    setSelectedNode(node.id);
    setSelectedEdge(null);
  }, []);

  const onEdgeClick = useCallback((_: unknown, edge: WorkflowEdge) => {
    setSelectedEdge(edge.id);
    setSelectedNode(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
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
    setSelectedNode(null);
    isDirty.current = true;
  }, [setNodes, setEdges]);

  const handleSave = async (isAuto = false) => {
    if (!id || id === 'new') {
      try {
        setSaving(true);
        const data = await createWorkflow({
          name: workflowName,
          nodes: nodes as unknown as Workflow['nodes'],
          edges: edges as unknown as Workflow['edges'],
        });
        const newId = data.id;
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
      await updateWorkflow(id, {
        nodes: nodes as unknown as Workflow['nodes'],
        edges: edges as unknown as Workflow['edges'],
        name: workflowName,
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
      await triggerWorkflow(id!);
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
          // agent field at node level — backend workflow engine reads this
          agent: agentType,
        } as AgentNode;
        setNodes((nds) => [...nds, newNode]);
      }
      isDirty.current = true;
    },
    [setNodes]
  );

  // --- Workflow Block Import Handler ---
  const handleImportWorkflowBlock = useCallback(async (workflowId: string, workflowName: string) => {
    try {
      const data = await getWorkflow(workflowId);
      const sourceNodes = (data.nodes ?? []) as Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
      const sourceEdges = (data.edges ?? []) as Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>;

      if (sourceNodes.length === 0) {
        message.warning('该工作流没有节点，无法导入');
        return;
      }

      const prefix = `wf-${workflowId.substring(0, 8)}-`;
      const timestamp = Date.now();

      // 计算源节点的边界框，用于定位
      const minX = Math.min(...sourceNodes.map((n) => n.position.x));
      const minY = Math.min(...sourceNodes.map((n) => n.position.y));
      const baseX = 200; // 在画布上的基础位置
      const baseY = 100;

      // 为导入的节点添加前缀 ID 并调整位置
      const importedNodes: WorkflowNode[] = sourceNodes.map((sn) => {
        const newId = `${prefix}${sn.id}`;
        const nodeType = sn.type === 'debate' ? 'debate' : 'agent';
        return {
          id: newId,
          type: nodeType as 'agent' | 'debate',
          position: {
            x: baseX + (sn.position.x - minX),
            y: baseY + (sn.position.y - minY),
          },
          data: { ...sn.data } as AgentNodeData & DebateNodeData,
        } as WorkflowNode;
      });

      // 为导入的边添加前缀 ID
      const importedEdges: WorkflowEdge[] = sourceEdges.map((se) => ({
        id: `${prefix}${se.id}`,
        source: `${prefix}${se.source}`,
        target: `${prefix}${se.target}`,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#6B6B6B', strokeWidth: 2 },
        data: se.data ? { prompt: String(se.data.prompt ?? ''), promptType: (se.data.promptType as PromptType) ?? 'context' } : { prompt: '', promptType: 'context' as PromptType },
      }));

      // 创建工作流块容器节点
      const blockNodeId = `wfb-${timestamp}`;
      const childNodeIds = importedNodes.map((n) => n.id);
      const blockNode: WorkflowBlockNode = {
        id: blockNodeId,
        type: 'workflow-block',
        position: { x: baseX - 20, y: baseY - 60 },
        data: {
          label: workflowName,
          workflowId,
          workflowName,
          childNodeIds,
          inputs: {},
        },
      };

      setNodes((nds) => [...nds, blockNode, ...importedNodes]);
      setEdges((eds) => [...eds, ...importedEdges]);
      isDirty.current = true;
      message.success(`已导入工作流「${workflowName}」（${sourceNodes.length} 个节点）`);
    } catch {
      message.error('导入工作流失败');
    }
  }, [setNodes, setEdges]);

  // --- Ungroup Workflow Block ---
  const handleUngroupBlock = useCallback((blockId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== blockId));
    isDirty.current = true;
    message.success('已解组工作流块，子节点已保留');
  }, [setNodes]);

  // --- Delete Workflow Block and Children ---
  const handleDeleteBlock = useCallback((blockId: string) => {
    setNodes((nds) => {
      const blockNode = nds.find((n) => n.id === blockId) as WorkflowBlockNode | undefined;
      if (!blockNode) return nds;
      const childIds = new Set(blockNode.data.childNodeIds);
      return nds.filter((n) => n.id !== blockId && !childIds.has(n.id));
    });
    setEdges((eds) => {
      // 移除与块节点和其子节点相关的边
      const blockNode = nodes.find((n) => n.id === blockId) as WorkflowBlockNode | undefined;
      if (!blockNode) return eds;
      const childIds = new Set(blockNode.data.childNodeIds);
      return eds.filter((e) => e.source !== blockId && e.target !== blockId && !childIds.has(e.source) && !childIds.has(e.target));
    });
    setSelectedNode(null);
    isDirty.current = true;
    message.success('已移除工作流块及其所有子节点');
  }, [nodes, setNodes, setEdges]);

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
      width: '100%',
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
          {allPalette.map((agent) => (
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

          {/* 工作流块复用区域 */}
          <Divider style={{ margin: '16px 0 12px', borderColor: 'rgba(255,255,255,0.06)' }} />
          <Typography.Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#E5E5E5' }}>
            <BlockOutlined style={{ marginRight: 6, color: '#52C41A' }} />工作流块复用
          </Typography.Text>
          <Typography.Text style={{ fontSize: 11, display: 'block', marginBottom: 12, color: '#6B6B6B' }}>
            导入已有工作流到画布
          </Typography.Text>
          <Button
            type="dashed"
            block
            icon={<PlusOutlined />}
            onClick={() => setBlockSelectorVisible(true)}
            style={{
              borderColor: 'rgba(82, 196, 26, 0.3)',
              color: '#52C41A',
              marginBottom: 8,
            }}
          >
            选择工作流导入
          </Button>

          {/* 显示已导入的工作流块列表 */}
          {nodes.filter((n): n is WorkflowBlockNode => n.type === 'workflow-block').map((block) => (
            <div
              key={block.id}
              style={{
                padding: '8px 12px',
                marginBottom: 6,
                background: 'rgba(82, 196, 26, 0.06)',
                border: '1px solid rgba(82, 196, 26, 0.18)',
                borderRadius: 8,
                fontSize: 12,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onClick={() => {
                setSelectedNode(block.id);
                setSelectedEdge(null);
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(82, 196, 26, 0.12)';
                e.currentTarget.style.borderColor = 'rgba(82, 196, 26, 0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(82, 196, 26, 0.06)';
                e.currentTarget.style.borderColor = 'rgba(82, 196, 26, 0.18)';
              }}
            >
              <div style={{ fontWeight: 600, color: '#52C41A', fontSize: 11 }}>
                <BlockOutlined style={{ marginRight: 4 }} />{block.data.workflowName}
              </div>
              <div style={{ color: '#A0A0A0', fontSize: 11, marginTop: 2 }}>
                {block.data.childNodeIds.length} 个节点
              </div>
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
            defaultEdgeOptions={{ type: 'smoothstep', animated: true, style: { stroke: '#6B6B6B', strokeWidth: 2 } }}
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
            selectedNode.type === 'workflow-block' ? (
              <WorkflowBlockPropertiesPanel
                selectedNode={selectedNode as WorkflowBlockNode}
                onDeleteBlock={handleDeleteBlock}
                onUngroupBlock={handleUngroupBlock}
              />
            ) : selectedNode.type === 'debate' ? (
              <DebatePropertiesPanel
                selectedNode={selectedNode as DebateNode}
                onUpdateNode={onUpdateNode}
                onDeleteNode={onDeleteNode}
                agents={debatableAgents}
              />
            ) : selectedNode.type === 'input' ? (
              <InputNodePropertiesPanel
                selectedNode={selectedNode as InputNode}
                onUpdateNode={onUpdateNode}
                onDeleteNode={onDeleteNode}
              />
            ) : selectedNode.type === 'output' ? (
              <OutputNodePropertiesPanel
                selectedNode={selectedNode as OutputNode}
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
              onClose={() => setSelectedEdge(null)}
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

      {/* Workflow Block Selector Modal */}
      <WorkflowBlockSelectorModal
        visible={blockSelectorVisible}
        onClose={() => setBlockSelectorVisible(false)}
        onSelect={handleImportWorkflowBlock}
        currentWorkflowId={id}
      />
    </div>
  );
}
