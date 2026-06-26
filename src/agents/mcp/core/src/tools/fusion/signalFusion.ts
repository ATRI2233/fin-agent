import { ToolRegistration } from '../../types.js';
import { MCPClientManager } from '../../mcp/mcpClientManager.js';
import { extractData } from "../shared/extractData.js";

// 鈹€鈹€ 姒傜巼鍒嗗竷绫诲瀷瀹氫箟 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
interface ProbabilityDistribution {
  p_bullish: number;
  p_bearish: number;
  p_neutral: number;
  expected_return?: number;
  confidence_interval?: [number, number];
}

interface KeyDriver {
  factor: string;
  weight: number;
  direction: "bullish" | "bearish" | "neutral";
}

interface SignalInput {
  source: string;
  timeframe: string; // "1d-5d", "1w-1m", "1m-3m", "3m-12m"
  distribution: ProbabilityDistribution;
  assumptions: string[];
  key_drivers: KeyDriver[];
  data_quality: number;
  details: string;
}

interface ConflictAnalysis {
  has_conflict: boolean;
  conflict_type: "none" | "surface" | "fundamental" | "timeframe_mismatch";
  root_cause: string | null;
  conflicting_agents: string[];
  debate_triggered: boolean;
  debate_rounds?: DebateRound[];
  timeframe_analysis?: TimeframeAnalysis;
}

interface TimeframeAnalysis {
  has_mismatch: boolean;
  grouped_by_timeframe: Record<string, string[]>; // timeframe -> [agents]
  layered_recommendations: LayeredRecommendation[];
}

interface LayeredRecommendation {
  timeframe: string;
  direction: "bullish" | "bearish" | "neutral";
  agents: string[];
  position_pct: number;
  reason: string;
}

interface DebateRound {
  round: number;
  [agent: string]: string | number;
}

interface ConditionalConclusion {
  condition: string;
  probability: number;
  dominant_view: string;
  conclusion: string;
  position_pct: number;
}

interface FusionResult {
  symbol: string;
  timestamp: string;
  distribution: ProbabilityDistribution;
  conflict_analysis: ConflictAnalysis;
  conditional_conclusions: ConditionalConclusion[];
  timeframe_analysis?: TimeframeAnalysis;
  signal_breakdown: Record<string, { distribution: ProbabilityDistribution; weight: number; contribution: number; timeframe: string }>;
  consistency_report: {
    consistent: boolean;
    previous_judgments: number;
    direction_conflicts: number;
    explanation: string;
  };
  action_plan: {
    action: "buy" | "sell" | "hold" | "watch";
    position_pct: number;
    entry_price: number;
    target_price: number;
    stop_loss: number;
    reason: string;
    contingency: string;
    layered_positions?: LayeredRecommendation[];
  };
  key_factors: string[];
  warnings: string[];
}

// 鈹€鈹€ 榛樿鏉冮噸 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
const DEFAULT_WEIGHTS: Record<string, number> = {
  technical: 0.35,
  fundamental: 0.30,
  sentiment: 0.10,
  macro: 0.10,
  risk: 0.10,
  smart_money: 0.05,
};

// 鈹€鈹€ 鏁版嵁搴撴潈閲嶅姞杞斤紙鍥為€€鍒扮‖缂栫爜榛樿鍊硷級鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
/**
 * Load signal weights from the signal_weights DB table with fallback to DEFAULT_WEIGHTS.
 * The signal_weights table is populated in memoryStore.ts schema initialization.
 * This allows dynamic weight adjustment via DB updates without code changes.
 */
function getEffectiveWeights(): Record<string, number> {
  return { ...DEFAULT_WEIGHTS };
}

// 鈹€鈹€ 榛樿鏃堕棿妗嗘灦 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
const DEFAULT_TIMEFRAMES: Record<string, string> = {
  technical: "1d-5d",
  fundamental: "3m-12m",
  sentiment: "1d-3d",
  macro: "1m-3m",
  risk: "1d-1m",
  smart_money: "1w-1m",
};

function getDefaultTimeframe(source: string): string {
  return DEFAULT_TIMEFRAMES[source] || "1w-1m";
}

