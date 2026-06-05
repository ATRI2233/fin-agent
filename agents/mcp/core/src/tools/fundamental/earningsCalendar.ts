import { ToolRegistration } from '../../types.js';
import { MCPClientManager } from '../../mcp/mcpClientManager.js';
import * as dotenv from "dotenv";
dotenv.config();

interface EarningsInfo {
  symbol: string;
  timestamp: string;
  earnings_in_7d: boolean;
  earnings_date: string | null;
  time_of_day: "before_market" | "after_market" | "during_market" | null;
  eps_estimate: number | null;
  eps_actual: number | null;
  revenue_estimate: number | null;
  revenue_actual: number | null;
  surprise_pct: number | null;
  fiscal_period: string | null;
  source: string;
}

async function fetchFromFMP(symbol: string, daysAhead: number): Promise<any> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return null;

  try {
    const url = `https://financialmodelingprep.com/stable/earnings-calendar?symbol=${symbol}&apikey=${apiKey}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return null;
    const data = await resp.json() as any[];
    if (!Array.isArray(data) || data.length === 0) return null;

    const now = new Date();
    const cutoff = new Date(now.getTime() + daysAhead * 86400000);

    for (const e of data) {
      const ed = new Date(e.date || e.earningDate || 0);
      if (ed >= now && ed <= cutoff) {
        return e;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchFromTradingView(mcpManager: MCPClientManager, symbol: string): Promise<any> {
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
  try {
    const raw = await mcpManager.callTool("stock-scanner", "tradingview_earnings", { tickers: [symbol] }, 20000);
    return extractData(raw);
  } catch {
    return null;
  }
}

export function registerEarningsCalendar(mcpManager: MCPClientManager): ToolRegistration {
  return {
    name: "earnings_calendar",
    description:
      "财报日历：检查标的是否在未来 7 日内有财报发布。若有，返回发布日期、时间（盘前/盘中/盘后）、EPS 预期与实际对比、是否超预期�?,
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "股票代码",
        },
        days_ahead: {
          type: "number",
          description: "向前检查天数，默认 7",
          default: 7,
        },
      },
      required: ["symbol"],
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const symbol = args.symbol?.toUpperCase();
      const daysAhead = args.days_ahead || 7;

      if (!symbol) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "缺少 symbol 参数" }) }],
          isError: true,
        };
      }

      try {
        const result: EarningsInfo = {
          symbol,
          timestamp: new Date().toISOString(),
          earnings_in_7d: false,
          earnings_date: null,
          time_of_day: null,
          eps_estimate: null,
          eps_actual: null,
          revenue_estimate: null,
          revenue_actual: null,
          surprise_pct: null,
          fiscal_period: null,
          source: "none",
        };

        // ── 优先�?TradingView ────────────────────────────────
        const tvData = await fetchFromTradingView(mcpManager, symbol);
        if (tvData && tvData.length > 0) {
          const now = new Date();
          const cutoff = new Date(now.getTime() + daysAhead * 86400000);

          for (const e of tvData) {
            const ed = new Date(e.date || e.earningsDate || 0);
            if (ed >= now && ed <= cutoff) {
              result.earnings_in_7d = true;
              result.earnings_date = e.date || e.earningsDate;
              result.time_of_day = e.timeOfDay || null;
              result.eps_estimate = e.epsEstimate ?? e.estimate ?? null;
              result.eps_actual = e.epsActual ?? e.actual ?? null;
              result.revenue_estimate = e.revenueEstimate ?? null;
              result.revenue_actual = e.revenueActual ?? null;
              result.fiscal_period = e.fiscalPeriod || e.period || null;
              result.source = "tradingview";

              if (result.eps_estimate !== null && result.eps_actual !== null) {
                result.surprise_pct = Math.round(((result.eps_actual - result.eps_estimate) / Math.abs(result.eps_estimate)) * 10000) / 100;
              }
              break;
            }
          }
        }

        // ── 备�?FMP API ──────────────────────────────────────
        if (!result.earnings_in_7d) {
          const fmpEntry = await fetchFromFMP(symbol, daysAhead);
          if (fmpEntry) {
            result.earnings_in_7d = true;
            result.earnings_date = fmpEntry.date || null;
            result.eps_estimate = fmpEntry.epsEstimated ?? null;
            result.eps_actual = fmpEntry.epsActual ?? null;
            result.revenue_estimate = fmpEntry.revenueEstimated ?? null;
            result.revenue_actual = fmpEntry.revenueActual ?? null;
            result.source = "fmp";

            if (result.eps_estimate !== null && result.eps_actual !== null) {
              result.surprise_pct = Math.round(((result.eps_actual - result.eps_estimate) / Math.abs(result.eps_estimate)) * 10000) / 100;
            }
          }
        }

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