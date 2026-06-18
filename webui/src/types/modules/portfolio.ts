/** TypeScript types for the Portfolio module — mirrors portfolio/schema.py */

export type ActionType = "buy" | "sell";

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export interface Stock {
  id: number;
  symbol: string;
  name: string | null;
  market: string | null;
  currency: string;
  created_at: string | null;
}

export interface StockCreate {
  symbol: string;
  name?: string;
  market?: string;
  currency?: string;
}

// ---------------------------------------------------------------------------
// Holding
// ---------------------------------------------------------------------------

export interface Holding {
  id: number;
  stock_id: number;
  symbol: string | null;
  name: string | null;
  quantity: number;
  cost_basis: number;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface HoldingCreate {
  stock_id: number;
  quantity: number;
  cost_basis: number;
  notes?: string;
}

export interface HoldingUpdate {
  quantity?: number;
  cost_basis?: number;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Price History
// ---------------------------------------------------------------------------

export interface PriceRecord {
  trade_date: string; // ISO date string "YYYY-MM-DD"
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  close_price: number;
  volume: number | null;
}

export interface PriceHistoryRecord {
  id: number;
  stock_id: number;
  trade_date: string;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  close_price: number;
  volume: number | null;
}

export interface PriceImportRequest {
  records: PriceRecord[];
}

// ---------------------------------------------------------------------------
// Trade Annotation
// ---------------------------------------------------------------------------

export interface Annotation {
  id: number;
  stock_id: number;
  trade_date: string;
  price: number;
  action: ActionType;
  quantity: number | null;
  annotation: string | null;
}

export interface AnnotationCreate {
  stock_id: number;
  trade_date: string;
  price: number;
  action: ActionType;
  quantity?: number;
  annotation?: string;
}

// ---------------------------------------------------------------------------
// Aggregated responses
// ---------------------------------------------------------------------------

export interface PnlInfo {
  total_cost: number;
  current_value: number;
  pnl_amount: number;
  pnl_percent: number;
}

export interface StockDetail {
  holding: Holding | null;
  latest_price: number | null;
  prices: PriceHistoryRecord[];
  annotations: Annotation[];
  pnl: PnlInfo | null;
  stock: Stock;
}

export interface Overview {
  total_holdings: number;
  total_cost: number;
  total_value: number;
  total_pnl_amount: number;
  total_pnl_percent: number;
  holdings: Holding[];
}

// ---------------------------------------------------------------------------
// Kline chart shape for lightweight-charts
// ---------------------------------------------------------------------------

export interface KlineData {
  time: string; // "YYYY-MM-DD" for lightweight-charts
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface AnnotationMarker {
  time: string;
  position: "aboveBar" | "belowBar";
  color: string; // "#5A9E7B" for buy, "#D47070" for sell
  shape: "arrowUp" | "arrowDown";
  text: string;
}