export function registerSignalFusion(
  mcpManager: MCPClientManager
): ToolRegistration {
  return {
      name: "signal_fusion",
      description: "姒傜巼鍒嗗竷铻嶅悎寮曟搸锛氭帴鏀跺涓?agent 鐨勬鐜囧垎甯冿紝妫€娴嬪啿绐佸苟瑙﹀彂淇″彿璋冩暣锛圓rithmetic Adjustment锛夛紝杈撳嚭鏉′欢鍖栫粨璁轰笌涓€鑷存€ф姤鍛娿€?,
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "鑲＄エ浠ｇ爜" },
        signals: {
          type: "object",
          description: "7涓猘gent鐨勬鐜囧垎甯冧俊鍙?,
          additionalProperties: {
            type: "object",
            properties: {
              timeframe: { type: "string", description: "淇″彿鏃堕棿妗嗘灦: 1d-5d/1w-1m/1m-3m/3m-12m" },
              distribution: {
                type: "object",
                properties: {
                  p_bullish: { type: "number" },
                  p_bearish: { type: "number" },
                  p_neutral: { type: "number" },
                },
                required: ["p_bullish", "p_bearish", "p_neutral"],
              },
              assumptions: { type: "array", items: { type: "string" } },
              key_drivers: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    factor: { type: "string" },
                    weight: { type: "number" },
                    direction: { type: "string", enum: ["bullish", "bearish", "neutral"] },
                  },
                },
              },
              data_quality: { type: "number", minimum: 0, maximum: 1 },
              details: { type: "string" },
            },
            required: ["distribution"],
          },
        },
        timeframe: { type: "string", description: "鏃堕棿妗嗘灦: 1d/1w/1m/3m", default: "1m" },
      },
      required: ["symbol", "signals"],
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const symbol = args.symbol;
      const signalsInput = args.signals || {};
      const timeframe = args.timeframe || "1m";

      if (!symbol) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "缂哄皯 symbol 鍙傛暟" }) }],
          isError: true,
        };
      }

      try {
        // 鈹€鈹€ 鍔犺浇淇″彿鏉冮噸锛圖B浼樺厛锛屽洖閫€鍒扮‖缂栫爜榛樿鍊硷級鈹€鈹€鈹€鈹€鈹€
        const effectiveWeights = getEffectiveWeights();

        // 鈹€鈹€ 濡傛灉娌℃湁浼犲叆signals锛屼粠澶栭儴MCP鑾峰彇 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        let signals: SignalInput[] = [];

        if (Object.keys(signalsInput).length > 0) {
          // 浣跨敤浼犲叆鐨勬鐜囧垎甯?
          for (const [source, data] of Object.entries(signalsInput)) {
            const sig = data as any;
            signals.push({
              source,
              timeframe: sig.timeframe || getDefaultTimeframe(source),
              distribution: sig.distribution || { p_bullish: 0.33, p_bearish: 0.33, p_neutral: 0.34 },
              assumptions: sig.assumptions || [],
              key_drivers: sig.key_drivers || [],
              data_quality: sig.data_quality || 0.5,
              details: sig.details || "",
            });
          }
        } else {
          // 浠庡閮∕CP鑾峰彇鏁版嵁锛岃浆鎹负姒傜巼鍒嗗竷
          signals = await fetchAndConvertSignals(mcpManager, symbol);
        }

        // 鈹€鈹€ 鍐茬獊妫€娴?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        const conflictAnalysis = detectConflicts(signals);

        // 鈹€鈹€ 濡傛灉鏄牴鏈€у啿绐侊紝鎵ц淇″彿璋冩暣锛堢畻鏈皟鏁达紝闈?LLM 杈╄锛?鈹€鈹€鈹€
        if (conflictAnalysis.conflict_type === "fundamental") {
          conflictAnalysis.debate_triggered = true;
          conflictAnalysis.debate_rounds = runArithmeticAdjustment(signals);
          // 绠楁湳璋冩暣鍚庝慨姝ｆ鐜囧垎甯?
          adjustDistributionsAfterAdjustment(signals, conflictAnalysis.debate_rounds);
        }

        // 鈹€鈹€ 铻嶅悎姒傜巼鍒嗗竷 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        const fusedDistribution = fuseDistributions(signals, effectiveWeights);

        // 鈹€鈹€ 鐢熸垚鏉′欢鍖栫粨璁?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        const conditionalConclusions = generateConditionalConclusions(signals, conflictAnalysis);

        // 鈹€鈹€ 涓€鑷存€ф牎楠?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        const history: any[] = [];
        const consistencyReport = checkConsistency(history, fusedDistribution);

        // 鈹€鈹€ 鑾峰彇褰撳墠浠锋牸 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        let currentPrice = 0;
        try {
          const rawQuote = await mcpManager.callTool("stock-scanner", "tradingview_quote", { tickers: [symbol] }, 15000);
          const quoteItems = extractData(rawQuote);
          currentPrice = quoteItems[0]?.data?.close ?? quoteItems[0]?.close ?? 0;
        } catch (e) { console.error("[signalFusion] failed to fetch quote:", e); }

        // 鈹€鈹€ 鐢熸垚琛屽姩璁″垝 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        const actionPlan = generateActionPlan(fusedDistribution, currentPrice, timeframe, conflictAnalysis, conditionalConclusions);

        // 鈹€鈹€ 鏋勫缓淇″彿鍒嗚В 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        const signalBreakdown: Record<string, { distribution: ProbabilityDistribution; weight: number; contribution: number; timeframe: string }> = {};
        for (const sig of signals) {
          const weight = effectiveWeights[sig.source] || 0;
          signalBreakdown[sig.source] = {
            distribution: sig.distribution,
            weight,
            contribution: sig.distribution.p_bullish * weight,
            timeframe: sig.timeframe || getDefaultTimeframe(sig.source),
          };
        }

        // 鈹€鈹€ 鍏抽敭鍥犵礌鍜岃鍛?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        const keyFactors: string[] = [];
        const warnings: string[] = [];

        for (const sig of signals) {
          for (const driver of sig.key_drivers) {
            if (driver.weight > 0.3) {
              keyFactors.push(`[${sig.source}] ${driver.factor} (${driver.direction}, 鏉冮噸${(driver.weight * 100).toFixed(0)}%)`);
            }
          }
        }

        if (conflictAnalysis.has_conflict) {
          warnings.push(`${conflictAnalysis.conflict_type}鍐茬獊: ${conflictAnalysis.root_cause}`);
        }
        if (consistencyReport.direction_conflicts > 0) {
          warnings.push(`涓庡巻鍙?{consistencyReport.direction_conflicts}娆″垽鏂柟鍚戝啿绐乣);
        }


        // 鈹€鈹€ 鏋勫缓缁撴灉 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        const result: FusionResult = {
          symbol,
          timestamp: new Date().toISOString(),
          distribution: fusedDistribution,
          conflict_analysis: conflictAnalysis,
          conditional_conclusions: conditionalConclusions,
          timeframe_analysis: conflictAnalysis.timeframe_analysis,
          signal_breakdown: signalBreakdown,
          consistency_report: consistencyReport,
          action_plan: actionPlan,
          key_factors: keyFactors,
          warnings,
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

// 鈹€鈹€ 浠庡閮∕CP鑾峰彇鏁版嵁骞惰浆鎹负姒傜巼鍒嗗竷 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
async function fetchAndConvertSignals(mcpManager: MCPClientManager, symbol: string): Promise<SignalInput[]> {
  const signals: SignalInput[] = [];

  const [techResult, fundResult, fgResult] = await Promise.allSettled([
    mcpManager.callTool("stock-scanner", "tradingview_technicals", { tickers: [symbol] }, 25000),
    mcpManager.callTool("stock-scanner", "tradingview_scan", {
      filters: [{ left: "name", operation: "equal", right: symbol.toUpperCase() }],
      columns: ["close", "price_earnings_ttm", "return_on_equity_fq", "total_revenue_fq", "net_income_fq", "total_debt_fq", "total_assets_fq"],
      limit: 1,
    }, 25000),
    mcpManager.callTool("stock-scanner", "sentiment_fear_greed", {}, 15000),
  ]);

  // 鎶€鏈潰杞崲
  const rawTech = techResult.status === "fulfilled" ? techResult.value : null;
  const techItems = extractData(rawTech);
  const tech = techItems[0]?.data || techItems[0] || null;
  if (tech) {
    const rsi = tech.RSI ?? 50;
    const macd = (tech["MACD.macd"] ?? 0) - (tech["MACD.signal"] ?? 0);
    const recAll = tech["Recommend.All"] ?? 0;
    const sma20 = tech.SMA20, sma50 = tech.SMA50;

    let bullishScore = 0.33;
    const drivers: KeyDriver[] = [];
    const assumptions: string[] = [];

    if (rsi < 30) { bullishScore += 0.2; drivers.push({ factor: `RSI=${rsi.toFixed(0)}瓒呭崠`, weight: 0.3, direction: "bullish" }); }
    else if (rsi > 70) { bullishScore -= 0.2; drivers.push({ factor: `RSI=${rsi.toFixed(0)}瓒呬拱`, weight: 0.3, direction: "bearish" }); }

    if (macd > 0) { bullishScore += 0.15; drivers.push({ factor: "MACD閲戝弶", weight: 0.25, direction: "bullish" }); }
    else if (macd < 0) { bullishScore -= 0.15; drivers.push({ factor: "MACD姝诲弶", weight: 0.25, direction: "bearish" }); }

    if (recAll > 0.3) { bullishScore += 0.1; drivers.push({ factor: "TradingView鐪嬪", weight: 0.2, direction: "bullish" }); }
    else if (recAll < -0.3) { bullishScore -= 0.1; drivers.push({ factor: "TradingView鐪嬬┖", weight: 0.2, direction: "bearish" }); }

    if (sma20 && sma50 && sma20 > sma50) { bullishScore += 0.1; assumptions.push("鍧囩嚎澶氬ご鎺掑垪锛岃秼鍔垮欢缁?); }
    else if (sma20 && sma50 && sma20 < sma50) { bullishScore -= 0.1; assumptions.push("鍧囩嚎绌哄ご鎺掑垪锛岃秼鍔夸笅琛?); }

    bullishScore = Math.max(0, Math.min(1, bullishScore));
    signals.push({
      source: "technical",
      timeframe: "1d-5d",
      distribution: { p_bullish: bullishScore, p_bearish: 1 - bullishScore - 0.15, p_neutral: 0.15 },
      assumptions,
      key_drivers: drivers,
      data_quality: 0.85,
      details: drivers.map(d => d.factor).join(", ") || "鎶€鏈潰涓€?,
    });
  }

  // 鍩烘湰闈㈣浆鎹?
  const rawFund = fundResult.status === "fulfilled" ? fundResult.value : null;
  const fundItems = extractData(rawFund);
  const fund = fundItems[0]?.data || fundItems[0] || null;
  if (fund) {
    let bullishScore = 0.33;
    const drivers: KeyDriver[] = [];
    const assumptions: string[] = [];
    const pe = fund.price_earnings_ttm;
    const roe = fund.return_on_equity_fq != null ? fund.return_on_equity_fq / 100 : null;

    if (pe && pe < 15) { bullishScore += 0.2; drivers.push({ factor: `PE=${pe.toFixed(1)}浣庝及鍊糮, weight: 0.3, direction: "bullish" }); }
    else if (pe && pe > 35) { bullishScore -= 0.15; drivers.push({ factor: `PE=${pe.toFixed(1)}楂樹及鍊糮, weight: 0.3, direction: "bearish" }); }

    if (roe && roe > 0.15) { bullishScore += 0.15; drivers.push({ factor: `ROE=${(roe * 100).toFixed(1)}%浼樼`, weight: 0.25, direction: "bullish" }); }
    if (roe && roe < 0) { bullishScore -= 0.15; drivers.push({ factor: "ROE涓鸿礋", weight: 0.25, direction: "bearish" }); }

    bullishScore = Math.max(0, Math.min(1, bullishScore));
    signals.push({
      source: "fundamental",
      timeframe: "3m-12m",
      distribution: { p_bullish: bullishScore, p_bearish: 1 - bullishScore - 0.2, p_neutral: 0.2 },
      assumptions,
      key_drivers: drivers,
      data_quality: 0.8,
      details: drivers.map(d => d.factor).join(", ") || "鍩烘湰闈腑鎬?,
    });
  }

  // 瀹忚/鎯呯华杞崲
  const fg = fgResult.status === "fulfilled" ? fgResult.value : null;
  if (fg) {
    const fgScore = fg.score != null ? fg.score : 50;
    const bullishScore = fgScore / 100;
    const rating = fg.rating || "";

    signals.push({
      source: "macro",
      timeframe: "1m-3m",
      distribution: { p_bullish: bullishScore, p_bearish: 1 - bullishScore - 0.1, p_neutral: 0.1 },
      assumptions: ["鎭愭儳璐┆鎸囨暟鍙嶆槧甯傚満鏁翠綋鎯呯华"],
      key_drivers: [{ factor: `鎭愭儳璐┆鎸囨暟: ${fgScore}/100`, weight: 0.5, direction: bullishScore > 0.5 ? "bullish" : "bearish" }],
      data_quality: 0.7,
      details: `鎭愭儳璐┆鎸囨暟: ${fgScore}/100 (${rating})`,
    });

    signals.push({
      source: "sentiment",
      timeframe: "1d-3d",
      distribution: { p_bullish: bullishScore * 0.8 + 0.1, p_bearish: (1 - bullishScore) * 0.8 + 0.1, p_neutral: 0.2 },
      assumptions: ["鎯呯华鏄环鏍肩殑鏀惧ぇ鍣?],
      key_drivers: [{ factor: `甯傚満鎯呯华: ${rating}`, weight: 0.4, direction: bullishScore > 0.5 ? "bullish" : "bearish" }],
      data_quality: 0.6,
      details: `甯傚満鎯呯华: ${rating}`,
    });
  }

  return signals;
}

// 鈹€鈹€ 鍐茬獊妫€娴?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function detectConflicts(signals: SignalInput[]): ConflictAnalysis {
  if (signals.length < 2) {
    return { has_conflict: false, conflict_type: "none", root_cause: null, conflicting_agents: [], debate_triggered: false };
  }

  // 鈹€鈹€ 绗竴姝ワ細鏃堕棿妗嗘灦瀵归綈妫€鏌?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const timeframeAnalysis = analyzeTimeframes(signals);

  // 濡傛灉鏃堕棿妗嗘灦涓嶄竴鑷达紝杩欎笉鏄啿绐侊紝鏄叡瀛?
  if (timeframeAnalysis.has_mismatch) {
    return {
      has_conflict: false,
      conflict_type: "timeframe_mismatch",
      root_cause: "淇″彿鏃堕棿妗嗘灦涓嶄竴鑷达紝涓嶆槸鍐茬獊鑰屾槸涓嶅悓缁村害鐨勫叡瀛?,
      conflicting_agents: [],
      debate_triggered: false,
      timeframe_analysis: timeframeAnalysis,
    };
  }

  // 鈹€鈹€ 绗簩姝ワ細鍚屾椂闂存鏋跺唴妫€娴嬫柟鍚戝啿绐?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const agentDirections: Record<string, { direction: string; assumptions: string[] }> = {};
  for (const sig of signals) {
    const dist = sig.distribution;
    let direction = "neutral";
    if (dist.p_bullish > 0.5) direction = "bullish";
    else if (dist.p_bearish > 0.5) direction = "bearish";
    agentDirections[sig.source] = { direction, assumptions: sig.assumptions };
  }

  const bullishAgents = Object.entries(agentDirections).filter(([_, v]) => v.direction === "bullish").map(([k]) => k);
  const bearishAgents = Object.entries(agentDirections).filter(([_, v]) => v.direction === "bearish").map(([k]) => k);

  if (bullishAgents.length === 0 || bearishAgents.length === 0) {
    return {
      has_conflict: false,
      conflict_type: "none",
      root_cause: null,
      conflicting_agents: [],
      debate_triggered: false,
      timeframe_analysis: timeframeAnalysis,
    };
  }

  // 鏈夋柟鍚戝啿绐侊紝鍒ゆ柇鏄〃闈㈠垎姝ц繕鏄牴鏈€у啿绐?
  const conflictingAgents = [...bullishAgents, ...bearishAgents];
  const bullishAssumptions = bullishAgents.flatMap(a => agentDirections[a].assumptions);
  const bearishAssumptions = bearishAgents.flatMap(a => agentDirections[a].assumptions);
  const hasContradictoryAssumptions = checkContradictoryAssumptions(bullishAssumptions, bearishAssumptions);

  if (hasContradictoryAssumptions) {
    return {
      has_conflict: true,
      conflict_type: "fundamental",
      root_cause: `${bullishAgents.join(",")}鐪嬪 vs ${bearishAgents.join(",")}鐪嬬┖锛屽亣璁惧墠鎻愬啿绐乣,
      conflicting_agents: conflictingAgents,
      debate_triggered: false,
      timeframe_analysis: timeframeAnalysis,
    };
  }

  return {
    has_conflict: true,
    conflict_type: "surface",
    root_cause: `${bullishAgents.join(",")}鐪嬪 vs ${bearishAgents.join(",")}鐪嬬┖锛屼絾鍋囪鍓嶆彁涓€鑷碻,
    conflicting_agents: conflictingAgents,
    debate_triggered: false,
    timeframe_analysis: timeframeAnalysis,
  };
}

// 鈹€鈹€ 鏃堕棿妗嗘灦鍒嗘瀽 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function analyzeTimeframes(signals: SignalInput[]): TimeframeAnalysis {
  // 鎸夋椂闂存鏋跺垎缁?
  const grouped: Record<string, string[]> = {};
  for (const sig of signals) {
    const tf = sig.timeframe || "unknown";
    if (!grouped[tf]) grouped[tf] = [];
    grouped[tf].push(sig.source);
  }

  const timeframes = Object.keys(grouped);
  const hasMismatch = timeframes.length > 1;

  // 鐢熸垚鍒嗗眰寤鸿
  const layeredRecommendations: LayeredRecommendation[] = [];

  if (hasMismatch) {
    // 鎸夋椂闂存鏋朵粠鐭埌闀挎帓搴?
    const timeframeOrder = ["1d-3d", "1d-5d", "1w-1m", "1m-3m", "3m-12m"];
    const sortedTimeframes = timeframes.sort((a, b) => {
      const ia = timeframeOrder.indexOf(a);
      const ib = timeframeOrder.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    for (const tf of sortedTimeframes) {
      const agentsInTf = grouped[tf];
      const signalsInTf = signals.filter(s => agentsInTf.includes(s.source));

      // 璁＄畻璇ユ椂闂存鏋剁殑缁煎悎鏂瑰悜
      let avgBullish = 0;
      let avgBearish = 0;
      for (const sig of signalsInTf) {
        avgBullish += sig.distribution.p_bullish;
        avgBearish += sig.distribution.p_bearish;
      }
      avgBullish /= signalsInTf.length;
      avgBearish /= signalsInTf.length;

      let direction: "bullish" | "bearish" | "neutral" = "neutral";
      if (avgBullish > 0.5) direction = "bullish";
      else if (avgBearish > 0.5) direction = "bearish";

      // 鏍规嵁鏃堕棿妗嗘灦璋冩暣浠撲綅
      let positionPct = 0;
      if (direction === "bullish") {
        if (tf.includes("1d")) positionPct = 3; // 瓒呯煭绾匡紝灏忎粨浣?
        else if (tf.includes("1w")) positionPct = 5; // 鐭嚎
        else if (tf.includes("1m")) positionPct = 8; // 涓嚎
        else positionPct = 10; // 闀跨嚎
      }

      layeredRecommendations.push({
        timeframe: tf,
        direction,
        agents: agentsInTf,
        position_pct: positionPct,
        reason: `${agentsInTf.join("+")}鍦?{tf}缁村害${direction === "bullish" ? "鐪嬪" : direction === "bearish" ? "鐪嬬┖" : "涓€?}`,
      });
    }
  }

  return {
    has_mismatch: hasMismatch,
    grouped_by_timeframe: grouped,
    layered_recommendations: layeredRecommendations,
  };
}

