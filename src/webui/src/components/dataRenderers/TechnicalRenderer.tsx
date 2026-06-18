/** Technical indicators renderer — RSI, MACD, Bollinger, EMAs in a grid. */

import { Typography } from 'antd';
import type { RendererProps } from './index';

const { Text } = Typography;

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: '8px 12px' }}>
      <Text style={{ color: '#787878', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </Text>
      <div style={{ color: color || '#F0F0F0', fontSize: 16, fontWeight: 600, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

export function TechnicalRenderer({ content }: RendererProps) {
  const data = content as Record<string, unknown>;
  if (!data || data.error) {
    return <Text style={{ color: '#787878' }}>无数据</Text>;
  }

  const symbol = data.symbol as string || '';
  const price = data.current_price as number;

  // Handle both ashare and core shapes
  const rsi = data.rsi as Record<string, number> | undefined;
  const indicators = data.indicators as Record<string, unknown> | undefined;
  const rsi14 = rsi?.rsi_14 ?? (indicators?.rsi_14 as number);

  const macd = data.macd as Record<string, number> | undefined;
  const macdObj = macd ?? (indicators?.macd as Record<string, number>);
  const bollinger = data.bollinger_bands as Record<string, number> | undefined;
  const bollObj = bollinger ?? (indicators?.bollinger as Record<string, number>);

  const ema = data.ema as Record<string, number | null> | undefined;
  const ma = data.moving_averages as Record<string, number> | undefined;

  const pivotPoints = data.pivot_points as Record<string, number> | undefined;

  // RSI color
  const rsiColor = rsi14 != null
    ? rsi14 > 70 ? '#D47070' : rsi14 < 30 ? '#5A9E7B' : '#F0F0F0'
    : undefined;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <Text style={{ color: '#F0F0F0', fontSize: 16, fontWeight: 600 }}>{symbol}</Text>
        {price != null && (
          <Text style={{ color: '#B0B0B0', fontSize: 15 }}>
            ¥{price.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Text>
        )}
      </div>

      {/* Metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
        {rsi14 != null && <Metric label="RSI(14)" value={rsi14.toFixed(1)} color={rsiColor} />}
        {macdObj && (
          <Metric
            label="MACD"
            value={macdObj.histogram?.toFixed(3) ?? '—'}
            color={macdObj.histogram != null ? (macdObj.histogram >= 0 ? '#D47070' : '#5A9E7B') : undefined}
          />
        )}
        {bollObj && (
          <Metric
            label="Bollinger"
            value={`${bollObj.lower?.toFixed(2) ?? '—'} / ${bollObj.upper?.toFixed(2) ?? '—'}`}
          />
        )}
        {/* EMA rows (ashare shape) */}
        {ema?.ema_5 != null && <Metric label="EMA(5)" value={ema.ema_5.toFixed(2)} />}
        {ema?.ema_20 != null && <Metric label="EMA(20)" value={ema.ema_20.toFixed(2)} />}
        {ema?.ema_60 != null && <Metric label="EMA(60)" value={ema.ema_60.toFixed(2)} />}
        {/* Moving averages (core shape) */}
        {ma && Object.entries(ma).slice(0, 4).map(([key, val]) => (
          <Metric key={key} label={key} value={val.toFixed(2)} />
        ))}
      </div>

      {/* Pivot points */}
      {pivotPoints && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {Object.entries(pivotPoints).map(([key, val]) => (
            <div key={key}>
              <Text style={{ color: '#787878', fontSize: 11 }}>{key}</Text>
              <Text style={{ color: '#B0B0B0', fontSize: 13, marginLeft: 4 }}>{val.toFixed(2)}</Text>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
