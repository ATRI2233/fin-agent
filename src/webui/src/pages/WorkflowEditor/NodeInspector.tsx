/**
 * NodeInspector — right-side property editor for the workflow DAG editor.
 *
 * Originally the inspector was a giant inline switch in
 * `pages/WorkflowEditor.tsx` (lines 1501-1544) that picked between five
 * `*PropertiesPanel` components and one `EdgePromptEditor`. task
 * 6.3b extracts that switch into this router and the five panels into
 * sibling files under `properties/`. The edge editor stays inline because
 * it is only ever rendered from here.
 *
 * Routing rules
 * -------------
 * - `selectedNode.type === 'agent'` → AgentNodePropertiesPanel
 * - `selectedNode.type === 'debate'` → DebateNodePropertiesPanel
 * - `selectedNode.type === 'input'` → InputNodePropertiesPanel
 * - `selectedNode.type === 'output'` → OutputNodePropertiesPanel
 * - `selectedNode.type === 'workflow-block'`→ WorkflowBlockNodePropertiesPanel
 * - `selectedEdge` (and no node) → inline EdgePromptEditor
 * - nothing selected → empty state
 *
 * The orchestrator owns the `selectedNode` / `selectedEdge` derivation
 * (`nodes.find` over the `selectedNodeId` from `useWorkflowStore`); the
 * inspector is a pure router. wires this component in to
 * replace the legacy `InspectorPlaceholder` shim.
 */

import { useState } from 'react';
import { Form, Typography, Input, Select, Button, Space, Popconfirm } from 'antd';
import type { Edge } from '@xyflow/react';

import type { PaletteAgent } from './AgentPalettePanel';
import { useWorkflowStore } from '../../store/useWorkflowStore';

import AgentNodePropertiesPanel, {
  type AgentNode,
  type AgentNodeData,
} from './properties/AgentNodePropertiesPanel';
import DebateNodePropertiesPanel, {
  type DebateNode,
  type DebateNodeData,
} from './properties/DebateNodePropertiesPanel';
import InputNodePropertiesPanel, {
  type InputNode,
} from './properties/InputNodePropertiesPanel';
import OutputNodePropertiesPanel, {
  type OutputNode,
} from './properties/OutputNodePropertiesPanel';
import WorkflowBlockNodePropertiesPanel, {
  type WorkflowBlockNode,
} from './properties/WorkflowBlockNodePropertiesPanel';

import type { InputNodeData } from '../../components/workflow/nodes/InputNode';
import type { OutputNodeData } from '../../components/workflow/nodes/OutputNode';

/* ─── Shared edge / union types (re-declared to keep this file the
 * single import surface for the property panels) ─────────────────── */

export type PromptType = 'context' | 'instruction' | 'constraint' | 'data';

export interface EdgePromptData {
  prompt: string;
  promptType: PromptType;
  [key: string]: unknown;
}

export type WorkflowEdge = Edge<EdgePromptData>;

export type WorkflowNode =
  | AgentNode
  | DebateNode
  | WorkflowBlockNode
  | InputNode
  | OutputNode;

/* ─── Inspector props ─────────────────────────────────────────────────── */