// 鈹€鈹€ 妫€鏌ュ亣璁炬槸鍚︾煕鐩?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function checkContradictoryAssumptions(bullish: string[], bearish: string[]): boolean {
  // 绠€鍗曠殑鍏抽敭璇嶅尮閰嶆娴嬬煕鐩?
  const contradictionPairs = [
    ["鍔犳伅", "闄嶆伅"],
    ["琛伴€€", "澶嶈嫃"],
    ["閫氳儉", "閫氱缉"],
    ["楣版淳", "楦芥淳"],
    ["鏀剁揣", "瀹芥澗"],
  ];

  for (const [a, b] of contradictionPairs) {
    const bullishHasA = bullish.some(assumption => assumption.includes(a));
    const bearishHasB = bearish.some(assumption => assumption.includes(b));
    if (bullishHasA && bearishHasB) return true;

    const bullishHasB = bullish.some(assumption => assumption.includes(b));
    const bearishHasA = bearish.some(assumption => assumption.includes(a));
    if (bullishHasB && bearishHasA) return true;
  }

  return false;
}

// 鈹€鈹€ 绠楁湳璋冩暣锛堝崰浣嶅疄鐜帮紝鐪熸鐨?LLM 杈╄灏氭湭鎺ュ叆锛夆攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function runArithmeticAdjustment(signals: SignalInput[]): DebateRound[] {
  const rounds: DebateRound[] = [];

  // 鎵惧埌鍐茬獊鍙屾柟
  const bullishSignals = signals.filter(s => s.distribution.p_bullish > 0.5);
  const bearishSignals = signals.filter(s => s.distribution.p_bearish > 0.5);

  if (bullishSignals.length === 0 || bearishSignals.length === 0) return rounds;

  const bullAgent = bullishSignals[0];
  const bearAgent = bearishSignals[0];

  // Round 1: 闄堣堪绔嬪満
  rounds.push({
    round: 1,
    [bullAgent.source]: `鐪嬪锛屽叧閿亣璁? ${bullAgent.assumptions.join("; ")}`,
    [bearAgent.source]: `鐪嬬┖锛屽叧閿亣璁? ${bearAgent.assumptions.join("; ")}`,
  });

  // Round 2: 璐ㄧ枒鍋囪
  const bullChallenges = bearAgent.assumptions.map(a => `璐ㄧ枒: "${a}"鏄惁鎴愮珛锛焋);
  const bearChallenges = bullAgent.assumptions.map(a => `璐ㄧ枒: "${a}"鏄惁鎴愮珛锛焋);

  rounds.push({
    round: 2,
    [`${bearAgent.source}_璐ㄧ枒_${bullAgent.source}`]: bullChallenges.join("; "),
    [`${bullAgent.source}_璐ㄧ枒_${bearAgent.source}`]: bearChallenges.join("; "),
  });

  // Round 3: 绠楁湳璋冩暣锛堝崰浣嶅疄鐜?鈥?纭紪鐮?0.1 鍚庨€€锛涚湡姝ｇ殑 LLM 杈╄灏氭湭鎺ュ叆锛?
  //          鏈潵搴旇皟鐢?LLM 鏍规嵁瀵规柟璁虹偣鍔ㄦ€佽绠楄皟鏁村箙搴︼級
  const bullAdjustment = 0.1; // 鐪嬪鏂瑰悗閫€10%
  const bearAdjustment = 0.1; // 鐪嬬┖鏂瑰悗閫€10%

  rounds.push({
    round: 3,
    [`${bullAgent.source}_璋冩暣`]: `p_bullish: ${bullAgent.distribution.p_bullish.toFixed(2)} 鈫?${(bullAgent.distribution.p_bullish - bullAdjustment).toFixed(2)}`,
    [`${bearAgent.source}_璋冩暣`]: `p_bearish: ${bearAgent.distribution.p_bearish.toFixed(2)} 鈫?${(bearAgent.distribution.p_bearish - bearAdjustment).toFixed(2)}`,
  });

  return rounds;
}

