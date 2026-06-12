/**
 * Shared status rendering configuration.
 *
 * Single source of truth for node / workflow / session status colors,
 * Ant Design Tag props, icon components, and display labels.
 * Previously duplicated across WorkflowMonitor, ExecutionTimeline,
 * NodeDataPanel, MessageBubble, WorkflowList, and SessionsPage.
 */
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  ForwardOutlined,
  PauseCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import type { ComponentType } from 'react';

// ── Node status ──────────────────────────────────────────────────────────

export type NodeStatusKey = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cleaned_up';

interface StatusEntry {
  /** Hex color for icon / pill background. */
  color: string;
  /** Ant Design <Tag> color prop. */
  tag: string;
  /** Icon component (from @ant-design/icons). */
  icon: ComponentType<{ style?: React.CSSProperties; spin?: boolean }>;
  /** Chinese display label. */
  label: string;
}

export const NODE_STATUS_CONFIG: Record<NodeStatusKey, StatusEntry> = {
  pending:    { color: '#6B6B6B', tag: 'default',    icon: ClockCircleOutlined,  label: '待执行' },
  running:    { color: '#8B9DC3', tag: 'processing', icon: SyncOutlined,         label: '运行中' },
  completed:  { color: '#6B8E7B', tag: 'success',    icon: CheckCircleOutlined,  label: '已完成' },
  failed:     { color: '#C47C7C', tag: 'error',      icon: CloseCircleOutlined,  label: '失败' },
  skipped:    { color: '#C4A882', tag: 'warning',    icon: ForwardOutlined,      label: '跳过' },
  cleaned_up: { color: '#999999', tag: 'default',    icon: DeleteOutlined,       label: '已清理' },
};

// ── Workflow status ──────────────────────────────────────────────────────

export type WorkflowStatusKey = 'draft' | 'running' | 'completed' | 'failed' | 'paused';

interface WorkflowStatusEntry {
  tag: string;
  label: string;
}

export const WORKFLOW_STATUS_CONFIG: Record<WorkflowStatusKey, WorkflowStatusEntry> = {
  draft:     { tag: 'default',    label: '草稿' },
  running:   { tag: 'processing', label: '运行中' },
  completed: { tag: 'success',    label: '已完成' },
  failed:    { tag: 'error',      label: '失败' },
  paused:    { tag: 'warning',    label: '暂停' },
};

// ── Session status ───────────────────────────────────────────────────────

export type SessionStatusKey = 'active' | 'inactive' | 'cleaned_up' | 'unknown';

interface SessionStatusEntry {
  color: string;
  label: string;
}

export const SESSION_STATUS_CONFIG: Record<SessionStatusKey, SessionStatusEntry> = {
  active:     { color: 'green',   label: '活跃' },
  inactive:   { color: 'default', label: '非活跃' },
  cleaned_up: { color: 'default', label: '已清理' },
  unknown:    { color: 'default', label: '未知' },
};

// ── Helpers ──────────────────────────────────────────────────────────────

/** Convert a hex color to an rgba string with the given alpha. */
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
