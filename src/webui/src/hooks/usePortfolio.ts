/**
 * React Query hooks wrapping `api/modules/portfolio.ts` — the portfolio
 * module surface (stocks, holdings, overview, prices, annotations).
 *
 * Mount points and HTTP verbs are documented in `api/modules/portfolio.ts:22-125`;
 * types come from `domain/modules/portfolio`. Consumers should import hooks
 * from this module rather than calling `api/modules/portfolio.ts` directly
 * from components.
 *
 * Conventions:
 * - Read hooks use `useQuery` and re-run when any of their argument
 * dependencies change.
 * - Read hooks that take a nullable id (`useStock`, `useHolding`,
 * `useStockDetail`, `usePrices`, `useAnnotations`) short-circuit when
 * the id is `null`: the query is `enabled: false` so it never fires.
 * Callers should gate on the id before consuming `data`.
 * - Mutation hooks use `useMutation` and invalidate the relevant query
 * keys on success. The broad `portfolioKeys.all` key is invalidated so
 * derived views (overview, lists) refresh in lockstep.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  createAnnotation,
  createHolding,
  createStock,
  deleteAnnotation,
  deleteHolding,
  getHolding,
  getOverview,
  getPrices,
  getStock,
  getStockDetail,
  importPrices,
  listAnnotations,
  listHoldings,
  listStocks,
  updateHolding,
} from "../api/modules/portfolio";
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
} from "../domain/modules/portfolio";

/* ─── Query key factory ────────────────────────────────────────────── */

export const portfolioKeys = {
  all: ["portfolio"] as const,

  // Stocks
  stocks: {
    all: () => [...portfolioKeys.all, "stocks"] as const,
    list: (q?: string) => [...portfolioKeys.stocks.all(), "list", q ?? ""] as const,
    detail: (stockId: number | null) =>
      [...portfolioKeys.stocks.all(), "detail", stockId] as const,
    prices: (stockId: number | null, start?: string, end?: string) =>
      [
        ...portfolioKeys.stocks.all(),
        "prices",
        stockId,
        start ?? "",
        end ?? "",
      ] as const,
  },

  // Holdings
  holdings: {
    all: () => [...portfolioKeys.all, "holdings"] as const,
    list: () => [...portfolioKeys.holdings.all(), "list"] as const,
    detail: (holdingId: number | null) =>
      [...portfolioKeys.holdings.all(), "detail", holdingId] as const,
  },

  // Overview
  overview: () => [...portfolioKeys.all, "overview"] as const,

  // Annotations
  annotations: {
    all: () => [...portfolioKeys.all, "annotations"] as const,
    list: (stockId: number | null) =>
      [...portfolioKeys.annotations.all(), "list", stockId] as const,
  },
};

/* ─── Stocks ───────────────────────────────────────────────────────── */

/**
 * List every stock, optionally filtered by a search query string.
 */
export function useStocks(
  q?: string,
): UseQueryResult<Stock[], Error> {
  return useQuery<Stock[], Error>({
    queryKey: portfolioKeys.stocks.list(q),
    queryFn: () => listStocks(q),
  });
}

/**
 * Fetch a single stock by id. Pass `null` to disable the query.
 */
export function useStock(
  stockId: number | null,
): UseQueryResult<Stock, Error> {
  return useQuery<Stock, Error>({
    queryKey: portfolioKeys.stocks.detail(stockId),
    queryFn: () => getStock(stockId as number),
    enabled: stockId !== null,
  });
}

/**
 * Create a new stock. On success, invalidates the stocks list.
 */
export function useCreateStock(): UseMutationResult<Stock, Error, StockCreate> {
  const qc = useQueryClient();
  return useMutation<Stock, Error, StockCreate>({
    mutationFn: (data) => createStock(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portfolioKeys.stocks.all() });
    },
  });
}

/* ─── Holdings ─────────────────────────────────────────────────────── */

/**
 * List every holding.
 */
export function useHoldings(): UseQueryResult<Holding[], Error> {
  return useQuery<Holding[], Error>({
    queryKey: portfolioKeys.holdings.list(),
    queryFn: () => listHoldings(),
  });
}

/**
 * Fetch a single holding by id. Pass `null` to disable the query.
 */
export function useHolding(
  holdingId: number | null,
): UseQueryResult<Holding, Error> {
  return useQuery<Holding, Error>({
    queryKey: portfolioKeys.holdings.detail(holdingId),
    queryFn: () => getHolding(holdingId as number),
    enabled: holdingId !== null,
  });
}

/**
 * Create a new holding. On success, invalidates holdings list and overview.
 */
export function useCreateHolding(): UseMutationResult<Holding, Error, HoldingCreate> {
  const qc = useQueryClient();
  return useMutation<Holding, Error, HoldingCreate>({
    mutationFn: (data) => createHolding(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portfolioKeys.holdings.all() });
      qc.invalidateQueries({ queryKey: portfolioKeys.overview() });
    },
  });
}

/**
 * Partially update a holding. On success, invalidates the holding detail,
 * holdings list and overview.
 */