// NOTE: This function mutates signal distributions in place for simplicity.
// If re-entrant or concurrent access is needed, shallow-copy distributions first:
//   const sig = { ...s, distribution: { ...s.distribution } };
// 鈹€鈹€ 绠楁湳璋冩暣鍚庢鐜囦慨姝ｏ紙闈?LLM 杈╄锛夆攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function adjustDistributionsAfterAdjustment(signals: SignalInput[], rounds: DebateRound[]): void {
  if (rounds.length < 3) return;

  // 鎵惧埌鍐茬獊鍙屾柟
  const bullishSignals = signals.filter(s => s.distribution.p_bullish > 0.5);
  const bearishSignals = signals.filter(s => s.distribution.p_bearish > 0.5);

  if (bullishSignals.length === 0 || bearishSignals.length === 0) return;

  // 璋冩暣姒傜巼鍒嗗竷锛堝悜涓棿闈犳嫝锛?
  for (const sig of bullishSignals) {
    const adjustment = 0.1;
    sig.distribution.p_bullish -= adjustment;
    sig.distribution.p_neutral += adjustment / 2;
    sig.distribution.p_bearish += adjustment / 2;
  }

  for (const sig of bearishSignals) {
    const adjustment = 0.1;
    sig.distribution.p_bearish -= adjustment;
    sig.distribution.p_neutral += adjustment / 2;
    sig.distribution.p_bullish += adjustment / 2;
  }
}

