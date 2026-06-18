/** Sector rotation renderer — top/bottom sectors table with momentum bars. */

import { Typography, Tag } from 'antd';
import type { RendererProps } from './index';

const { Text } = Typography;

interface Sector {
  name?: string;
  ticker?: string;
  pct_1d?: number;
  change_pct_1d?: number;
  pct_5d?: number;
  change_pct_5d?: number;
  momentum?: number;
  relative_strength?: number;
  money_flow_signal?: string;
}

interface SectorRotationData {
  period?: string;
  lookback_days?: number;
  top_sectors?: Sector[];
  bottom_sectors?: Sector[];
  rotation_signal?: { phase?: string; description?: string; confidence?: number };
  total_sectors_analyzed?: number;
}

function SectorRow({ sector, rank }: { sector: Sector; rank: number }) {
  const name = sector.name || sector.ticker || `#${rank}`;
  const pct1d = sector.pct_1d ?? sector.change_pct_1d ?? 0;
  const pct5d = sector.pct_5d ?? sector.change_pct_5d ?? 0;
  const momentum = sector.momentum ?? sector.relative_strength ?? 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <Text style={{ color: '#F0F0F0', fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </Text>
      <Text style={{ color: pct1d >= 0 ? '#D47070' : '#5A9E7B', fontSize: 13, width: 70, textAlign: 'right' }}>
        {pct1d >= 0 ? '+' : ''}{pct1d.toFixed(2)}%
      </Text>
      <Text style={{ color: pct5d >= 0 ? '#D47070' : '#5A9E7B', fontSize: 13, width: 70, textAlign: 'right' }}>
        {pct5d >= 0 ? '+' : ''}{pct5d.toFixed(2)}%
      </Text>
      {sector.money_flow_signal && (
        <Tag
          color={sector.money_flow_signal === 'inflow' ? 'red' : sector.money_flow_signal === 'outflow' ? 'green' : 'default'}
          style={{ marginLeft: 8, fontSize: 11 }}
        >
          {sector.money_flow_signal === 'inflow' ? '流入' : sector.money_flow_signal === 'outflow' ? '流出' : '中性'}
        </Tag>
      )}
    </div>
  );
}

export function SectorRotationRenderer({ content }: RendererProps) {
  const data = content as SectorRotationData;
  if (!data || (data as Record<string, unknown>).error) {
    return <Text style={{ color: '#787878' }}>无数据</Text>;
  }

  const topSectors = data.top_sectors || [];
  const bottomSectors = data.bottom_sectors || [];
  const signal = data.rotation_signal;

  return (
    <div>
      {/* Signal badge */}
      {signal && (
        <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          {signal.phase && <Tag color="blue">{signal.phase}</Tag>}
          {signal.description && <Text style={{ color: '#B0B0B0', fontSize: 13 }}>{signal.description}</Text>}
          {signal.confidence != null && (
            <Text style={{ color: '#787878', fontSize: 12 }}>置信度 {(signal.confidence * 100).toFixed(0)}%</Text>
          )}
        </div>
      )}

      {/* Column headers */}
      <div style={{ display: 'flex', padding: '0 0 6px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <Text style={{ color: '#787878', fontSize: 11, flex: 1 }}>板块</Text>
        <Text style={{ color: '#787878', fontSize: 11, width: 70, textAlign: 'right' }}>1日</Text>
        <Text style={{ color: '#787878', fontSize: 11, width: 70, textAlign: 'right' }}>5日</Text>
      </div>

      {/* Top sectors */}
      {topSectors.map((s, i) => <SectorRow key={`top-${i}`} sector={s} rank={i + 1} />)}

      {bottomSectors.length > 0 && (
        <div style={{ padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 4 }}>
          <Text style={{ color: '#555', fontSize: 11 }}>▼ 落后板块</Text>
        </div>
      )}
      {bottomSectors.map((s, i) => <SectorRow key={`bot-${i}`} sector={s} rank={topSectors.length + i + 1} />)}
    </div>
  );
}
