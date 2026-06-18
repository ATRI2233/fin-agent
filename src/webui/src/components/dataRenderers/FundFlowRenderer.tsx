/** Fund flow renderer — bar chart of net inflows + summary stats. */

import { Typography, Space } from 'antd';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { RendererProps } from './index';

const { Text } = Typography;

interface FlowRecord {
  date?: string;
  日期?: string;
  close?: number;
  收盘价?: number;
  change_pct?: number;
  涨跌幅?: number;
  [key: string]: unknown;
}

interface FundFlowData {
  symbol?: string;
  records?: FlowRecord[];
  count?: number;
  source?: string;
}

function getNetFlow(r: FlowRecord): number {
  return (r['主力净流入'] ?? r['主力净流入-净额'] ?? 0) as number;
}

function getNetFlowPct(r: FlowRecord): number {
  return (r['主力净占比'] ?? r['主力净流入-净占比'] ?? 0) as number;
}

export function FundFlowRenderer({ content }: RendererProps) {
  const data = content as FundFlowData;
  if (!data || (data as Record<string, unknown>).error) {
    return <Text style={{ color: '#787878' }}>无数据</Text>;
  }

  const records = data.records || [];
  const symbol = data.symbol || '';

  const chartData = records.slice(0, 10).reverse().map(r => ({
    name: r.date || r.日期 || '—',
    value: getNetFlow(r),
  }));

  const totalNet = records.reduce((sum, r) => sum + getNetFlow(r), 0);
  const latestPct = records.length > 0 ? getNetFlowPct(records[0]) : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'baseline', gap: 12 }}>
        {symbol && <Text style={{ color: '#F0F0F0', fontSize: 15, fontWeight: 600 }}>{symbol}</Text>}
        <Text style={{ color: '#787878', fontSize: 13 }}>{data.source || ''}</Text>
      </div>

      {/* Summary stats */}
      <Space size={20} style={{ marginBottom: 14 }}>
        <div>
          <Text style={{ color: '#787878', fontSize: 12 }}>累计净流入</Text>
          <div style={{ color: totalNet >= 0 ? '#D47070' : '#5A9E7B', fontSize: 18, fontWeight: 600 }}>
            {totalNet >= 0 ? '+' : ''}{(totalNet / 10000).toFixed(2)} 亿
          </div>
        </div>
        <div>
          <Text style={{ color: '#787878', fontSize: 12 }}>最新主力占比</Text>
          <div style={{ color: latestPct >= 0 ? '#D47070' : '#5A9E7B', fontSize: 18, fontWeight: 600 }}>
            {latestPct >= 0 ? '+' : ''}{latestPct.toFixed(2)}%
          </div>
        </div>
      </Space>

      {/* Bar chart */}
      {chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={chartData}>
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#787878' }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: '#787878' }} width={60} />
            <Tooltip
              contentStyle={{ background: '#1A1A1A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
              formatter={(val) => [`${(Number(val) / 10000).toFixed(2)} 亿`, '主力净流入']}
            />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.value >= 0 ? '#D47070' : '#5A9E7B'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
