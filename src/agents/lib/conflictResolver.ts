import { ToolRegistration } from "./types.js";

// ── 类型定义 ─────────────────────────────────────────────
interface AgentSignal {
  timeframe?: string;
  distribution: { p_bullish: number; p_bearish: number; p_neutral: number };
  assumptions?: string[];
  key_drivers?: Array<{ factor: string; weight: number; direction: string }>;
  data_quality?: number;
}

interface TimeframeGroup {
  timeframe: string;
  agents: string[];
  avg_p_bullish: number;
  avg_p_bearish: number;
  consensus: "bullish" | "bearish" | "neutral" | "mixed";
}

interface ConflictAnalysis {
  has_conflict: boolean;
  conflict_type: "none" | "timeframe_mismatch" | "surface_divergence" | "fundamental";
  root_cause: string;
  conflicting_agents: Array<{ agent_a: string; agent_b: string; reason: string }>;
  debate_triggered: boolean;
}

interface LayeredRecommendation {
  timeframe: string;
  direction: "bullish" | "bearish" | "neutral";
  agents: string[];
  position_pct: number;
  reason: string;
}

interface ConditionalConclusion {
  condition: string;
  dominant_view: string;
  conclusion: string;
  position_pct: number;
}

interface ConflictResolverResult {
  engine: string;
  symbol: string;
  timestamp: string;
  conflict_analysis: ConflictAnalysis;
  timeframe_analysis: {
    has_mismatch: boolean;
    grouped_by_timeframe: Record<string, TimeframeGroup>;
    layered_recommendations: LayeredRecommendation[];
  };
  conditional_conclusions: ConditionalConclusion[];
  action_plan: {
    action: "buy" | "sell" | "hold" | "watch";
    position_pct: number;
    reason: string;
    contingency: string;
    layered_positions?: LayeredRecommendation[];
  };
}

// ── 时间框架优先级 ────────────────────────────────────────
const TIMEFRAME_ORDER = ["1d-3d", "1d-5d", "1w-1m", "1m-3m", "3m-12m"];

function getTimeframeIndex(tf: string): number {
  const idx = TIMEFRAME_ORDER.indexOf(tf);
  return idx >= 0 ? idx : 2; // 默认中短线
}

