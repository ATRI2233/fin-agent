import { ToolRegistration } from "../types.js";
import { MCPClientManager } from "../mcp/mcpClientManager.js";

const TV_INDEX_MAP: Record<string, string> = {
  "^GSPC": "SP:SPX",
  "^IXIC": "NASDAQ:IXIC",
  "^DJI": "TVC:DJI",
  "VIX": "CBOE:VIX",
  "SPX": "SP:SPX",
  "NDX": "NASDAQ:NDX",
  "DJI": "TVC:DJI",
};

const DEFAULT_INDICES = ["^GSPC", "^IXIC", "^DJI", "VIX"];

function extractData(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw?.content && Array.isArray(raw.content)) {
    const texts = raw.content
      .filter((c: any) => c.type === "text" && c.text != null)
      .map((c: any) => c.text);
    const results: any[] = [];
    for (const t of texts) {
      try { results.push(JSON.parse(t)); }
      catch { if (t) results.push(t); }
    }
    return results;
  }
  return [];
}

export function registerMarketSnapshot(
  mcpManager: MCPClientManager
): ToolRegistration {
  return {
    name: "market_snapshot",
    description:
      "市场快照：通过 TradingView 获取主要指数报价、板块涨跌排名和市场概况。用于每日开盘前/收盘后的全局扫描。",
    inputSchema: {
      type: "object",
      properties: {
        indices: {
          type: "array",
          items: { type: "string" },
          description: "指数代码列表，默认 ['^GSPC','^IXIC','^DJI','VIX']",
          default: DEFAULT_INDICES,
        },
        include_sectors: {
          type: "boolean",
          description: "是否包含板块轮动数据",
          default: true,
        },
      },
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const indices = args.indices || DEFAULT_INDICES;

      try {
        const indicesData: any[] = [];
        const errors: string[] = [];

        // ── 指数报价 ──────────────────────────────────────────
        try {
          const mktIndices = await mcpManager.callTool(
            "stock-scanner", "tradingview_market_indices", {}, 20000
          );
          const rawIndices = extractData(mktIndices);
          for (const item of rawIndices) {
            const data = item.data || item;
            indicesData.push({
              symbol: item.symbol,
              name: data?.description || data?.name || item.symbol,
              price: data?.close ?? data?.last,
              change: data?.change,
              change_abs: data?.change_abs,
              high: data?.high,
              low: data?.low,
              open: data?.open,
            });
          }
        } catch { errors.push("指数数据获取失败"); }

        // ── 请求额外自定义指数 ─────────────────────────────────
        const tvTickers = indices
          .map((s: string) => TV_INDEX_MAP[s] || s)
          .filter((t: string) => !indicesData.some((d: any) => d.symbol === t));

        if (tvTickers.length > 0) {
          try {
            const extraQuotes = await mcpManager.callTool(
              "stock-scanner", "tradingview_quote", { tickers: tvTickers }, 20000
            );
            const rawQuotes = extractData(extraQuotes);
            for (const item of rawQuotes) {
              const data = item.data || item;
              indicesData.push({
                symbol: item.symbol,
                name: data?.description || data?.name || item.symbol,
                price: data?.close ?? data?.last,
                change: data?.change,
                change_abs: data?.change_abs,
                high: data?.high || data?.premarket_close,
                low: data?.low,
                open: data?.open,
              });
            }
          } catch { /* 额外报价可选 */ }
        }

        // ── 板块数据 ──────────────────────────────────────────
        let sectorsData: any = null;
        if (args.include_sectors !== false) {
          try {
            const sectorPerf = await mcpManager.callTool(
              "stock-scanner", "tradingview_sector_performance", {}, 20000
            );
            const rawSectors = extractData(sectorPerf);
            if (rawSectors.length > 0) {
              sectorsData = rawSectors.map((s: any) => ({
                ticker: (s.symbol || "").replace("AMEX:", ""),
                name: s.data?.description || s.data?.name,
                price: s.data?.close,
                change_pct: s.data?.change,
                volume: s.data?.volume,
                perf_1w: s.data?.Perf_W || s.data?.["Perf.W"],
                perf_1m: s.data?.Perf_1M,
                perf_3m: s.data?.Perf_3M,
                perf_ytd: s.data?.Perf_YTD,
              }));
            }
          } catch { errors.push("板块数据获取失败"); }
        }

        const result = {
          timestamp: new Date().toISOString(),
          indices: indicesData,
          sectors: sectorsData,
          news_headlines: [],
          _warnings: errors.length > 0 ? errors : undefined,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
          isError: true,
        };
      }
    },
  };
}
