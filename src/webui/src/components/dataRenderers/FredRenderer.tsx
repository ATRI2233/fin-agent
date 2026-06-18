/** FRED economic data renderer — series info + line chart + data table. */

import { Typography, Tag } from 'antd';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { RendererProps } from './index';

const { Text } = Typography;

interface FredData {
  series_id?: string;
  title?: string;
  units?: string;
  frequency?: string;
  observation_range?: string;
  total_observations?: number;
  source?: string;
  data?: Array<{ date: string; value: number | null }>;
}

export function FredRenderer({ content }: RendererProps) {
  const data = content as FredData;
  if (!data || (data as Record<string, unknown>).error) {
    return <Text style={{ color: '#787878' }}>无数据</Text>;
  }

  const seriesId = data.series_id || '';
  const title = data.title || seriesId;
  const units = data.units || '';
  const freq = data.frequency || '';
  const range = data.observation_range || '';
  const seriesData = data.data || [];

  // Latest value
  const latest = seriesData.length > 0 ? seriesData[seriesData.length - 1] : null;

  // Chart data (last 30 points)
  const chartData = seriesData.slice(-30).map(d => ({
    name: d.date,
    value: d.value ?? 0,
  }));

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          {seriesId && <Tag color="blue">{seriesId}</Tag>}
          {freq && <Tag>{freq}</Tag>}
        </div>
        <Text style={{ color: '#F0F0F0', fontSize: 15, fontWeight: 600, display: 'block' }}>{title}</Text>
        <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
          {units && <Text style={{ color: '#787878', fontSize: 12 }}>单位: {units}</Text>}
          {range && <Text style={{ color: '#787878', fontSize: 12 }}>范围: {range}</Text>}
        </div>
      </div>

      {/* Latest value */}
      {latest && (
        <div style={{ marginBottom: 12 }}>
          <Text style={{ color: '#787878', fontSize: 12 }}>最新值 ({latest.date})</Text>
          <div style={{ color: '#6B8EC4', fontSize: 22, fontWeight: 700 }}>
            {latest.value != null ? latest.value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
          </div>
        </div>
      )}

      {/* Chart */}
      {chartData.length > 2 && (
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={chartData}>
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#787878' }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: '#787878' }} width={60} />
            <Tooltip
              contentStyle={{ background: '#1A1A1A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
            />
            <Line type="monotone" dataKey="value" stroke="#6B8EC4" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
