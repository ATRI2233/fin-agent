import { ToolRegistration } from '../../types.js';
import { MCPClientManager } from '../../mcp/mcpClientManager.js';
import { getSignalWeights, autoLogAnalysis, getJudgments, getAllExperience } from '../../memory/memoryStore.js';

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

// ── 概率分布类型定义 ─────────────────────────────────────
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

// ── 默认权重 ─────────────────────────────────────────────
const DEFAULT_WEIGHTS: Record<string, number> = {
  technical: 0.35,
  fundamental: 0.30,
  sentiment: 0.10,
  macro: 0.10,
  risk: 0.10,
  smart_money: 0.05,
};

// ── 默认时间框架 ─────────────────────────────────────────
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
      description: "概率分布融合引擎：接收多个 agent 的概率分布，检测冲突并触发辩论协议，输出条件化结论与一致性报告。",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "股票代码" },
        signals: {
          type: "object",
          description: "7个agent的概率分布信号",
          additionalProperties: {
            type: "object",
            properties: {
              timeframe: { type: "string", description: "信号时间框架: 1d-5d/1w-1m/1m-3m/3m-12m" },
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
        timeframe: { type: "string", description: "时间框架: 1d/1w/1m/3m", default: "1m" },
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
          content: [{ type: "text", text: JSON.stringify({ error: "缺少 symbol 参数" }) }],
          isError: true,
        };
      }

      try {
        // ── 如果没有传入signals，从外部MCP获取 ─────────────
        let signals: SignalInput[] = [];

        if (Object.keys(signalsInput).length > 0) {
          // 使用传入的概率分布
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
          // 从外部MCP获取数据，转换为概率分布
          signals = await fetchAndConvertSignals(mcpManager, symbol);
        }

        // ── 冲突检测 ─────────────────────────────────────
        const conflictAnalysis = detectConflicts(signals);

        // ── 如果是根本性冲突，执行辩论协议 ─────────────────
        if (conflictAnalysis.conflict_type === "fundamental") {
          conflictAnalysis.debate_triggered = true;
          conflictAnalysis.debate_rounds = runDebateProtocol(signals);
          // 辩论后调整概率分布
          adjustDistributionsAfterDebate(signals, conflictAnalysis.debate_rounds);
        }

        // ── 融合概率分布 ─────────────────────────────────
        const fusedDistribution = fuseDistributions(signals);

        // ── 生成条件化结论 ────────────────────────────────
        const conditionalConclusions = generateConditionalConclusions(signals, conflictAnalysis);

        // ── 一致性校验 ───────────────────────────────────
        const history = getJudgments(symbol, 10);
        const consistencyReport = checkConsistency(history, fusedDistribution);

        // ── 获取当前价格 ─────────────────────────────────
        let currentPrice = 0;
        try {
          const rawQuote = await mcpManager.callTool("stock-scanner", "tradingview_quote", { tickers: [symbol] }, 15000);
          const quoteItems = extractData(rawQuote);
          currentPrice = quoteItems[0]?.data?.close ?? quoteItems[0]?.close ?? 0;
        } catch (e) { console.error("[signalFusion] failed to fetch quote:", e); }

        // ── 生成行动计划 ─────────────────────────────────
        const actionPlan = generateActionPlan(fusedDistribution, currentPrice, timeframe, conflictAnalysis, conditionalConclusions);

        // ── 构建信号分解 ─────────────────────────────────
        const signalBreakdown: Record<string, { distribution: ProbabilityDistribution; weight: number; contribution: number; timeframe: string }> = {};
        for (const sig of signals) {
          const weight = DEFAULT_WEIGHTS[sig.source] || 0;
          signalBreakdown[sig.source] = {
            distribution: sig.distribution,
            weight,
            contribution: sig.distribution.p_bullish * weight,
            timeframe: sig.timeframe || getDefaultTimeframe(sig.source),
          };
        }

        // ── 关键因素和警告 ────────────────────────────────
        const keyFactors: string[] = [];
        const warnings: string[] = [];

        for (const sig of signals) {
          for (const driver of sig.key_drivers) {
            if (driver.weight > 0.3) {
              keyFactors.push(`[${sig.source}] ${driver.factor} (${driver.direction}, 权重${(driver.weight * 100).toFixed(0)}%)`);
            }
          }
        }

        if (conflictAnalysis.has_conflict) {
          warnings.push(`${conflictAnalysis.conflict_type}冲突: ${conflictAnalysis.root_cause}`);
        }
        if (consistencyReport.direction_conflicts > 0) {
          warnings.push(`与历史${consistencyReport.direction_conflicts}次判断方向冲突`);
        }

        // ── 记录本次判断 ─────────────────────────────────
        try {
          autoLogAnalysis({
            symbol,
            direction: fusedDistribution.p_bullish > 0.5 ? "bullish" : fusedDistribution.p_bearish > 0.5 ? "bearish" : "neutral",
            confidence: Math.round(Math.max(fusedDistribution.p_bullish, fusedDistribution.p_bearish) * 100),
            key_prices: { support: [actionPlan.stop_loss], resistance: [actionPlan.target_price] },
            reasons: keyFactors.join("; "),
            source_signals: Object.fromEntries(signals.map((s) => [s.source, { distribution: s.distribution, weight: DEFAULT_WEIGHTS[s.source] || 0 }])),
          });
        } catch {}

        // ── 构建结果 ─────────────────────────────────────
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

// ── 从外部MCP获取数据并转换为概率分布 ─────────────────────
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

  // 技术面转换
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

    if (rsi < 30) { bullishScore += 0.2; drivers.push({ factor: `RSI=${rsi.toFixed(0)}超卖`, weight: 0.3, direction: "bullish" }); }
    else if (rsi > 70) { bullishScore -= 0.2; drivers.push({ factor: `RSI=${rsi.toFixed(0)}超买`, weight: 0.3, direction: "bearish" }); }

    if (macd > 0) { bullishScore += 0.15; drivers.push({ factor: "MACD金叉", weight: 0.25, direction: "bullish" }); }
    else if (macd < 0) { bullishScore -= 0.15; drivers.push({ factor: "MACD死叉", weight: 0.25, direction: "bearish" }); }

    if (recAll > 0.3) { bullishScore += 0.1; drivers.push({ factor: "TradingView看多", weight: 0.2, direction: "bullish" }); }
    else if (recAll < -0.3) { bullishScore -= 0.1; drivers.push({ factor: "TradingView看空", weight: 0.2, direction: "bearish" }); }

    if (sma20 && sma50 && sma20 > sma50) { bullishScore += 0.1; assumptions.push("均线多头排列，趋势延续"); }
    else if (sma20 && sma50 && sma20 < sma50) { bullishScore -= 0.1; assumptions.push("均线空头排列，趋势下行"); }

    bullishScore = Math.max(0, Math.min(1, bullishScore));
    signals.push({
      source: "technical",
      timeframe: "1d-5d",
      distribution: { p_bullish: bullishScore, p_bearish: 1 - bullishScore - 0.15, p_neutral: 0.15 },
      assumptions,
      key_drivers: drivers,
      data_quality: 0.85,
      details: drivers.map(d => d.factor).join(", ") || "技术面中性",
    });
  }

  // 基本面转换
  const rawFund = fundResult.status === "fulfilled" ? fundResult.value : null;
  const fundItems = extractData(rawFund);
  const fund = fundItems[0]?.data || fundItems[0] || null;
  if (fund) {
    let bullishScore = 0.33;
    const drivers: KeyDriver[] = [];
    const assumptions: string[] = [];
    const pe = fund.price_earnings_ttm;
    const roe = fund.return_on_equity_fq != null ? fund.return_on_equity_fq / 100 : null;

    if (pe && pe < 15) { bullishScore += 0.2; drivers.push({ factor: `PE=${pe.toFixed(1)}低估值`, weight: 0.3, direction: "bullish" }); }
    else if (pe && pe > 35) { bullishScore -= 0.15; drivers.push({ factor: `PE=${pe.toFixed(1)}高估值`, weight: 0.3, direction: "bearish" }); }

    if (roe && roe > 0.15) { bullishScore += 0.15; drivers.push({ factor: `ROE=${(roe * 100).toFixed(1)}%优秀`, weight: 0.25, direction: "bullish" }); }
    if (roe && roe < 0) { bullishScore -= 0.15; drivers.push({ factor: "ROE为负", weight: 0.25, direction: "bearish" }); }

    bullishScore = Math.max(0, Math.min(1, bullishScore));
    signals.push({
      source: "fundamental",
      timeframe: "3m-12m",
      distribution: { p_bullish: bullishScore, p_bearish: 1 - bullishScore - 0.2, p_neutral: 0.2 },
      assumptions,
      key_drivers: drivers,
      data_quality: 0.8,
      details: drivers.map(d => d.factor).join(", ") || "基本面中性",
    });
  }

  // 宏观/情绪转换
  const fg = fgResult.status === "fulfilled" ? fgResult.value : null;
  if (fg) {
    const fgScore = fg.score != null ? fg.score : 50;
    const bullishScore = fgScore / 100;
    const rating = fg.rating || "";

    signals.push({
      source: "macro",
      timeframe: "1m-3m",
      distribution: { p_bullish: bullishScore, p_bearish: 1 - bullishScore - 0.1, p_neutral: 0.1 },
      assumptions: ["恐惧贪婪指数反映市场整体情绪"],
      key_drivers: [{ factor: `恐惧贪婪指数: ${fgScore}/100`, weight: 0.5, direction: bullishScore > 0.5 ? "bullish" : "bearish" }],
      data_quality: 0.7,
      details: `恐惧贪婪指数: ${fgScore}/100 (${rating})`,
    });

    signals.push({
      source: "sentiment",
      timeframe: "1d-3d",
      distribution: { p_bullish: bullishScore * 0.8 + 0.1, p_bearish: (1 - bullishScore) * 0.8 + 0.1, p_neutral: 0.2 },
      assumptions: ["情绪是价格的放大器"],
      key_drivers: [{ factor: `市场情绪: ${rating}`, weight: 0.4, direction: bullishScore > 0.5 ? "bullish" : "bearish" }],
      data_quality: 0.6,
      details: `市场情绪: ${rating}`,
    });
  }

  return signals;
}

