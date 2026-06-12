/**
 * Table column definition for the AgentsPage registry table.
 *
 * Extracted verbatim from the original monolithic `AgentsPage.tsx` so
 * the visual surface is identical pre- and post-split. The columns
 * are pure render functions over an `AgentMeta` row — the only state
 * they consume is passed via the `ColumnsContext` parameter (model map
 * + whitelist counts) and the row action callbacks (`onView`,
 * `onEdit`, `onDelete`).
 *
 * @see ./hooks/useAgents for the row shape.
 */

import { Button, Popconfirm, Space, Tag, Typography } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

import type { AgentMeta } from './hooks/useAgentsPage';

const { Text } = Typography;

/**
 * External state the columns need to render — kept in a struct so the
 * factory signature stays stable as new fields are added.
 */
export interface ColumnsContext {
  /** Name → currently-bound model id. Missing entries render as "—". */
  agentModels: Record<string, string>;
  /**
   * Name → whitelist size. Missing entries render as "..." (loading
   * placeholder) so the user can distinguish "still loading" from
   * "explicitly 0".
   */
  agentWhitelistCounts: Record<string, number>;
}

export interface ColumnCallbacks {
  onView: (name: string) => void;
  onEdit: (name: string) => void;
  onDelete: (name: string) => void;
}

/**
 * Build the table column array.
 *
 * @param ctx - Per-row state the columns need to render.
 * @param cb  - Row action handlers (view / edit / delete).
 */
export function buildAgentColumns(
  ctx: ColumnsContext,
  cb: ColumnCallbacks,
): ColumnsType<AgentMeta> {
  return [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (text: string) => (
        <Text style={{ color: '#F0F0F0', fontWeight: 500, fontSize: 15 }}>
          {text}
        </Text>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text: string) => (
        <Text style={{ color: '#B0B0B0', fontSize: 14 }}>
          {text || '暂无描述'}
        </Text>
      ),
    },
    {
      title: '模式',
      dataIndex: 'mode',
      key: 'mode',
      width: 110,
      render: (mode: string) => (
        <Tag color={mode === 'primary' ? 'blue' : 'default'}>{mode}</Tag>
      ),
      filters: [
        { text: 'primary', value: 'primary' },
        { text: 'subagent', value: 'subagent' },
      ],
      onFilter: (value, record) => record.mode === value,
    },
    {
      title: 'Model',
      key: 'model',
      width: 180,
      render: (_, record) => (
        <Text style={{ color: '#787878', fontSize: 13 }}>
          {ctx.agentModels[record.name] || '—'}
        </Text>
      ),
    },
    {
      title: 'Tools 白名单',
      key: 'tools-whitelist',
      width: 130,
      render: (_, record) => {
        const count = ctx.agentWhitelistCounts[record.name];
        return (
          <Space size={4}>
            <ToolOutlined style={{ color: '#6B8EC4', fontSize: 12 }} />
            <Text style={{ color: '#787878', fontSize: 13 }}>
              {count === undefined
                ? '...'
                : count === 0
                  ? '全部'
                  : `${count} 个`}
            </Text>
          </Space>
        );
      },
    },
    {
      title: 'Source',
      dataIndex: 'filePath',
      key: 'source',
      width: 90,
      render: (filePath?: string) => {
        const isBuiltin =
          !!filePath && (filePath.includes('node_modules') || filePath.includes('builtin'));
        return (
          <Tag color={isBuiltin ? 'orange' : 'green'}>
            {isBuiltin ? 'builtin' : filePath ? 'file' : '—'}
          </Tag>
        );
      },
      filters: [
        { text: 'builtin', value: 'builtin' },
        { text: 'file', value: 'file' },
      ],
      onFilter: (value, record) => {
        const isBuiltin =
          !!record.filePath && (record.filePath.includes('node_modules') ||
          record.filePath.includes('builtin'));
        return value === 'builtin' ? isBuiltin : !isBuiltin;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 150,
      render: (_, record) => (
        <Space>
          <Button
            type="text"
            icon={<EyeOutlined />}
            onClick={() => cb.onView(record.name)}
            style={{ color: '#B0B0B0' }}
          />
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => cb.onEdit(record.name)}
            style={{ color: '#B0B0B0' }}
          />
          <Popconfirm
            title="Delete agent?"
            description={`Delete "${record.name}"?`}
            onConfirm={() => cb.onDelete(record.name)}
          >
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];
}
