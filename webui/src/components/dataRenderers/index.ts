/**
 * Data renderer registry — maps `data_type` tags to specialized renderers.
 *
 * Each maintenance task has a `data_type` field set via the settings page.
 * The InfoPage uses `getRenderer(dataType)` to pick the right component
 * for displaying structured data instead of raw JSON.
 */

import type { ComponentType } from 'react';

export interface RendererProps {
  /** Parsed JSON content (single record or array of records). */
  content: unknown;
  /** All data records for this task (for multi-record views). */
  records?: Array<{ data_key: string; content: unknown; fetched_at: string | null }>;
}

import { MarketSnapshotRenderer } from './MarketSnapshotRenderer';
import { MarketBreadthRenderer } from './MarketBreadthRenderer';
import { TechnicalRenderer } from './TechnicalRenderer';
import { MacroRenderer } from './MacroRenderer';
import { FundFlowRenderer } from './FundFlowRenderer';
import { SectorRotationRenderer } from './SectorRotationRenderer';
import { RiskRenderer } from './RiskRenderer';
import { SentimentRenderer } from './SentimentRenderer';
import { FredRenderer } from './FredRenderer';
import { GenericRenderer } from './GenericRenderer';

const RENDERER_MAP: Record<string, ComponentType<RendererProps>> = {
  market_snapshot: MarketSnapshotRenderer,
  market_breadth: MarketBreadthRenderer,
  technical: TechnicalRenderer,
  macro: MacroRenderer,
  fund_flow: FundFlowRenderer,
  sector_rotation: SectorRotationRenderer,
  risk: RiskRenderer,
  sentiment: SentimentRenderer,
  fred: FredRenderer,
  generic: GenericRenderer,
};

/** Get the renderer component for a given data_type. Falls back to generic. */
export function getRenderer(dataType: string | undefined | null): ComponentType<RendererProps> {
  return RENDERER_MAP[dataType || 'generic'] || GenericRenderer;
}

/** Options for the data_type selector in settings. */
export const DATA_TYPE_OPTIONS = [
  { value: 'market_snapshot', label: '大盘指数' },
  { value: 'market_breadth', label: '涨跌统计' },
  { value: 'technical', label: '技术指标' },
  { value: 'macro', label: '宏观数据' },
  { value: 'fund_flow', label: '资金流向' },
  { value: 'sector_rotation', label: '板块轮动' },
  { value: 'risk', label: '风险指标' },
  { value: 'sentiment', label: '舆情分析' },
  { value: 'fred', label: 'FRED 经济数据' },
  { value: 'generic', label: '通用 (原始 JSON)' },
];