// ── 冲突检测 ─────────────────────────────────────────────
function detectConflicts(signals: SignalInput[]): ConflictAnalysis {
  if (signals.length < 2) {
    return { has_conflict: false, conflict_type: "none", root_cause: null, conflicting_agents: [], debate_triggered: false };
  }

  // ── 第一步：时间框架对齐检查 ────────────────────────────
  const timeframeAnalysis = analyzeTimeframes(signals);

  // 如果时间框架不一致，这不是冲突，是共存
  if (timeframeAnalysis.has_mismatch) {
    return {
      has_conflict: false,
      conflict_type: "timeframe_mismatch",
      root_cause: "信号时间框架不一致，不是冲突而是不同维度的共存",
      conflicting_agents: [],
      debate_triggered: false,
      timeframe_analysis: timeframeAnalysis,
    };
  }

  // ── 第二步：同时间框架内检测方向冲突 ───────────────────
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

  // 有方向冲突，判断是表面分歧还是根本性冲突
  const conflictingAgents = [...bullishAgents, ...bearishAgents];
  const bullishAssumptions = bullishAgents.flatMap(a => agentDirections[a].assumptions);
  const bearishAssumptions = bearishAgents.flatMap(a => agentDirections[a].assumptions);
  const hasContradictoryAssumptions = checkContradictoryAssumptions(bullishAssumptions, bearishAssumptions);

  if (hasContradictoryAssumptions) {
    return {
      has_conflict: true,
      conflict_type: "fundamental",
      root_cause: `${bullishAgents.join(",")}看多 vs ${bearishAgents.join(",")}看空，假设前提冲突`,
      conflicting_agents: conflictingAgents,
      debate_triggered: false,
      timeframe_analysis: timeframeAnalysis,
    };
  }

  return {
    has_conflict: true,
    conflict_type: "surface",
    root_cause: `${bullishAgents.join(",")}看多 vs ${bearishAgents.join(",")}看空，但假设前提一致`,
    conflicting_agents: conflictingAgents,
    debate_triggered: false,
    timeframe_analysis: timeframeAnalysis,
  };
}

