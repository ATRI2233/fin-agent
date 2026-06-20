/**
 * Portfolio module API wrappers.
 * All endpoints are under /api/v1/modules/portfolio
 */

import { apiDelete, apiGet, apiPost, apiPut } from "../http";
import type {
  Annotation,
  AnnotationCreate,
  Holding,
  HoldingCreate,
  HoldingUpdate,
  Overview,
  PriceHistoryRecord,
  PriceImportRequest,
  PriceRecord,
  Stock,
  StockCreate,
  StockDetail,
} from "../../domain/modules/portfolio";

const BASE = "/api/v1/modules/portfolio";

// ---------------------------------------------------------------------------
// Stocks
// ---------------------------------------------------------------------------

export async function listStocks(q?: string): Promise<Stock[]> {
  const url = q ? `${BASE}/stocks?q=${encodeURIComponent(q)}` : `${BASE}/stocks`;
  return apiGet<Stock[]>(url);
}

export async function createStock(data: StockCreate): Promise<Stock> {
  return apiPost<Stock>(`${BASE}/stocks`, data);
}

export async function getStock(stockId: number): Promise<Stock> {
  return apiGet<Stock>(`${BASE}/stocks/${stockId}`);
}

// ---------------------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------------------

export async function listHoldings(): Promise<Holding[]> {
  return apiGet<Holding[]>(`${BASE}/holdings`);
}

export async function getHolding(holdingId: number): Promise<Holding> {
  return apiGet<Holding>(`${BASE}/holdings/${holdingId}`);
}

export async function createHolding(data: HoldingCreate): Promise<Holding> {
  return apiPost<Holding>(`${BASE}/holdings`, data);
}

export async function updateHolding(
  holdingId: number,
  data: Partial<HoldingUpdate>,
): Promise<Holding> {
  return apiPut<Holding>(`${BASE}/holdings/${holdingId}`, data);
}

export async function deleteHolding(holdingId: number): Promise<void> {
  return apiDelete<void>(`${BASE}/holdings/${holdingId}`);
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export async function getOverview(): Promise<Overview> {
  return apiGet<Overview>(`${BASE}/overview`);
}

// ---------------------------------------------------------------------------
// Stock Detail
// ---------------------------------------------------------------------------

export async function getStockDetail(stockId: number): Promise<StockDetail> {
  return apiGet<StockDetail>(`${BASE}/stocks/${stockId}/detail`);
}

// ---------------------------------------------------------------------------
// Price History
// ---------------------------------------------------------------------------

export async function getPrices(
  stockId: number,
  start?: string,
  end?: string,
): Promise<PriceHistoryRecord[]> {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const qs = params.toString();
  const url = qs ? `${BASE}/stocks/${stockId}/prices?${qs}` : `${BASE}/stocks/${stockId}/prices`;
  return apiGet<PriceHistoryRecord[]>(url);
}

export async function importPrices(
  stockId: number,
  records: PriceRecord[],
): Promise<{ imported: number; stock_id: number }> {
  return apiPost<{ imported: number; stock_id: number }>(
    `${BASE}/stocks/${stockId}/prices`,
    { records } as PriceImportRequest,
  );
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

export async function listAnnotations(stockId: number): Promise<Annotation[]> {
  return apiGet<Annotation[]>(`${BASE}/stocks/${stockId}/annotations`);
}

export async function createAnnotation(data: AnnotationCreate): Promise<Annotation> {
  return apiPost<Annotation>(`${BASE}/annotations`, data);
}

export async function deleteAnnotation(annotationId: number): Promise<void> {
  return apiDelete<void>(`${BASE}/annotations/${annotationId}`);
}
