/** Sentiment renderer — score gauge + news list. */

import { Typography, Tag } from 'antd';
import type { RendererProps } from './index';

const { Text } = Typography;

interface NewsItem {
  title?: string;
  datetime?: string;
  publishedAt?: string;
  source?: string;
  summary?: string;
  sentiment?: string;
  sentimentScore?: number;
}

interface SentimentData {
  symbol?: string;
  sentiment_score?: number;
  sentiment_label?: string;
  adjusted_sentiment?: number;
  raw_sentiment?: number;
  stock_sentiment?: number;
  market_sentiment?: number;
  news_count?: number;
  news?: NewsItem[];
  top_positive?: NewsItem[];
  top_negative?: NewsItem[];
  divergence_warning?: string;
}

function ScoreGauge({ score, label }: { score: number; label?: string }) {
  // Normalize to 0-100 range for display
  const displayScore = score > 1 && score <= 100 ? score : (score + 1) * 50;
  const color = displayScore >= 60 ? '#D47070' : displayScore <= 40 ? '#5A9E7B' : '#D4A85A';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
      <div style={{ position: 'relative', width: 56, height: 56 }}>
        <svg width="56" height="56" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="24" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
          <circle
            cx="28" cy="28" r="24"
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeDasharray={`${(displayScore / 100) * 150.8} 150.8`}
            strokeLinecap="round"
            transform="rotate(-90 28 28)"
            style={{ transition: 'stroke-dasharray 0.5s ease' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 700, color,
        }}>
          {Math.round(displayScore)}
        </div>
      </div>
      <div>
        {label && <Text style={{ color: '#F0F0F0', fontSize: 15, fontWeight: 600, display: 'block' }}>{label}</Text>}
        <Text style={{ color: '#787878', fontSize: 12 }}>
          {displayScore >= 60 ? '偏正面' : displayScore <= 40 ? '偏负面' : '中性'}
        </Text>
      </div>
    </div>
  );
}

export function SentimentRenderer({ content }: RendererProps) {
  const data = content as SentimentData;
  if (!data || (data as Record<string, unknown>).error) {
    return <Text style={{ color: '#787878' }}>无数据</Text>;
  }

  const score = data.sentiment_score ?? data.adjusted_sentiment ?? data.stock_sentiment ?? 0;
  const label = data.sentiment_label || data.symbol || '';
  const newsList = data.news || [...(data.top_positive || []), ...(data.top_negative || [])];
  const newsCount = data.news_count ?? newsList.length;

  return (
    <div>
      {/* Score gauge */}
      <ScoreGauge score={score} label={label} />

      {/* Market sentiment */}
      {data.market_sentiment != null && (
        <div style={{ marginBottom: 10, display: 'flex', gap: 12 }}>
          <Text style={{ color: '#787878', fontSize: 12 }}>市场情绪: </Text>
          <Text style={{ color: '#B0B0B0', fontSize: 13 }}>{data.market_sentiment}</Text>
          {newsCount > 0 && <Text style={{ color: '#787878', fontSize: 12 }}>· {newsCount} 条新闻</Text>}
        </div>
      )}

      {/* Divergence warning */}
      {data.divergence_warning && (
        <div style={{ marginBottom: 10, padding: '6px 10px', background: 'rgba(212,168,90,0.1)', borderRadius: 8 }}>
          <Text style={{ color: '#D4A85A', fontSize: 12 }}>⚠ {data.divergence_warning}</Text>
        </div>
      )}

      {/* News list */}
      {newsList.length > 0 && (
        <div style={{ maxHeight: 180, overflow: 'auto' }}>
          {newsList.slice(0, 6).map((news, i) => {
            const isNeg = news.sentiment === 'negative' || (news.sentimentScore != null && news.sentimentScore < -0.3);
            const isPos = news.sentiment === 'positive' || (news.sentimentScore != null && news.sentimentScore > 0.3);
            const dotColor = isNeg ? '#5A9E7B' : isPos ? '#D47070' : '#787878';

            return (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, marginTop: 6, flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Text style={{ color: '#F0F0F0', fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {news.title || '—'}
                  </Text>
                  {news.source && <Text style={{ color: '#555', fontSize: 11 }}>{news.source}</Text>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