export interface NodeInspectorProps {
  selectedNode: WorkflowNode | null;
  selectedEdge: WorkflowEdge | null;
  onUpdateNode: (id: string, data: Record<string, unknown>) => void;
  onDeleteNode: (id: string) => void;
  onDeleteBlock: (blockId: string) => void;
  onUngroupBlock: (blockId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onUpdateEdge: (edgeId: string, data: Partial<EdgePromptData>) => void;
  onCloseEdge: () => void;
  /** Real (non-builtin) agents — used by the debate panel for its
   * participant / judge pickers. The orchestrator fetches this list. */
  agents: PaletteAgent[];
}

/* ─── Inline edge prompt editor (Popover body) ────────────────────────── */

const PROMPT_TYPE_OPTIONS: Array<{ label: string; value: PromptType; icon: string }> = [
  { label: '上下文信息', value: 'context', icon: '📝' },
  { label: '执行指令', value: 'instruction', icon: '⚡' },
  { label: '约束条件', value: 'constraint', icon: '🔒' },
  { label: '数据传递', value: 'data', icon: '📊' },
];

interface EdgePromptEditorProps {
  edge: WorkflowEdge;
  onDeleteEdge: (edgeId: string) => void;
  onUpdateEdge: (edgeId: string, data: Partial<EdgePromptData>) => void;
  onClose: () => void;
}

function EdgePromptEditor({ edge, onDeleteEdge, onUpdateEdge, onClose }: EdgePromptEditorProps) {
  const [prompt, setPrompt] = useState(edge.data?.prompt ?? '');
  const [promptType, setPromptType] = useState<PromptType>(
    edge.data?.promptType ?? 'context',
  );

  const handleSave = () => {
    onUpdateEdge(edge.id, { prompt, promptType });
    onClose();
  };

  return (
    <div style={{ width: 260, padding: 4 }}>
      <Typography.Text
        strong
        style={{ display: 'block', marginBottom: 8, fontSize: 12, color: '#E5E5E5' }}
      >
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
        <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Popconfirm
            title="确认删除"
            description="确定要删除此连接线吗？"
            onConfirm={() => onDeleteEdge(edge.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<span>✕</span>}>
              删除连接
            </Button>
          </Popconfirm>
          <Space>
            <Button size="small" onClick={onClose}>取消</Button>
            <Button size="small" type="primary" onClick={handleSave}>保存</Button>
          </Space>
        </Space>
      </Form>
    </div>
  );
}

/* ─── Router ──────────────────────────────────────────────────────────── */

export default function NodeInspector({
  selectedNode,
  selectedEdge,
  onUpdateNode,
  onDeleteNode,
  onDeleteEdge,
  onDeleteBlock,
  onUngroupBlock,
  onUpdateEdge,
  onCloseEdge,
  agents,
}: NodeInspectorProps) {
  // Touch the store so the inspector participates in selection re-renders
  // and so future helpers (e.g. "esc to deselect") can be wired here.
  useWorkflowStore((s) => s.setSelectedNode);

  if (selectedNode) {
    switch (selectedNode.type) {
      case 'agent':
        return (
          <AgentNodePropertiesPanel
            selectedNode={selectedNode as AgentNode}
            onUpdateNode={onUpdateNode as (id: string, data: Partial<AgentNodeData>) => void}
            onDeleteNode={onDeleteNode}
          />
        );
      case 'debate':
        return (
          <DebateNodePropertiesPanel
            selectedNode={selectedNode as DebateNode}
            onUpdateNode={onUpdateNode as (id: string, data: Partial<DebateNodeData>) => void}
            onDeleteNode={onDeleteNode}
            agents={agents}
          />
        );
      case 'input':
        return (
          <InputNodePropertiesPanel
            selectedNode={selectedNode as InputNode}
            onUpdateNode={onUpdateNode}
            onDeleteNode={onDeleteNode}
          />
        );
      case 'output':
        return (
          <OutputNodePropertiesPanel
            selectedNode={selectedNode as OutputNode}
            onUpdateNode={onUpdateNode}
            onDeleteNode={onDeleteNode}
          />
        );
      case 'workflow-block':
        return (
          <WorkflowBlockNodePropertiesPanel
            selectedNode={selectedNode as WorkflowBlockNode}
            onDeleteBlock={onDeleteBlock}
            onUngroupBlock={onUngroupBlock}
          />
        );
    }
  }

  if (selectedEdge) {
    return (
      <EdgePromptEditor
        edge={selectedEdge}
        onDeleteEdge={onDeleteEdge}
        onUpdateEdge={onUpdateEdge}
        onClose={onCloseEdge}
      />
    );
  }

  return (
    <div
      style={{
        padding: 16,
        color: '#6B6B6B',
        fontSize: 13,
        textAlign: 'center',
        marginTop: 40,
      }}
    >
      选择节点或连接以编辑属性
    </div>
  );
}