// ── 时间框架分析 ─────────────────────────────────────────
function analyzeTimeframes(signals: SignalInput[]): TimeframeAnalysis {
  // 按时间框架分组
  const grouped: Record<string, string[]> = {};
  for (const sig of signals) {
    const tf = sig.timeframe || "unknown";
    if (!grouped[tf]) grouped[tf] = [];
    grouped[tf].push(sig.source);
  }

  const timeframes = Object.keys(grouped);
  const hasMismatch = timeframes.length > 1;

  // 生成分层建议
  const layeredRecommendations: LayeredRecommendation[] = [];

  if (hasMismatch) {
    // 按时间框架从短到长排序
    const timeframeOrder = ["1d-3d", "1d-5d", "1w-1m", "1m-3m", "3m-12m"];
    const sortedTimeframes = timeframes.sort((a, b) => {
      const ia = timeframeOrder.indexOf(a);
      const ib = timeframeOrder.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    for (const tf of sortedTimeframes) {
      const agentsInTf = grouped[tf];
      const signalsInTf = signals.filter(s => agentsInTf.includes(s.source));

      // 计算该时间框架的综合方向
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

      // 根据时间框架调整仓位
      let positionPct = 0;
      if (direction === "bullish") {
        if (tf.includes("1d")) positionPct = 3; // 超短线，小仓位
        else if (tf.includes("1w")) positionPct = 5; // 短线
        else if (tf.includes("1m")) positionPct = 8; // 中线
        else positionPct = 10; // 长线
      }

      layeredRecommendations.push({
        timeframe: tf,
        direction,
        agents: agentsInTf,
        position_pct: positionPct,
        reason: `${agentsInTf.join("+")}在${tf}维度${direction === "bullish" ? "看多" : direction === "bearish" ? "看空" : "中性"}`,
      });
    }
  }

  return {
    has_mismatch: hasMismatch,
    grouped_by_timeframe: grouped,
    layered_recommendations: layeredRecommendations,
  };
}

// ── 检查假设是否矛盾 ─────────────────────────────────────
function checkContradictoryAssumptions(bullish: string[], bearish: string[]): boolean {
  // 简单的关键词匹配检测矛盾
  const contradictionPairs = [
    ["加息", "降息"],
    ["衰退", "复苏"],
    ["通胀", "通缩"],
    ["鹰派", "鸽派"],
    ["收紧", "宽松"],
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

// ── 辩论协议 ─────────────────────────────────────────────
function runDebateProtocol(signals: SignalInput[]): DebateRound[] {
  const rounds: DebateRound[] = [];

  // 找到冲突双方
  const bullishSignals = signals.filter(s => s.distribution.p_bullish > 0.5);
  const bearishSignals = signals.filter(s => s.distribution.p_bearish > 0.5);

  if (bullishSignals.length === 0 || bearishSignals.length === 0) return rounds;

  const bullAgent = bullishSignals[0];
  const bearAgent = bearishSignals[0];

  // Round 1: 陈述立场
  rounds.push({
    round: 1,
    [bullAgent.source]: `看多，关键假设: ${bullAgent.assumptions.join("; ")}`,
    [bearAgent.source]: `看空，关键假设: ${bearAgent.assumptions.join("; ")}`,
  });

  // Round 2: 质疑假设
  const bullChallenges = bearAgent.assumptions.map(a => `质疑: "${a}"是否成立？`);
  const bearChallenges = bullAgent.assumptions.map(a => `质疑: "${a}"是否成立？`);

  rounds.push({
    round: 2,
    [`${bearAgent.source}_质疑_${bullAgent.source}`]: bullChallenges.join("; "),
    [`${bullAgent.source}_质疑_${bearAgent.source}`]: bearChallenges.join("; "),
  });

  // Round 3: 调整立场（模拟调整，实际应由LLM判断）
  const bullAdjustment = 0.1; // 看多方后退10%
  const bearAdjustment = 0.1; // 看空方后退10%

  rounds.push({
    round: 3,
    [`${bullAgent.source}_调整`]: `p_bullish: ${bullAgent.distribution.p_bullish.toFixed(2)} → ${(bullAgent.distribution.p_bullish - bullAdjustment).toFixed(2)}`,
    [`${bearAgent.source}_调整`]: `p_bearish: ${bearAgent.distribution.p_bearish.toFixed(2)} → ${(bearAgent.distribution.p_bearish - bearAdjustment).toFixed(2)}`,
  });

  return rounds;
}

// NOTE: This function mutates signal distributions in place for simplicity.
// If re-entrant or concurrent access is needed, shallow-copy distributions first:
//   const sig = { ...s, distribution: { ...s.distribution } };
// ── 辩论后调整概率分布 ───────────────────────────────────
function adjustDistributionsAfterDebate(signals: SignalInput[], rounds: DebateRound[]): void {
  if (rounds.length < 3) return;

  // 找到冲突双方
  const bullishSignals = signals.filter(s => s.distribution.p_bullish > 0.5);
  const bearishSignals = signals.filter(s => s.distribution.p_bearish > 0.5);

  if (bullishSignals.length === 0 || bearishSignals.length === 0) return;

  // 调整概率分布（向中间靠拢）
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

// ── 融合概率分布 ─────────────────────────────────────────
function fuseDistributions(signals: SignalInput[]): ProbabilityDistribution {
  let p_bullish = 0;
  let p_bearish = 0;
  let p_neutral = 0;
  let totalWeight = 0;

  for (const sig of signals) {
    const weight = (DEFAULT_WEIGHTS[sig.source] || 0) * sig.data_quality;
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

  // 归一化
  const sum = p_bullish + p_bearish + p_neutral;
  if (sum > 0) {
    p_bullish /= sum;
    p_bearish /= sum;
    p_neutral /= sum;
  }

  // 计算预期收益和置信区间
  const expectedReturn = (p_bullish - p_bearish) * 0.1; // 简化：假设牛市涨10%，熊市跌10%
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

// ── 生成条件化结论 ───────────────────────────────────────
function generateConditionalConclusions(signals: SignalInput[], conflict: ConflictAnalysis): ConditionalConclusion[] {
  const conclusions: ConditionalConclusion[] = [];

  if (!conflict.has_conflict || conflict.conflict_type === "surface") {
    // 无冲突或表面分歧，不需要条件化结论
    return conclusions;
  }

  // 找到冲突双方
  const bullishSignals = signals.filter(s => s.distribution.p_bullish > 0.5);
  const bearishSignals = signals.filter(s => s.distribution.p_bearish > 0.5);

  if (bullishSignals.length === 0 || bearishSignals.length === 0) return conclusions;

  const bullAgent = bullishSignals[0];
  const bearAgent = bearishSignals[0];

  // 基于双方的假设生成条件化结论
  // 看多方的条件
  if (bullAgent.assumptions.length > 0) {
    conclusions.push({
      condition: bullAgent.assumptions[0],
      probability: bullAgent.distribution.p_bullish,
      dominant_view: bullAgent.source,
      conclusion: `看多，预期收益${(bullAgent.distribution.p_bullish * 10).toFixed(1)}%`,
      position_pct: Math.round(bullAgent.distribution.p_bullish * 15),
    });
  }

  // 看空方的条件
  if (bearAgent.assumptions.length > 0) {
    conclusions.push({
      condition: bearAgent.assumptions[0],
      probability: bearAgent.distribution.p_bearish,
      dominant_view: bearAgent.source,
      conclusion: `看空，预期收益${(bearAgent.distribution.p_bearish * 10).toFixed(1)}%`,
      position_pct: 0,
    });
  }

  return conclusions;
}

// ── 一致性校验 ───────────────────────────────────────────
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
      explanation: "无历史判断，首次分析",
    };
  }

  const currentDirection = distribution.p_bullish > 0.5 ? "bullish" : distribution.p_bearish > 0.5 ? "bearish" : "neutral";
  let conflicts = 0;
  const recentConflicts: string[] = [];

  for (const j of history.slice(0, 5)) {
    if (j.direction !== currentDirection && j.direction !== "neutral" && currentDirection !== "neutral") {
      conflicts++;
      const age = Math.round((Date.now() - new Date(j.created_at).getTime()) / 86400000);
      recentConflicts.push(`${age}天前判断为${j.direction === "bullish" ? "看多" : "看空"}(置信度${j.confidence}%)`);
    }
  }

  return {
    consistent: conflicts === 0,
    previous_judgments: history.length,
    direction_conflicts: conflicts,
    explanation: conflicts > 0
      ? `与近期${conflicts}次判断方向冲突: ${recentConflicts.join("; ")}`
      : `与近期${Math.min(5, history.length)}次判断方向一致`,
  };
}

// ── 生成行动计划 ─────────────────────────────────────────
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
      reason: "无法获取当前价格",
      contingency: "",
    };
  }

  // ── 时间框架不匹配：生成分层持仓建议 ───────────────────
  if (conflict.conflict_type === "timeframe_mismatch" && conflict.timeframe_analysis) {
    const layered = conflict.timeframe_analysis.layered_recommendations;
    const totalPosition = layered.reduce((sum, l) => sum + l.position_pct, 0);

    // 综合方向：短线主导
    const shortTerm = layered.find(l => l.timeframe.includes("1d") || l.timeframe.includes("1w"));
    const mediumTerm = layered.find(l => l.timeframe.includes("1m"));
    const longTerm = layered.find(l => l.timeframe.includes("3m"));

    let reason = "时间框架分层: ";
    if (shortTerm) reason += `短线${shortTerm.direction === "bullish" ? "看多" : "看空"} `;
    if (mediumTerm) reason += `中线${mediumTerm.direction === "bullish" ? "看多" : "看空"} `;
    if (longTerm) reason += `长线${longTerm.direction === "bullish" ? "看多" : "看空"}`;

    return {
      action: totalPosition > 5 ? "buy" : totalPosition > 0 ? "hold" : "watch",
      position_pct: Math.min(totalPosition, 15), // 上限15%
      entry_price: currentPrice,
      target_price: Math.round(currentPrice * (1 + 0.1) * 100) / 100,
      stop_loss: Math.round(currentPrice * (1 - 0.05) * 100) / 100,
      reason,
      contingency: "短线仓位需更严格止损，中长线可适当放宽",
      layered_positions: layered,
    };
  }

  const isBullish = distribution.p_bullish > 0.5;
  const confidence = Math.max(distribution.p_bullish, distribution.p_bearish);
  const conflictPenalty = conflict.has_conflict ? 0.5 : 1.0;

  // 如果有根本性冲突，使用条件化结论
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
      reason: `条件化结论: ${primaryConclusion.condition}`,
      contingency: `如果${conditionalConclusions[1]?.condition || "相反条件发生"}，立即调整仓位`,
    };
  }

  // 常规情况
  if (isBullish) {
    return {
      action: "buy",
      position_pct: Math.round(confidence * 15 * conflictPenalty),
      entry_price: currentPrice,
      target_price: Math.round(currentPrice * (1 + confidence * 0.15) * 100) / 100,
      stop_loss: Math.round(currentPrice * (1 - 0.05) * 100) / 100,
      reason: `看多概率${(distribution.p_bullish * 100).toFixed(0)}%，预期收益${(distribution.expected_return! * 100).toFixed(1)}%`,
      contingency: conflict.has_conflict ? "存在分歧，仓位控制在8%以内" : "",
    };
  } else if (distribution.p_bearish > 0.5) {
    return {
      action: "sell",
      position_pct: 0,
      entry_price: currentPrice,
      target_price: Math.round(currentPrice * (1 - confidence * 0.15) * 100) / 100,
      stop_loss: Math.round(currentPrice * (1 + 0.05) * 100) / 100,
      reason: `看空概率${(distribution.p_bearish * 100).toFixed(0)}%，建议观望或做空`,
      contingency: "",
    };
  } else {
    return {
      action: "hold",
      position_pct: 0,
      entry_price: currentPrice,
      target_price: currentPrice,
      stop_loss: 0,
      reason: "方向不明确，建议观望",
      contingency: "",
    };
  }
}