export function useUpdateHolding(): UseMutationResult<
  Holding,
  Error,
  { holdingId: number; data: Partial<HoldingUpdate> }
> {
  const qc = useQueryClient();
  return useMutation<
    Holding,
    Error,
    { holdingId: number; data: Partial<HoldingUpdate> }
  >({
    mutationFn: ({ holdingId, data }) => updateHolding(holdingId, data),
    onSuccess: (_data, { holdingId }) => {
      qc.invalidateQueries({ queryKey: portfolioKeys.holdings.all() });
      qc.invalidateQueries({
        queryKey: portfolioKeys.holdings.detail(holdingId),
      });
      qc.invalidateQueries({ queryKey: portfolioKeys.overview() });
    },
  });
}

/**
 * Delete a holding. On success, invalidates the holdings list and overview.
 */
export function useDeleteHolding(): UseMutationResult<void, Error, number> {
  const qc = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: (holdingId) => deleteHolding(holdingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portfolioKeys.holdings.all() });
      qc.invalidateQueries({ queryKey: portfolioKeys.overview() });
    },
  });
}

/* ─── Overview ────────────────────────────────────────────────────── */

/**
 * Fetch the portfolio overview (totals, allocation, P&L summary).
 */
export function useOverview(): UseQueryResult<Overview, Error> {
  return useQuery<Overview, Error>({
    queryKey: portfolioKeys.overview(),
    queryFn: () => getOverview(),
  });
}

/* ─── Stock Detail ────────────────────────────────────────────────── */

/**
 * Fetch enriched stock detail (metadata + aggregated price stats).
 * Pass `null` to disable the query.
 */
export function useStockDetail(
  stockId: number | null,
): UseQueryResult<StockDetail, Error> {
  return useQuery<StockDetail, Error>({
    queryKey: portfolioKeys.stocks.detail(stockId),
    queryFn: () => getStockDetail(stockId as number),
    enabled: stockId !== null,
  });
}

/* ─── Price History ───────────────────────────────────────────────── */

/**
 * Fetch price history for a stock, optionally bounded by `start`/`end`
 * ISO date strings. Pass `null` stockId to disable the query.
 */
export function usePrices(
  stockId: number | null,
  start?: string,
  end?: string,
): UseQueryResult<PriceHistoryRecord[], Error> {
  return useQuery<PriceHistoryRecord[], Error>({
    queryKey: portfolioKeys.stocks.prices(stockId, start, end),
    queryFn: () => getPrices(stockId as number, start, end),
    enabled: stockId !== null,
  });
}

/**
 * Import a batch of price records for a stock. On success, invalidates the
 * prices query for that stock (and the stock detail / overview that may
 * surface price-derived stats).
 */
export function useImportPrices(): UseMutationResult<
  { imported: number; stock_id: number },
  Error,
  { stockId: number; records: PriceRecord[] }
> {
  const qc = useQueryClient();
  return useMutation<
    { imported: number; stock_id: number },
    Error,
    { stockId: number; records: PriceRecord[] }
  >({
    mutationFn: ({ stockId, records }) => importPrices(stockId, records),
    onSuccess: (_data, { stockId }) => {
      qc.invalidateQueries({
        queryKey: portfolioKeys.stocks.prices(stockId),
      });
      qc.invalidateQueries({
        queryKey: portfolioKeys.stocks.detail(stockId),
      });
      qc.invalidateQueries({ queryKey: portfolioKeys.overview() });
    },
  });
}

/* ─── Annotations ─────────────────────────────────────────────────── */

/**
 * List annotations attached to a stock. Pass `null` to disable the query.
 */
export function useAnnotations(
  stockId: number | null,
): UseQueryResult<Annotation[], Error> {
  return useQuery<Annotation[], Error>({
    queryKey: portfolioKeys.annotations.list(stockId),
    queryFn: () => listAnnotations(stockId as number),
    enabled: stockId !== null,
  });
}

/**
 * Create an annotation. On success, invalidates the annotations list for the
 * associated stock.
 */
export function useCreateAnnotation(): UseMutationResult<
  Annotation,
  Error,
  AnnotationCreate
> {
  const qc = useQueryClient();
  return useMutation<Annotation, Error, AnnotationCreate>({
    mutationFn: (data) => createAnnotation(data),
    onSuccess: (_data, vars) => {
      // AnnotationCreate includes stock_id; invalidate that stock's list.
      const stockId = (vars as AnnotationCreate & { stock_id?: number }).stock_id;
      if (typeof stockId === "number") {
        qc.invalidateQueries({
          queryKey: portfolioKeys.annotations.list(stockId),
        });
      } else {
        qc.invalidateQueries({ queryKey: portfolioKeys.annotations.all() });
      }
    },
  });
}

/**
 * Delete an annotation by id. On success, invalidates all annotation queries
 * (we don't know the parent stock id from the delete payload).
 */
export function useDeleteAnnotation(): UseMutationResult<void, Error, number> {
  const qc = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: (annotationId) => deleteAnnotation(annotationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portfolioKeys.annotations.all() });
    },
  });
}