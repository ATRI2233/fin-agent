import { ToolRegistration } from '../../types.js';
import { MCPClientManager } from '../../mcp/mcpClientManager.js';

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

interface FundamentalResult {
  symbol: string;
  timestamp: string;
  valuation: {
    pe_trailing: number | null;
    pe_forward: number | null;
    pb: number | null;
    ps: number | null;
    ev_ebitda: number | null;
    peg: number | null;
  };
  profitability: {
    gross_margin: number | null;
    operating_margin: number | null;
    net_margin: number | null;
    roe: number | null;
    roa: number | null;
  };
  growth: {
    revenue_yoy: number | null;
    earnings_yoy: number | null;
    revenue_qoq: number | null;
  };
  quality: {
    ocf_to_net_income: number | null;
    debt_to_equity: number | null;
    current_ratio: number | null;
    earnings_quality: "high" | "medium" | "low";
  };
  analyst: {
    recommendation: string;
    target_price: number | null;
    upside_pct: number | null;
    strong_buy_count: number;
    buy_count: number;
    hold_count: number;
    sell_count: number;
  };
  institutional: {
    ownership_pct: number | null;
    recent_change: "increasing" | "decreasing" | "stable";
  };
  overall_score: number;
  signal: "bullish" | "bearish" | "neutral";
}

export function registerFundamentalScan(
  mcpManager: MCPClientManager
): ToolRegistration {
  return {
    name: "fundamental_scan",
    description: "基本面扫描：通过 TradingView 获取估值、盈利质量、成长性与分析师评级等关键指标，支持无需 API Key 的基础查询。",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string", description: "股票代码" },
      },
      required: ["ticker"],
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const ticker = args.ticker;

      if (!ticker) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "缺少 ticker 参数" }) }],
          isError: true,
        };
      }

      try {
        // ── 并行获取数据 ──────────────────────────────────────
        const [scanData, compareData] = await Promise.allSettled([
          mcpManager.callTool("stock-scanner", "tradingview_scan", {
            filters: [{ left: "name", operation: "equal", right: ticker.toUpperCase() }],
            columns: [
              "close", "price_earnings_ttm", "earnings_per_share_basic_ttm",
              "market_cap_basic", "return_on_equity_fq", "total_revenue_fq",
              "net_income_fq", "total_assets_fq", "total_debt_fq",
              "dividend_yield_recent", "sector", "number_of_employees",
            ],
            limit: 1,
          }, 25000),
          mcpManager.callTool("stock-scanner", "tradingview_compare_stocks", {
            tickers: [ticker, ticker],
          }, 25000),
        ]);

        const scanResult = scanData.status === "fulfilled" ? scanData.value : null;
        const compareResult = compareData.status === "fulfilled" ? compareData.value : null;
        const scanItems = extractData(scanResult);
        const compareItems = extractData(compareResult);
        const scanItem = scanItems[0]?.data || scanItems[0] || null;
        const compareItem = compareItems[0]?.data || compareItems[0] || null;
        const data = { ...scanItem, ...compareItem };

        if (!data || !data.close) {
          throw new Error(`无法获取 ${ticker} 的基本面数据`);
        }

        const price = data.close;
        const pe = data.price_earnings_ttm || null;
        const eps = data.earnings_per_share_basic_ttm || null;
        const marketCap = data.market_cap_basic || null;
        const roe = data.return_on_equity_fq != null ? data.return_on_equity_fq / 100 : null;
        const revenueFq = data.total_revenue_fq || null;
        const netIncomeFq = data.net_income_fq || null;
        const totalAssets = data.total_assets_fq || null;
        const totalDebt = data.total_debt_fq || null;
        const dividendYield = data.dividend_yield_recent != null ? data.dividend_yield_recent / 100 : null;

        // ── 估值指�?─────────────────────────────────────────
        const valuation = {
          pe_trailing: pe,
          pe_forward: null,
          pb: marketCap && totalAssets ? marketCap / totalAssets : null,
          ps: marketCap && revenueFq ? (marketCap / (revenueFq * 4)) : null,
          ev_ebitda: null,
          peg: null,
        };

        // ── 盈利质量 ─────────────────────────────────────────
        const netMargin = revenueFq && netIncomeFq ? netIncomeFq / revenueFq : null;
        const profitability = {
          gross_margin: null,
          operating_margin: null,
          net_margin: netMargin,
          roe,
          roa: netIncomeFq && totalAssets ? netIncomeFq / totalAssets : null,
        };

        // ── 成长�?───────────────────────────────────────────
        const growth = {
          revenue_yoy: null,
          earnings_yoy: null,
          revenue_qoq: null,
        };

        // ── 财务健康 ─────────────────────────────────────────
        const debtToEquity = totalDebt && totalAssets ? totalDebt / (totalAssets - totalDebt) : null;
        const ocfToNI = null;

        const earningsQuality: "high" | "medium" | "low" =
          roe != null && roe > 0.15 ? "high"
          : roe != null && roe > 0.05 ? "medium"
          : "low";

        const quality = {
          ocf_to_net_income: ocfToNI,
          debt_to_equity: debtToEquity ? Math.round(debtToEquity * 100) / 100 : null,
          current_ratio: null,
          earnings_quality: earningsQuality,
        };

        // ── 分析师评�?───────────────────────────────────────
        const recScore = data.Recommend_All ?? data["Recommend.All"] ?? null;
        let recommendation = "N/A";
        if (recScore != null) {
          if (recScore > 0.5) recommendation = "strong_buy";
          else if (recScore > 0.1) recommendation = "buy";
          else if (recScore > -0.1) recommendation = "hold";
          else if (recScore > -0.5) recommendation = "sell";
          else recommendation = "strong_sell";
        }

        const analyst = {
          recommendation,
          target_price: null,
          upside_pct: null,
          strong_buy_count: 0,
          buy_count: 0,
          hold_count: 0,
          sell_count: 0,
        };

        // ── 机构持仓 ─────────────────────────────────────────
        const institutional = {
          ownership_pct: null,
          recent_change: "stable" as "increasing" | "decreasing" | "stable",
        };

        // ── 综合评分 ─────────────────────────────────────────
        let score = 50;

        if (pe && pe < 15) score += 10;
        else if (pe && pe > 35) score -= 10;

        if (roe && roe > 0.15) score += 10;
        if (netMargin && netMargin > 0.15) score += 5;
        if (netMargin && netMargin > 0.25) score += 5;

        if (debtToEquity && debtToEquity < 0.5) score += 5;
        else if (debtToEquity && debtToEquity > 2) score -= 5;

        if (earningsQuality === "high") score += 10;
        else if (earningsQuality === "low") score -= 10;

        if (recommendation === "buy" || recommendation === "strong_buy") score += 5;
        else if (recommendation === "sell" || recommendation === "strong_sell") score -= 5;

        if (eps && eps > 0) score += 5;
        if (dividendYield && dividendYield > 0.01) score += 3;

        score = Math.max(0, Math.min(100, score));

        const signal = score >= 65 ? "bullish" : score <= 35 ? "bearish" : "neutral";

        const result: FundamentalResult = {
          symbol: ticker.toUpperCase(),
          timestamp: new Date().toISOString(),
          valuation,
          profitability,
          growth,
          quality,
          analyst,
          institutional,
          overall_score: score,
          signal,
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