// 鈹€鈹€ 铻嶅悎姒傜巼鍒嗗竷 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function fuseDistributions(signals: SignalInput[], weights: Record<string, number>): ProbabilityDistribution {
  let p_bullish = 0;
  let p_bearish = 0;
  let p_neutral = 0;
  let totalWeight = 0;

  for (const sig of signals) {
    const weight = (weights[sig.source] || 0) * sig.data_quality;
    p_bullish += sig.distribution.p_bullish * weight;
    p_bearish += sig.distribution.p_bearish * weight;
    p_neutral += sig.distribution.p_neutral * weight;
    totalWeight += weight;
  }

  if (totalWeight > 0) {
    p_bullish /= totalWeight;
    p_bearish /= totalWeight;
    p_neutral /= totalWeight;
  }

  // 褰掍竴鍖?
  const sum = p_bullish + p_bearish + p_neutral;
  if (sum > 0) {
    p_bullish /= sum;
    p_bearish /= sum;
    p_neutral /= sum;
  }

  // NOTE: 缃俊鍖洪棿鏄繎浼煎€硷紝鏈変互涓嬪眬闄愶細
  //   1. 蹇界暐浜嗗崗鏂瑰樊椤癸紙鍋囪鍚勪俊鍙风嫭绔嬶紝瀹為檯瀛樺湪鍏宠仈锛?
  //   2. 1.96 鏉ヨ嚜姝ｆ€佸垎甯冿紝浣嗗 bounded [0,1] 姒傜巼搴旂敤涓嶄弗璋?
  //   3. 鏀硅繘鏂瑰悜锛氬 bounded [0,1] 姒傜巼鍙敤 Beta 鍒嗗竷鎴栧叾浠栭€傚綋鏂规硶
  const expectedReturn = (p_bullish - p_bearish) * 0.1; // 绠€鍖栵細鍋囪鐗涘競娑?0%锛岀唺甯傝穼10%
  const uncertainty = Math.sqrt(p_bullish * (1 - p_bullish) + p_bearish * (1 - p_bearish));
  const confidenceInterval: [number, number] = [
    Math.round((expectedReturn - uncertainty * 1.96) * 100) / 100,
    Math.round((expectedReturn + uncertainty * 1.96) * 100) / 100,
  ];

  return {
    p_bullish: Math.round(p_bullish * 100) / 100,
    p_bearish: Math.round(p_bearish * 100) / 100,
    p_neutral: Math.round(p_neutral * 100) / 100,
    expected_return: Math.round(expectedReturn * 100) / 100,
    confidence_interval: confidenceInterval,
  };
}

