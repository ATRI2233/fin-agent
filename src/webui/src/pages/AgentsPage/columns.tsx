/**
 * Table column definition for the AgentsPage registry table.
 *
 * Extracted verbatim from the original monolithic `AgentsPage.tsx` so
 * the visual surface is identical pre- and post-split. The columns
 * are pure render functions over an `AgentMeta` row — the only state
 * they consume is passed via the `ColumnsContext` parameter (whitelist
 * counts).
 *
 * Note: P2-T2 removed CRUD modals (Create / View / Edit / Delete /
 * BatchModel). The Actions column has been removed and the callbacks
 * are no longer wired up; the page is now read-only.
 *
 * @see ./hooks/useAgentsPage for the row shape.
 */

import { Space, Tag, Typography } from 'antd';
import { ToolOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

import type { AgentMeta } from './hooks/useAgentsPage';

const { Text } = Typography;

/**
 * External state the columns need to render — kept in a struct so the
 * factory signature stays stable as new fields are added.
 */
export interface ColumnsContext {
  /**
   * Name → whitelist size. Missing entries render as "..." (loading
   * placeholder) so the user can distinguish "still loading" from
   * "explicitly 0".
   */
  agentWhitelistCounts: Record<string, number>;
}

/**
 * Build the table column array.
 *
 * @param ctx - Per-row state the columns need to render.
 */
export function buildAgentColumns(
  ctx: ColumnsContext,
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
  ];
}
