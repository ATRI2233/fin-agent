/** Risk metrics renderer — risk level badge + metric cards + warnings. */

import { Typography, Tag, Space } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import type { RendererProps } from './index';

const { Text } = Typography;

function Metric({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: '8px 12px' }}>
      <Text style={{ color: '#787878', fontSize: 11 }}>{label}</Text>
      <div style={{ color: color || '#F0F0F0', fontSize: 16, fontWeight: 600 }}>
        {value}{unit && <span style={{ fontSize: 12, color: '#787878', marginLeft: 2 }}>{unit}</span>}
      </div>
    </div>
  );
}

export function RiskRenderer({ content }: RendererProps) {
  const data = content as Record<string, unknown>;
  if (!data || data.error) {
    return <Text style={{ color: '#787878' }}>无数据</Text>;
  }

  const symbol = data.symbol as string || '';
  const riskLevel = data.risk_level as string || 'unknown';
  const lastPrice = data.last_price as number | undefined;
  const vol20 = data.volatility_20d_pct as number | null | undefined;
  const vol60 = data.volatility_60d_pct as number | null | undefined;
  const drawdown = data.drawdown_from_52w_high_pct as number | null | undefined;
  const var95 = data.var_95_daily_pct as number | null | undefined;
  const warnings = (data.warnings as string[]) || [];

  const levelColor = riskLevel === 'high' ? '#D47070' : riskLevel === 'medium' ? '#D4A85A' : '#5A9E7B';
  const levelLabel = riskLevel === 'high' ? '高风险' : riskLevel === 'medium' ? '中风险' : riskLevel === 'low' ? '低风险' : riskLevel;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        {symbol && <Text style={{ color: '#F0F0F0', fontSize: 15, fontWeight: 600 }}>{symbol}</Text>}
        {lastPrice != null && (
          <Text style={{ color: '#B0B0B0', fontSize: 14 }}>
            ¥{lastPrice.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Text>
        )}
        <Tag color={levelColor} style={{ fontSize: 13 }}>{levelLabel}</Tag>
      </div>

      {/* Metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
        {vol20 != null && <Metric label="20日波动率" value={vol20.toFixed(2)} unit="%" />}
        {vol60 != null && <Metric label="60日波动率" value={vol60.toFixed(2)} unit="%" />}
        {drawdown != null && (
          <Metric label="回撤" value={drawdown.toFixed(2)} unit="%" color="#D47070" />
        )}
        {var95 != null && <Metric label="VaR(95%)" value={var95.toFixed(2)} unit="%" />}
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <Space direction="vertical" size={4}>
          {warnings.map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <WarningOutlined style={{ color: '#D4A85A', fontSize: 12 }} />
              <Text style={{ color: '#D4A85A', fontSize: 12 }}>{w}</Text>
            </div>
          ))}
        </Space>
      )}
    </div>
  );
}
