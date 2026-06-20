/** Market snapshot renderer — index cards with price & change %. */

import { Typography } from 'antd';
import type { RendererProps } from './index';

const { Text } = Typography;

interface IndexEntry {
  name?: string;
  code?: string;
  symbol?: string;
  current?: number;
  price?: number;
  change?: number;
  change_abs?: number;
  change_pct?: number;
}

export function MarketSnapshotRenderer({ content }: RendererProps) {
  const data = content as Record<string, unknown>;
  const indices: IndexEntry[] = Array.isArray(data?.indices) ? data.indices : [];
  if (indices.length === 0) {
    return <Text style={{ color: '#787878' }}>无指数数据</Text>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
      {indices.map((idx, i) => {
        const price = idx.current ?? idx.price ?? 0;
        const changePct = idx.change_pct ?? 0;
        const changeAbs = idx.change ?? idx.change_abs ?? 0;
        const isUp = changePct >= 0;
        const color = isUp ? '#D47070' : '#5A9E7B'; // A-share convention: red=up, green=down

        return (
          <div
            key={idx.code ?? idx.symbol ?? i}
            style={{
              background: 'rgba(255,255,255,0.02)',
              borderRadius: 8,
              padding: '10px 12px',
              borderLeft: `3px solid ${color}`,
            }}
          >
            <Text style={{ color: '#B0B0B0', fontSize: 12, display: 'block', marginBottom: 4 }}>
              {idx.name || idx.symbol || idx.code || `#${i}`}
            </Text>
            <Text style={{ color: '#F0F0F0', fontSize: 18, fontWeight: 600, display: 'block' }}>
              {price.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
            <Text style={{ color, fontSize: 13 }}>
              {isUp ? '+' : ''}{changeAbs.toFixed(2)} ({isUp ? '+' : ''}{changePct.toFixed(2)}%)
            </Text>
          </div>
        );
      })}
    </div>
  );
}