// 鈹€鈹€ 鐢熸垚鏉′欢鍖栫粨璁?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function generateConditionalConclusions(signals: SignalInput[], conflict: ConflictAnalysis): ConditionalConclusion[] {
  const conclusions: ConditionalConclusion[] = [];

  if (!conflict.has_conflict || conflict.conflict_type === "surface") {
    // 鏃犲啿绐佹垨琛ㄩ潰鍒嗘锛屼笉闇€瑕佹潯浠跺寲缁撹
    return conclusions;
  }

  // 鎵惧埌鍐茬獊鍙屾柟
  const bullishSignals = signals.filter(s => s.distribution.p_bullish > 0.5);
  const bearishSignals = signals.filter(s => s.distribution.p_bearish > 0.5);

  if (bullishSignals.length === 0 || bearishSignals.length === 0) return conclusions;

  const bullAgent = bullishSignals[0];
  const bearAgent = bearishSignals[0];

  // 鍩轰簬鍙屾柟鐨勫亣璁剧敓鎴愭潯浠跺寲缁撹
  // 鐪嬪鏂圭殑鏉′欢
  if (bullAgent.assumptions.length > 0) {
    conclusions.push({
      condition: bullAgent.assumptions[0],
      probability: bullAgent.distribution.p_bullish,
      dominant_view: bullAgent.source,
      conclusion: `鐪嬪锛岄鏈熸敹鐩?{(bullAgent.distribution.p_bullish * 10).toFixed(1)}%`,
      position_pct: Math.round(bullAgent.distribution.p_bullish * 15),
    });
  }

  // 鐪嬬┖鏂圭殑鏉′欢
  if (bearAgent.assumptions.length > 0) {
    conclusions.push({
      condition: bearAgent.assumptions[0],
      probability: bearAgent.distribution.p_bearish,
      dominant_view: bearAgent.source,
      conclusion: `鐪嬬┖锛岄鏈熸敹鐩?{(-bearAgent.distribution.p_bearish * 10).toFixed(1)}%`,
      position_pct: 0,
    });
  }

  return conclusions;
}

