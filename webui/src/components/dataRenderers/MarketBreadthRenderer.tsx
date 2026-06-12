/** Market breadth renderer — advance/decline stats + sentiment badge. */

import { Typography, Tag, Space } from 'antd';
import type { RendererProps } from './index';

const { Text } = Typography;

export function MarketBreadthRenderer({ content }: RendererProps) {
  const data = content as Record<string, unknown>;
  if (!data || data.error) {
    return <Text style={{ color: '#787878' }}>无数据</Text>;
  }

  const advance = (data.advance_count as number) ?? 0;
  const decline = (data.decline_count as number) ?? 0;
  const flat = (data.flat_count as number) ?? 0;
  const total = (data.total as number) ?? advance + decline + flat;
  const limitUp = (data.limit_up_count as number) ?? 0;
  const limitDown = (data.limit_down_count as number) ?? 0;
  const sentiment = data.market_sentiment as string | undefined;

  const advPct = total > 0 ? (advance / total) * 100 : 50;

  const sentimentColor = sentiment === '强势' || sentiment === '偏多'
    ? '#D47070'
    : sentiment === '弱势' || sentiment === '偏空'
      ? '#5A9E7B'
      : '#D4A85A';

  return (
    <div>
      {/* Advance/Decline bar */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ width: `${advPct}%`, background: '#D47070', transition: 'width 0.3s' }} />
          <div style={{ width: `${100 - advPct}%`, background: '#5A9E7B', transition: 'width 0.3s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Text style={{ color: '#D47070', fontSize: 13 }}>上涨 {advance}</Text>
          <Text style={{ color: '#787878', fontSize: 13 }}>平盘 {flat}</Text>
          <Text style={{ color: '#5A9E7B', fontSize: 13 }}>下跌 {decline}</Text>
        </div>
      </div>

      {/* Stats row */}
      <Space size={16} wrap>
        <div>
          <Text style={{ color: '#787878', fontSize: 12 }}>涨停</Text>
          <div style={{ color: '#D47070', fontSize: 20, fontWeight: 600 }}>{limitUp}</div>
        </div>
        <div>
          <Text style={{ color: '#787878', fontSize: 12 }}>跌停</Text>
          <div style={{ color: '#5A9E7B', fontSize: 20, fontWeight: 600 }}>{limitDown}</div>
        </div>
        {sentiment && (
          <div>
            <Text style={{ color: '#787878', fontSize: 12, display: 'block' }}>市场情绪</Text>
            <Tag color={sentimentColor} style={{ fontSize: 13, marginTop: 4 }}>{sentiment}</Tag>
          </div>
        )}
      </Space>
    </div>
  );
}