export function registerConflictResolver(): ToolRegistration {
  return {
    name: "conflict_resolver",
    description: "冲突检测 + 辩论触发 + 条件化结论。分析多个agent的信号，识别冲突类型，输出分层建议",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "股票代码" },
        signals: {
          type: "object",
          description: "7个agent的信号",
          additionalProperties: {
            type: "object",
            properties: {
              timeframe: { type: "string", description: "时间框架: 1d-3d/1d-5d/1w-1m/1m-3m/3m-12m" },
              distribution: {
                type: "object",
                properties: {
                  p_bullish: { type: "number" },
                  p_bearish: { type: "number" },
                  p_neutral: { type: "number" },
                },
              },
              assumptions: { type: "array", items: { type: "string" } },
              key_drivers: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    factor: { type: "string" },
                    weight: { type: "number" },
                    direction: { type: "string" },
                  },
                },
              },
              data_quality: { type: "number" },
            },
          },
        },
      },
      required: ["symbol", "signals"],
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const { symbol, signals } = args;

      try {
        // 1. 按时间框架分组
        const timeframeGroups = groupByTimeframe(signals);

        // 2. 检测冲突
        const conflictAnalysis = detectConflict(signals, timeframeGroups);

        // 3. 生成分层建议
        const layeredRecommendations = generateLayeredRecommendations(timeframeGroups);

        // 4. 生成条件化结论
        const conditionalConclusions = generateConditionalConclusions(signals, conflictAnalysis);

        // 5. 生成行动计划
        const actionPlan = generateActionPlan(layeredRecommendations, conflictAnalysis);

        const result: ConflictResolverResult = {
          engine: "conflict-resolver",
          symbol,
          timestamp: new Date().toISOString(),
          conflict_analysis: conflictAnalysis,
          timeframe_analysis: {
            has_mismatch: Object.keys(timeframeGroups).length > 1,
            grouped_by_timeframe: timeframeGroups,
            layered_recommendations: layeredRecommendations,
          },
          conditional_conclusions: conditionalConclusions,
          action_plan: actionPlan,
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

// ── 按时间框架分组 ────────────────────────────────────────
function groupByTimeframe(signals: Record<string, AgentSignal>): Record<string, TimeframeGroup> {
  const groups: Record<string, TimeframeGroup> = {};

  for (const [agent, signal] of Object.entries(signals)) {
    const tf = signal.timeframe || "1w-1m"; // 默认中短线

    if (!groups[tf]) {
      groups[tf] = {
        timeframe: tf,
        agents: [],
        avg_p_bullish: 0,
        avg_p_bearish: 0,
        consensus: "neutral",
      };
    }

    groups[tf].agents.push(agent);
    groups[tf].avg_p_bullish += signal.distribution?.p_bullish ?? 0;
    groups[tf].avg_p_bearish += signal.distribution?.p_bearish ?? 0;
  }

  // 计算平均值和共识
  for (const group of Object.values(groups)) {
    const count = group.agents.length;
    group.avg_p_bullish /= count;
    group.avg_p_bearish /= count;

    if (group.avg_p_bullish > 0.6) group.consensus = "bullish";
    else if (group.avg_p_bearish > 0.6) group.consensus = "bearish";
    else if (Math.abs(group.avg_p_bullish - group.avg_p_bearish) < 0.15) group.consensus = "neutral";
    else group.consensus = "mixed";
  }

  return groups;
}

// ── 检测冲突 ──────────────────────────────────────────────
function detectConflict(
  signals: Record<string, AgentSignal>,
  timeframeGroups: Record<string, TimeframeGroup>
): ConflictAnalysis {
  const conflictingAgents: Array<{ agent_a: string; agent_b: string; reason: string }> = [];

  // 检查同时间框架内的方向冲突
  for (const [tf, group] of Object.entries(timeframeGroups)) {
    const bullishAgents = group.agents.filter(a => (signals[a].distribution?.p_bullish ?? 0) > 0.5);
    const bearishAgents = group.agents.filter(a => (signals[a].distribution?.p_bearish ?? 0) > 0.5);

    if (bullishAgents.length > 0 && bearishAgents.length > 0) {
      // 同时间框架内有方向冲突
      for (const ba of bullishAgents) {
        for (const bea of bearishAgents) {
          conflictingAgents.push({
            agent_a: ba,
            agent_b: bea,
            reason: `在${tf}时间框架内方向相反`,
          });
        }
      }
    }
  }

  // 检查跨时间框架的根本性冲突
  const timeframes = Object.keys(timeframeGroups).sort((a, b) => getTimeframeIndex(a) - getTimeframeIndex(b));
  if (timeframes.length >= 2) {
    const shortTf = timeframes[0];
    const longTf = timeframes[timeframes.length - 1];
    const shortGroup = timeframeGroups[shortTf];
    const longGroup = timeframeGroups[longTf];

    // 短期看多+长期看空 或 短期看空+长期看多 = 根本性冲突
    if (
      (shortGroup.consensus === "bullish" && longGroup.consensus === "bearish") ||
      (shortGroup.consensus === "bearish" && longGroup.consensus === "bullish")
    ) {
      return {
        has_conflict: true,
        conflict_type: "fundamental",
        root_cause: `短期(${shortTf})和长期(${longTf})判断相反，可能存在根本性分歧`,
        conflicting_agents: conflictingAgents,
        debate_triggered: true,
      };
    }
  }

  if (conflictingAgents.length > 0) {
    return {
      has_conflict: true,
      conflict_type: "surface_divergence",
      root_cause: "同时间框架内方向分歧",
      conflicting_agents: conflictingAgents,
      debate_triggered: false,
    };
  }

  return {
    has_conflict: false,
    conflict_type: "none",
    root_cause: "",
    conflicting_agents: [],
    debate_triggered: false,
  };
}

// ── 生成分层建议 ──────────────────────────────────────────
function generateLayeredRecommendations(timeframeGroups: Record<string, TimeframeGroup>): LayeredRecommendation[] {
  const recommendations: LayeredRecommendation[] = [];

  const sortedTimeframes = Object.keys(timeframeGroups).sort(
    (a, b) => getTimeframeIndex(a) - getTimeframeIndex(b)
  );

  for (const tf of sortedTimeframes) {
    const group = timeframeGroups[tf];
    let direction: "bullish" | "bearish" | "neutral" = "neutral";
    let positionPct = 0;
    let reason = "";

    if (group.consensus === "bullish") {
      direction = "bullish";
      positionPct = Math.round(group.avg_p_bullish * 15);
      reason = `${group.agents.join(",")}在${tf}维度看多`;
    } else if (group.consensus === "bearish") {
      direction = "bearish";
      positionPct = 0;
      reason = `${group.agents.join(",")}在${tf}维度看空`;
    } else {
      direction = "neutral";
      positionPct = 3;
      reason = `${group.agents.join(",")}在${tf}维度观点分散`;
    }

    recommendations.push({
      timeframe: tf,
      direction,
      agents: group.agents,
      position_pct: positionPct,
      reason,
    });
  }

  return recommendations;
}

// ── 判断信号方向 ──────────────────────────────────────────
function getSignalDirection(signal: AgentSignal): "看多" | "看空" | "中性" {
  const { p_bullish, p_bearish } = signal.distribution;
  if (p_bullish > p_bearish) return "看多";
  if (p_bearish > p_bullish) return "看空";
  return "中性";
}

// ── 生成条件化结论 ────────────────────────────────────────
function generateConditionalConclusions(
  signals: Record<string, AgentSignal>,
  conflictAnalysis: ConflictAnalysis
): ConditionalConclusion[] {
  if (!conflictAnalysis.has_conflict) {
    return [];
  }

  const conclusions: ConditionalConclusion[] = [];

  // 根据冲突双方生成条件化结论
  for (const conflict of conflictAnalysis.conflicting_agents) {
    const agentA = signals[conflict.agent_a];
    const agentB = signals[conflict.agent_b];
    if (!agentA || !agentB) continue;

    if (agentA.assumptions && agentA.assumptions.length > 0) {
      conclusions.push({
        condition: `如果${agentA.assumptions[0]}成立`,
        dominant_view: conflict.agent_a,
        conclusion: getSignalDirection(agentA),
        position_pct: 10,
      });
    }

    if (agentB.assumptions && agentB.assumptions.length > 0) {
      conclusions.push({
        condition: `如果${agentB.assumptions[0]}成立`,
        dominant_view: conflict.agent_b,
        conclusion: getSignalDirection(agentB),
        position_pct: 0,
      });
    }
  }

  return conclusions;
}

// ── 生成行动计划 ──────────────────────────────────────────
function generateActionPlan(
  layeredRecommendations: LayeredRecommendation[],
  conflictAnalysis: ConflictAnalysis
): ConflictResolverResult["action_plan"] {
  // 计算总仓位
  const totalPosition = layeredRecommendations.reduce((sum, r) => sum + r.position_pct, 0);
  const avgPosition = Math.round(totalPosition / Math.max(1, layeredRecommendations.length));

  // 确定方向
  const bullishCount = layeredRecommendations.filter(r => r.direction === "bullish").length;
  const bearishCount = layeredRecommendations.filter(r => r.direction === "bearish").length;

  let action: "buy" | "sell" | "hold" | "watch" = "hold";
  if (bullishCount > bearishCount && avgPosition > 5) action = "buy";
  else if (bearishCount > bullishCount) action = "watch";
  else if (avgPosition < 3) action = "watch";

  // 生成原因
  const reasons: string[] = [];
  if (conflictAnalysis.has_conflict) {
    reasons.push(`存在${conflictAnalysis.conflict_type}冲突`);
  }
  reasons.push(`分层建议: ${layeredRecommendations.map(r => `${r.timeframe}${r.direction}`).join(" ")}`);

  // 生成应急计划
  let contingency = "";
  if (conflictAnalysis.debate_triggered) {
    contingency = "已触发辩论协议，需关注条件化结论中的关键假设";
  }

  return {
    action,
    position_pct: avgPosition,
    reason: reasons.join("; "),
    contingency,
    layered_positions: layeredRecommendations,
  };
}
