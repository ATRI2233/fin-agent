/**
 * AgentPalettePanel — left sidebar of the workflow editor.
 *
 * Renders the draggable list of agents (real + built-ins) used to populate
 * the canvas, plus a "Workflow Block Reuse" section that surfaces workflows
 * already imported into the current editor.
 *
 * Data flow
 * ---------
 * - The orchestrator owns the agent list (`useAgents`) and passes the
 * transformed palette entries as `paletteAgents`. The panel does NOT
 * call `useAgents` itself — keeping fetch ownership in the parent makes
 * the panel easy to test and avoids duplicate requests.
 * - Drag-start is a callback because the actual `dataTransfer.setData`
 * payload (`application/reactflow`) is also consumed by the canvas
 * panel's drop handler; the orchestrator wires the two together.
 * - Imported workflow blocks are passed in as a filtered view; the panel
 * simply renders them and forwards clicks for selection.
 */

import { Typography, Button, Divider } from 'antd';
import {
  PlusOutlined,
  BlockOutlined,
} from '@ant-design/icons';

/** Palette entry consumed by the drag/drop pipeline (matches the shape
 * the canvas `onDrop` handler looks up). */
export interface PaletteAgent {
  type: string;
  label: string;
  description: string;
}

/** A workflow-block node already on the canvas, exposed in the palette
 * list so the user can click to re-select it. */
export interface PaletteWorkflowBlock {
  id: string;
  workflowName: string;
  childNodeIds: string[];
}

export interface AgentPalettePanelProps {
  /** Real agents fetched via `useAgents` (already filtered & mapped). */
  paletteAgents: PaletteAgent[];
  /** Drag-start callback — receives the agent `type` for use as the
   * `dataTransfer` payload consumed by the canvas drop handler. */
  onDragStart: (agentType: string) => (e: React.DragEvent) => void;
  /** Workflow blocks already present on the canvas (for the "Reuse" list). */
  workflowBlocks?: PaletteWorkflowBlock[];
  /** Click handler for an entry in the "Reuse" list. */
  onSelectBlock?: (blockId: string) => void;
  /** Click handler for the "Import workflow" button. */
  onOpenBlockSelector?: () => void;
}

/* Built-in node types that are not real agents. They participate in the
 * drag/drop pipeline exactly like real agents but are listed first. */
const BUILTIN_NODES: PaletteAgent[] = [
  { type: 'input', label: '输入节点', description: '工作流入口' },
  { type: 'output', label: '输出节点', description: '工作流出口' },
  { type: 'debate', label: '辩论块', description: '多Agent辩论+裁判' },
];

export default function AgentPalettePanel({
  paletteAgents,
  onDragStart,
  workflowBlocks = [],
  onSelectBlock,
  onOpenBlockSelector,
}: AgentPalettePanelProps) {
  const allPalette: PaletteAgent[] = [...BUILTIN_NODES, ...paletteAgents];

  return (
    <div style={{ padding: 4 }}>
      <Typography.Text
        strong
        style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#E5E5E5' }}
      >
        Agent 列表
      </Typography.Text>
      <Typography.Text style={{ fontSize: 11, display: 'block', marginBottom: 12, color: '#6B6B6B' }}>
        拖拽 Agent 到画布
      </Typography.Text>

      {allPalette.map((agent) => (
        <div
          key={agent.type}
          draggable
          onDragStart={onDragStart(agent.type)}
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
          <div style={{ color: '#6B6B6B', fontSize: 11 }}>
            {agent.label} - {agent.description}
          </div>
        </div>
      ))}

      <Divider style={{ margin: '16px 0 12px', borderColor: 'rgba(255,255,255,0.06)' }} />

      <Typography.Text
        strong
        style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#E5E5E5' }}
      >
        <BlockOutlined style={{ marginRight: 6, color: '#52C41A' }} />
        工作流块复用
      </Typography.Text>
      <Typography.Text style={{ fontSize: 11, display: 'block', marginBottom: 12, color: '#6B6B6B' }}>
        导入已有工作流到画布
      </Typography.Text>
      <Button
        type="dashed"
        block
        icon={<PlusOutlined />}
        onClick={onOpenBlockSelector}
        style={{
          borderColor: 'rgba(82, 196, 26, 0.3)',
          color: '#52C41A',
          marginBottom: 8,
        }}
      >
        选择工作流导入
      </Button>

      {workflowBlocks.map((block) => (
        <div
          key={block.id}
          onClick={onSelectBlock ? () => onSelectBlock(block.id) : undefined}
          style={{
            padding: '8px 12px',
            marginBottom: 6,
            background: 'rgba(82, 196, 26, 0.06)',
            border: '1px solid rgba(82, 196, 26, 0.18)',
            borderRadius: 8,
            fontSize: 12,
            cursor: onSelectBlock ? 'pointer' : 'default',
            transition: 'all 0.2s ease',
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
            <BlockOutlined style={{ marginRight: 4 }} />
            {block.workflowName}
          </div>
          <div style={{ color: '#A0A0A0', fontSize: 11, marginTop: 2 }}>
            {block.childNodeIds.length} 个节点
          </div>
        </div>
      ))}
    </div>
  );
}