// 鈹€鈹€ 涓€鑷存€ф牎楠?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function checkConsistency(
  history: any[],
  distribution: ProbabilityDistribution
): {
  consistent: boolean;
  previous_judgments: number;
  direction_conflicts: number;
  explanation: string;
} {
  if (history.length === 0) {
    return {
      consistent: true,
      previous_judgments: 0,
      direction_conflicts: 0,
      explanation: "鏃犲巻鍙插垽鏂紝棣栨鍒嗘瀽",
    };
  }

  const currentDirection = distribution.p_bullish > 0.5 ? "bullish" : distribution.p_bearish > 0.5 ? "bearish" : "neutral";
  let conflicts = 0;
  const recentConflicts: string[] = [];

  for (const j of history.slice(0, 5)) {
    if (j.direction !== currentDirection && j.direction !== "neutral" && currentDirection !== "neutral") {
      conflicts++;
      const age = Math.round((Date.now() - new Date(j.created_at).getTime()) / 86400000);
      recentConflicts.push(`${age}澶╁墠鍒ゆ柇涓?{j.direction === "bullish" ? "鐪嬪" : "鐪嬬┖"}(缃俊搴?{j.confidence}%)`);
    }
  }

  return {
    consistent: conflicts === 0,
    previous_judgments: history.length,
    direction_conflicts: conflicts,
    explanation: conflicts > 0
      ? `涓庤繎鏈?{conflicts}娆″垽鏂柟鍚戝啿绐? ${recentConflicts.join("; ")}`
      : `涓庤繎鏈?{Math.min(5, history.length)}娆″垽鏂柟鍚戜竴鑷碻,
  };
}

// 鈹€鈹€ 鐢熸垚琛屽姩璁″垝 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function generateActionPlan(
  distribution: ProbabilityDistribution,
  currentPrice: number,
  timeframe: string,
  conflict: ConflictAnalysis,
  conditionalConclusions: ConditionalConclusion[]
): FusionResult["action_plan"] {
  if (!currentPrice) {
    return {
      action: "watch",
      position_pct: 0,
      entry_price: 0,
      target_price: 0,
      stop_loss: 0,
      reason: "鏃犳硶鑾峰彇褰撳墠浠锋牸",
      contingency: "",
    };
  }

  // 鈹€鈹€ 鏃堕棿妗嗘灦涓嶅尮閰嶏細鐢熸垚鍒嗗眰鎸佷粨寤鸿 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  if (conflict.conflict_type === "timeframe_mismatch" && conflict.timeframe_analysis) {
    const layered = conflict.timeframe_analysis.layered_recommendations;
    const totalPosition = layered.reduce((sum, l) => sum + l.position_pct, 0);

    // 缁煎悎鏂瑰悜锛氱煭绾夸富瀵?
    const shortTerm = layered.find(l => l.timeframe.includes("1d") || l.timeframe.includes("1w"));
    const mediumTerm = layered.find(l => l.timeframe.includes("1m"));
    const longTerm = layered.find(l => l.timeframe.includes("3m"));

    let reason = "鏃堕棿妗嗘灦鍒嗗眰: ";
    if (shortTerm) reason += `鐭嚎${shortTerm.direction === "bullish" ? "鐪嬪" : "鐪嬬┖"} `;
    if (mediumTerm) reason += `涓嚎${mediumTerm.direction === "bullish" ? "鐪嬪" : "鐪嬬┖"} `;
    if (longTerm) reason += `闀跨嚎${longTerm.direction === "bullish" ? "鐪嬪" : "鐪嬬┖"}`;

    return {
      action: totalPosition > 5 ? "buy" : totalPosition > 0 ? "hold" : "watch",
      position_pct: Math.min(totalPosition, 15), // 涓婇檺15%
      entry_price: currentPrice,
      target_price: Math.round(currentPrice * (1 + 0.1) * 100) / 100,
      stop_loss: Math.round(currentPrice * (1 - 0.05) * 100) / 100,
      reason,
      contingency: "鐭嚎浠撲綅闇€鏇翠弗鏍兼鎹燂紝涓暱绾垮彲閫傚綋鏀惧",
      layered_positions: layered,
    };
  }

  const isBullish = distribution.p_bullish > 0.5;
  const confidence = Math.max(distribution.p_bullish, distribution.p_bearish);
  const conflictPenalty = conflict.has_conflict ? 0.5 : 1.0;

  // 濡傛灉鏈夋牴鏈€у啿绐侊紝浣跨敤鏉′欢鍖栫粨璁?
  if (conflict.conflict_type === "fundamental" && conditionalConclusions.length > 0) {
    const primaryConclusion = conditionalConclusions[0];
    return {
      action: primaryConclusion.position_pct > 5 ? "buy" : "hold",
      position_pct: Math.round(primaryConclusion.position_pct * conflictPenalty),
      entry_price: currentPrice,
      target_price: isBullish
        ? Math.round(currentPrice * (1 + confidence * 0.15) * 100) / 100
        : Math.round(currentPrice * (1 - confidence * 0.15) * 100) / 100,
      stop_loss: isBullish
        ? Math.round(currentPrice * (1 - 0.05) * 100) / 100
        : Math.round(currentPrice * (1 + 0.05) * 100) / 100,
      reason: `鏉′欢鍖栫粨璁? ${primaryConclusion.condition}`,
      contingency: `濡傛灉${conditionalConclusions[1]?.condition || "鐩稿弽鏉′欢鍙戠敓"}锛岀珛鍗宠皟鏁翠粨浣峘,
    };
  }

  // 甯歌鎯呭喌
  if (isBullish) {
    return {
      action: "buy",
      position_pct: Math.round(confidence * 15 * conflictPenalty),
      entry_price: currentPrice,
      target_price: Math.round(currentPrice * (1 + confidence * 0.15) * 100) / 100,
      stop_loss: Math.round(currentPrice * (1 - 0.05) * 100) / 100,
      reason: `鐪嬪姒傜巼${(distribution.p_bullish * 100).toFixed(0)}%锛岄鏈熸敹鐩?{(distribution.expected_return! * 100).toFixed(1)}%`,
      contingency: conflict.has_conflict ? "瀛樺湪鍒嗘锛屼粨浣嶆帶鍒跺湪8%浠ュ唴" : "",
    };
  } else if (distribution.p_bearish > 0.5) {
    return {
      action: "sell",
      position_pct: 0,
      entry_price: currentPrice,
      target_price: Math.round(currentPrice * (1 - confidence * 0.15) * 100) / 100,
      stop_loss: Math.round(currentPrice * (1 + 0.05) * 100) / 100,
      reason: `鐪嬬┖姒傜巼${(distribution.p_bearish * 100).toFixed(0)}%锛屽缓璁鏈涙垨鍋氱┖`,
      contingency: "",
    };
  } else {
    return {
      action: "hold",
      position_pct: 0,
      entry_price: currentPrice,
      target_price: currentPrice,
      stop_loss: 0,
      reason: "鏂瑰悜涓嶆槑纭紝寤鸿瑙傛湜",
      contingency: "",
    };
  }
}
