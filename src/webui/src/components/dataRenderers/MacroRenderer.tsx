/** Macro data renderer — indicator name + line chart + data table. */

import { Typography } from 'antd';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { RendererProps } from './index';

const { Text } = Typography;

interface MacroData {
  indicator?: string;
  unit?: string;
  note?: string;
  data?: unknown[];
  cpi_data?: unknown[];
  ppi_data?: unknown[];
}

function extractTableData(raw: unknown[]): Record<string, unknown>[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  // If 2D array (from df.values.tolist()), convert to objects with index keys
  if (Array.isArray(raw[0])) {
    return raw.map((row, i) => {
      const obj: Record<string, unknown> = { _index: i };
      (row as unknown[]).forEach((val, j) => { obj[`col_${j}`] = val; });
      return obj;
    });
  }
  return raw as Record<string, unknown>[];
}

export function MacroRenderer({ content }: RendererProps) {
  const data = content as MacroData;
  if (!data || (data as Record<string, unknown>).error) {
    return <Text style={{ color: '#787878' }}>无数据</Text>;
  }

  const indicator = data.indicator || '宏观指标';
  const unit = data.unit || '';
  const tableData = extractTableData(data.data || data.cpi_data || []);

  // Try to find date and value columns for chart
  const keys = tableData.length > 0 ? Object.keys(tableData[0] ?? {}) : [];
  const dateKey = keys.find(k => /date|日期|月份|月份|时间/i.test(k)) || keys[0];
  const valueKey = keys.find(k => /value|数值|值|rate|比率/i.test(k))
    || keys.find(k => k !== dateKey && k !== '_index' && typeof tableData[0]?.[k] === 'number')
    || keys[1];

  const chartData = tableData.slice(0, 20).reverse().map(row => ({
    name: String(row[dateKey ?? ''] ?? ''),
    value: typeof row[valueKey ?? ''] === 'number' ? row[valueKey ?? ''] : parseFloat(String(row[valueKey ?? ''])) || 0,
  }));

  const latest = tableData[0];
  const latestValue = latest && valueKey ? latest[valueKey] : null;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <Text style={{ color: '#F0F0F0', fontSize: 15, fontWeight: 600 }}>{indicator}</Text>
        {unit && <Text style={{ color: '#787878', fontSize: 13 }}>{unit}</Text>}
        {latestValue != null && (
          <Text style={{ color: '#6B8EC4', fontSize: 18, fontWeight: 600 }}>
            {typeof latestValue === 'number' ? latestValue.toFixed(2) : String(latestValue)}
          </Text>
        )}
      </div>
      {data.note && <Text style={{ color: '#787878', fontSize: 12, display: 'block', marginBottom: 12 }}>{data.note}</Text>}

      {/* Chart */}
      {chartData.length > 2 && (
        <div style={{ marginBottom: 12 }}>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={chartData}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#787878' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#787878' }} width={50} />
              <Tooltip
                contentStyle={{ background: '#1A1A1A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#B0B0B0' }}
              />
              <Line type="monotone" dataKey="value" stroke="#6B8EC4" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Data table (last 6 rows) */}
      {tableData.length > 0 && (
        <div style={{ maxHeight: 150, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {keys.filter(k => k !== '_index').slice(0, 5).map(k => (
                  <th key={k} style={{ color: '#787878', textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableData.slice(0, 6).map((row, i) => (
                <tr key={i}>
                  {keys.filter(k => k !== '_index').slice(0, 5).map(k => (
                    <td key={k} style={{ color: '#B0B0B0', padding: '4px 8px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      {typeof row[k] === 'number' ? (row[k] as number).toFixed(2) : String(row[k] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
