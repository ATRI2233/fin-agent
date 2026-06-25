import { ToolRegistration } from '../../types.js';
import { MCPClientManager } from '../../mcp/mcpClientManager.js';
import { extractData } from "../shared/extractData.js";

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
        // ── 获取基础数据 ──────────────────────────────────────
        const scanColumns = [
          "close", "price_earnings_ttm", "earnings_per_share_basic_ttm",
          "market_cap_basic", "return_on_equity_fq", "total_revenue_fq",
          "net_income_fq", "total_assets_fq", "total_debt_fq",
          "dividend_yield_recent", "sector", "number_of_employees",
          // ── 新增列：填补 8 个 null 字段 ──
          "gross_margin_fq", "operating_margin_fq",
          "current_ratio_fq", "enterprise_value_ebitda_ttm",
          "total_revenue_growth_fq_yoy", "earnings_per_share_growth_fq_yoy",
          "operating_cash_flow_fq", "free_cash_flow_fq",
          "price_earnings_to_growth_ttm",
        ];

        const [scanData] = await Promise.allSettled([
          mcpManager.callTool("stock-scanner", "tradingview_scan", {
            filters: [{ left: "name", operation: "equal", right: ticker.toUpperCase() }],
            columns: scanColumns,
            limit: 1,
          }, 25000),
        ]);

        const scanResult = scanData.status === "fulfilled" ? scanData.value : null;
        const scanItems = extractData(scanResult);
        const scanItem = scanItems[0]?.data || scanItems[0] || null;

        // ── 获取同行比较数据（基于行业板块）─────────────────
        let compareData = null;
        const sector = scanItem?.sector;
        if (sector) {
          const [peerResult] = await Promise.allSettled([
            mcpManager.callTool("stock-scanner", "tradingview_scan", {
              filters: [
                { left: "sector", operation: "equal", right: sector },
                { left: "name", operation: "neq", right: ticker.toUpperCase() },
              ],
              columns: scanColumns,
              limit: 5,
            }, 25000),
          ]);
          if (peerResult.status === "fulfilled") {
            compareData = peerResult.value;
          }
        }

        const compareItems = compareData ? extractData(compareData) : [];
        const compareItem = compareItems[0]?.data || compareItems[0] || null;
        const data = { ...scanItem, ...compareItem };

        if (!data || !data.close) {
          throw new Error(`无法获取 ${ticker} 的基本面数据`);
        }

        const pe = data.price_earnings_ttm || null;
        const eps = data.earnings_per_share_basic_ttm || null;
        const marketCap = data.market_cap_basic || null;
        const roe = data.return_on_equity_fq != null ? data.return_on_equity_fq / 100 : null;
        const revenueFq = data.total_revenue_fq || null;
        const netIncomeFq = data.net_income_fq || null;
        const totalAssets = data.total_assets_fq || null;
        const totalDebt = data.total_debt_fq || null;
        const dividendYield = data.dividend_yield_recent != null ? data.dividend_yield_recent / 100 : null;
        const grossMargin = data.gross_margin_fq != null ? data.gross_margin_fq / 100 : null;
        const operatingMargin = data.operating_margin_fq != null ? data.operating_margin_fq / 100 : null;
        const currentRatio = data.current_ratio_fq || null;
        const evEbitda = data.enterprise_value_ebitda_ttm || null;
        const peg = data.price_earnings_to_growth_ttm || null;
        const revenueGrowthYoy = data.total_revenue_growth_fq_yoy != null ? data.total_revenue_growth_fq_yoy / 100 : null;
        const earningsGrowthYoy = data.earnings_per_share_growth_fq_yoy != null ? data.earnings_per_share_growth_fq_yoy / 100 : null;
        const operatingCashFlow = data.operating_cash_flow_fq || null;

        // ── 估值指标 ──────────────────────────────────────────
        const valuation = {
          pe_trailing: pe,
          pe_forward: null,
          pb: marketCap && totalAssets ? marketCap / totalAssets : null,
          ps: marketCap && revenueFq ? (marketCap / (revenueFq * 4)) : null,
          ev_ebitda: evEbitda != null ? Math.round(evEbitda * 100) / 100 : null,
          peg: peg != null ? Math.round(peg * 100) / 100 : null,
        };

        // ── 盈利质量 ─────────────────────────────────────────
        const netMargin = revenueFq && netIncomeFq ? netIncomeFq / revenueFq : null;
        const profitability = {
          gross_margin: grossMargin != null ? Math.round(grossMargin * 10000) / 10000 : null,
          operating_margin: operatingMargin != null ? Math.round(operatingMargin * 10000) / 10000 : null,
          net_margin: netMargin,
          roe,
          roa: netIncomeFq && totalAssets ? netIncomeFq / totalAssets : null,
        };

        // ── 成长性 ────────────────────────────────────────────
        const growth = {
          revenue_yoy: revenueGrowthYoy != null ? Math.round(revenueGrowthYoy * 10000) / 10000 : null,
          earnings_yoy: earningsGrowthYoy != null ? Math.round(earningsGrowthYoy * 10000) / 10000 : null,
          revenue_qoq: null,
        };

        // ── 财务健康 ─────────────────────────────────────────
        const debtToEquity = totalDebt && totalAssets ? totalDebt / (totalAssets - totalDebt) : null;
        const ocfToNI = operatingCashFlow && netIncomeFq && netIncomeFq !== 0
          ? operatingCashFlow / netIncomeFq : null;

        const earningsQuality: "high" | "medium" | "low" =
          ocfToNI != null && ocfToNI > 1 && roe != null && roe > 0.15 ? "high"
          : roe != null && roe > 0.15 ? "high"
          : roe != null && roe > 0.05 ? "medium"
          : "low";

        const quality = {
          ocf_to_net_income: ocfToNI != null ? Math.round(ocfToNI * 100) / 100 : null,
          debt_to_equity: debtToEquity != null ? Math.round(debtToEquity * 100) / 100 : null,
          current_ratio: currentRatio != null ? Math.round(currentRatio * 100) / 100 : null,
          earnings_quality: earningsQuality,
        };

        // ── 分析师评级 ────────────────────────────────────────
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
