import { ToolRegistration } from "../types.js";
import { MCPClientManager } from "../mcp/mcpClientManager.js";
import { getSignalWeights, autoLogAnalysis, getJudgments, getAllExperience } from "../memory/memoryStore.js";

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

const WEIGHTS = {
  technical: 0.35,
  fundamental: 0.30,
  sentiment: 0.10,
  macro: 0.10,
  options: 0.10,
  insider: 0.05,
};

interface SignalInput {
  source: string;
  score: number;
  confidence: number;
  details: string;
}

interface FusionResult {
  symbol: string;
  timestamp: string;
  signals: SignalInput[];
  weighted_score: number;
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;
  consistency_report: {
    consistent: boolean;
    previous_judgments: number;
    direction_conflicts: number;
    explanation: string;
  };
  experience_adjustment: {
    applied: boolean;
    rules_used: number;
    adjustment_pct: number;
    notes: string[];
  };
  action_plan: {
    entry_price: number;
    target_price: number;
    stop_loss: number;
    position_size_pct: number;
    timeframe: string;
    risk_reward_ratio: number;
  };
  key_factors: string[];
  warnings: string[];
}

export function registerSignalFusion(
  mcpManager: MCPClientManager
): ToolRegistration {
  return {
    name: "signal_fusion",
    description:
      "多信号融合引擎：从 TradingView 获取技术面/基本面信号，结合情绪和宏观数据，执行加权打分和逻辑一致性校验，输出操作计划。",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "股票代码或指数代码" },
        timeframe: { type: "string", description: "时间框架: 1d/1w/1m/3m，默认 1m", default: "1m" },
        custom_weights: {
          type: "object",
          description: "自定义权重（可选），覆盖默认权重",
          properties: {
            technical: { type: "number" },
            fundamental: { type: "number" },
            sentiment: { type: "number" },
            macro: { type: "number" },
          },
        },
      },
      required: ["symbol"],
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const symbol = args.symbol;
      const timeframe = args.timeframe || "1m";
      const customWeights = args.custom_weights || null;

      if (!symbol) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "缺少 symbol 参数" }) }],
          isError: true,
        };
      }

      try {
        const signals: SignalInput[] = [];

        // ── 并行获取各信号源数据 ──────────────────────────────
        const [techResult, fundResult, fgResult] = await Promise.allSettled([
          mcpManager.callTool("stock-scanner", "tradingview_technicals", { tickers: [symbol] }, 25000),
          mcpManager.callTool("stock-scanner", "tradingview_scan", {
            filters: [{ left: "name", operation: "equal", right: symbol.toUpperCase() }],
            columns: ["close", "price_earnings_ttm", "return_on_equity_fq", "total_revenue_fq", "net_income_fq", "total_debt_fq", "total_assets_fq"],
            limit: 1,
          }, 25000),
          mcpManager.callTool("stock-scanner", "sentiment_fear_greed", {}, 15000),
        ]);

        // ── 技术面信号 ─────────────────────────────────────────
        const rawTech = techResult.status === "fulfilled" ? techResult.value : null;
        const techItems = extractData(rawTech);
        const tech = techItems[0]?.data || techItems[0] || null;
        if (tech) {
          const rsi = tech.RSI ?? 50;
          const macd = (tech["MACD.macd"] ?? 0) - (tech["MACD.signal"] ?? 0);
          const recAll = tech["Recommend.All"] ?? 0;
          const price = tech.SMA20 || 0;

          let techScore = 0;
          const reasons: string[] = [];

          // RSI 信号
          if (rsi < 30) { techScore += 0.3; reasons.push(`RSI=${rsi.toFixed(0)}超卖`); }
          else if (rsi > 70) { techScore -= 0.3; reasons.push(`RSI=${rsi.toFixed(0)}超买`); }

          // MACD 信号
          if (macd > 0 && (tech["MACD.macd"] ?? 0) > (tech["MACD.signal"] ?? 0)) {
            techScore += 0.2; reasons.push("MACD金叉");
          } else if (macd < 0 && (tech["MACD.macd"] ?? 0) < (tech["MACD.signal"] ?? 0)) {
            techScore -= 0.2; reasons.push("MACD死叉");
          }

          // TradingView 综合推荐
          if (recAll > 0.3) { techScore += 0.2; reasons.push("TradingView看多"); }
          else if (recAll < -0.3) { techScore -= 0.2; reasons.push("TradingView看空"); }

          // 均线排列
          const sma20 = tech.SMA20, sma50 = tech.SMA50;
          if (sma20 && sma50 && sma20 > sma50) { techScore += 0.2; reasons.push("均线多头排列"); }
          else if (sma20 && sma50 && sma20 < sma50) { techScore -= 0.2; reasons.push("均线空头排列"); }

          signals.push({
            source: "technical",
            score: Math.max(-1, Math.min(1, techScore)),
            confidence: 0.75,
            details: reasons.join(", ") || "技术面中性",
          });
        }

        // ── 基本面信号 ─────────────────────────────────────────
        const rawFund = fundResult.status === "fulfilled" ? fundResult.value : null;
        const fundItems = extractData(rawFund);
        const fund = fundItems[0]?.data || fundItems[0] || null;
        if (fund) {
          let fundScore = 0;
          const reasons: string[] = [];
          const pe = fund.price_earnings_ttm;
          const roe = fund.return_on_equity_fq != null ? fund.return_on_equity_fq / 100 : null;
          const revenue = fund.total_revenue_fq;
          const netIncome = fund.net_income_fq;
          const totalDebt = fund.total_debt_fq;
          const totalAssets = fund.total_assets_fq;

          if (pe && pe < 15) { fundScore += 0.2; reasons.push(`PE=${pe.toFixed(1)}低估值`); }
          else if (pe && pe > 35) { fundScore -= 0.15; reasons.push(`PE=${pe.toFixed(1)}高估值`); }

          if (roe && roe > 0.15) { fundScore += 0.2; reasons.push(`ROE=${(roe * 100).toFixed(1)}%`); }
          if (roe && roe < 0) { fundScore -= 0.15; reasons.push("ROE为负"); }

          if (revenue && netIncome) {
            const margin = netIncome / revenue;
            if (margin > 0.2) { fundScore += 0.1; reasons.push(`净利率${(margin * 100).toFixed(1)}%`); }
          }

          if (totalDebt && totalAssets) {
            const dEq = totalDebt / (totalAssets - totalDebt);
            if (dEq < 0.5) { fundScore += 0.1; reasons.push("低杠杆"); }
            else if (dEq > 2) { fundScore -= 0.1; reasons.push("高杠杆"); }
          }

          signals.push({
            source: "fundamental",
            score: Math.max(-1, Math.min(1, fundScore)),
            confidence: 0.7,
            details: reasons.join(", ") || "基本面中性",
          });
        }

        // ── 宏观 / 情绪信号 ──────────────────────────────────
        const fg = fgResult.status === "fulfilled" ? fgResult.value : null;
        if (fg) {
          const fgScore = fg.score != null ? (fg.score - 50) / 50 : 0;
          const rating = fg.rating || "";
          signals.push({
            source: "macro",
            score: fgScore,
            confidence: 0.6,
            details: `恐惧贪婪指数: ${fg.score}/100 (${rating})`,
          });

          signals.push({
            source: "sentiment",
            score: fgScore * 0.5,
            confidence: 0.5,
            details: `市场情绪: ${rating}`,
          });
        }

        // ── 权重计算 ─────────────────────────────────────────
        const weights = { ...WEIGHTS };
        try {
          const dbWeights = getSignalWeights();
          if (dbWeights && dbWeights.length > 0) {
            for (const w of dbWeights) {
              if (w.signal_name in weights && w.accuracy_30d > 0) {
                weights[w.signal_name as keyof typeof weights] = w.base_weight;
              }
            }
          }
        } catch {}
        if (customWeights) {
          if (customWeights.technical !== undefined) weights.technical = customWeights.technical;
          if (customWeights.fundamental !== undefined) weights.fundamental = customWeights.fundamental;
          if (customWeights.sentiment !== undefined) weights.sentiment = Math.min(customWeights.sentiment, 0.15);
          if (customWeights.macro !== undefined) weights.macro = customWeights.macro;
        }

        const availableSources = signals.map((s) => s.source);
        let totalWeight = 0;
        for (const src of availableSources) {
          totalWeight += (weights as any)[src] || 0;
        }

        let weightedScore = 0;
        for (const sig of signals) {
          const w = ((weights as any)[sig.source] || 0) / (totalWeight || 1);
          weightedScore += sig.score * w * sig.confidence;
        }
        weightedScore = Math.max(-1, Math.min(1, weightedScore));

        // ── 一致性校验 ───────────────────────────────────────
        const history = getJudgments(symbol, 10);
        const consistencyReport = checkConsistency(history, weightedScore);
        const experienceAdj = await applyExperienceRules(symbol, weightedScore);

        // ── 获取当前价格 ──────────────────────────────────────
        let currentPrice = 0;
        if (tech?.SMA20) currentPrice = tech.SMA20;
        else if (fund?.close) currentPrice = fund.close;
        else {
          try {
            const rawQuote = await mcpManager.callTool("stock-scanner", "tradingview_quote", { tickers: [symbol] }, 15000);
            const quoteItems = extractData(rawQuote);
            currentPrice = quoteItems[0]?.data?.close ?? quoteItems[0]?.close ?? 0;
          } catch {}
        }

        const actionPlan = generateActionPlan(weightedScore, currentPrice, timeframe, consistencyReport);

        const keyFactors = signals.map((s) => `[${s.source}] ${s.details}`);
        const warnings: string[] = [];
        if (consistencyReport.direction_conflicts > 0) {
          warnings.push(`与历史${consistencyReport.direction_conflicts}次判断方向冲突`);
        }

        const direction = weightedScore > 0.15 ? "bullish" : weightedScore < -0.15 ? "bearish" : "neutral";
        const confidence = Math.round(Math.abs(weightedScore) * 100);

        // ── 记录本次判断 ─────────────────────────────────────
        try {
          autoLogAnalysis({
            symbol,
            direction,
            confidence,
            key_prices: { support: [actionPlan.stop_loss], resistance: [actionPlan.target_price] },
            reasons: keyFactors.join("; "),
            source_signals: Object.fromEntries(signals.map((s) => [s.source, { score: s.score, weight: (weights as any)[s.source] || 0 }])),
          });
        } catch {}

        const result: FusionResult = {
          symbol,
          timestamp: new Date().toISOString(),
          signals,
          weighted_score: Math.round(weightedScore * 1000) / 1000,
          direction,
          confidence,
          consistency_report: consistencyReport,
          experience_adjustment: experienceAdj,
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

function checkConsistency(
  history: any[],
  currentScore: number
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

  const currentDirection = currentScore > 0.15 ? "bullish" : currentScore < -0.15 ? "bearish" : "neutral";
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

async function applyExperienceRules(
  symbol: string,
  currentScore: number
): Promise<{
  applied: boolean;
  rules_used: number;
  adjustment_pct: number;
  notes: string[];
}> {
  const rules = getAllExperience(30);
  const notes: string[] = [];
  let adjustment = 0;

  for (const rule of rules) {
    if (rule.rule_text.includes(symbol) || rule.category === "general") {
      const ruleWeight = (rule.confidence / 100) * (rule.hit_count / (rule.hit_count + rule.miss_count + 1));
      if (rule.rule_text.includes("看多") && currentScore < 0) {
        adjustment -= ruleWeight * 5;
        notes.push(`经验规则(置信度${rule.confidence}%): ${rule.rule_text}`);
      } else if (rule.rule_text.includes("看空") && currentScore > 0) {
        adjustment -= ruleWeight * 5;
        notes.push(`经验规则(置信度${rule.confidence}%): ${rule.rule_text}`);
      }
    }
  }

  return {
    applied: rules.length > 0,
    rules_used: notes.length,
    adjustment_pct: Math.round(adjustment * 100) / 100,
    notes,
  };
}

function generateActionPlan(
  score: number,
  currentPrice: number,
  timeframe: string,
  consistency: { consistent: boolean; direction_conflicts: number }
): FusionResult["action_plan"] {
  if (!currentPrice) {
    return {
      entry_price: 0, target_price: 0, stop_loss: 0,
      position_size_pct: 0, timeframe, risk_reward_ratio: 0,
    };
  }

  const isBullish = score > 0.15;
  const confidenceFactor = Math.abs(score);
  const conflictPenalty = consistency.direction_conflicts > 0 ? 0.5 : 1.0;

  if (isBullish) {
    const entry = currentPrice;
    const target = Math.round(currentPrice * (1 + 0.05 + confidenceFactor * 0.1) * 100) / 100;
    const stop = Math.round(currentPrice * (1 - 0.03 - (1 - confidenceFactor) * 0.02) * 100) / 100;
    const rr = (target - entry) / (entry - stop);

    return {
      entry_price: entry,
      target_price: target,
      stop_loss: stop,
      position_size_pct: Math.round(confidenceFactor * 30 * conflictPenalty),
      timeframe,
      risk_reward_ratio: Math.round(rr * 100) / 100,
    };
  } else {
    return {
      entry_price: currentPrice,
      target_price: Math.round(currentPrice * (1 - 0.05 - confidenceFactor * 0.1) * 100) / 100,
      stop_loss: Math.round(currentPrice * (1 + 0.03) * 100) / 100,
      position_size_pct: 0,
      timeframe,
      risk_reward_ratio: 0,
    };
  }
}
