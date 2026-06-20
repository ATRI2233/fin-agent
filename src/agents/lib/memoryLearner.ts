import { ToolRegistration } from "./types.js";
import { query, queryOne, execute, getSignalWeights } from "./dataHub.js";

// ── 类型定义 ─────────────────────────────────────────────
interface AccuracyStats {
  total: number;
  correct: number;
  hit_rate: number;
}

interface AgentAccuracy {
  hit_rate: number;
  sample_count: number;
}

interface WeightUpdate {
  old: number;
  new: number;
  reason: string;
}

interface PatternAlert {
  pattern: string;
  condition: string;
  signal: string;
  action: string;
}

interface RetiredRule {
  rule_id: number;
  rule: string;
  reason: string;
  retired_at: string;
}

interface MemoryLearnerResult {
  agent: string;
  timestamp: string;
  action: string;
  accuracy_report: {
    overall_hit_rate: number;
    total_predictions: number;
    correct_predictions: number;
    by_agent: Record<string, AgentAccuracy>;
  };
  weight_updates: Record<string, WeightUpdate>;
  pattern_alerts: PatternAlert[];
  retired_rules: RetiredRule[];
  next_review: string;
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

export function registerMemoryLearner(): ToolRegistration {
  return {
    name: "memory_learner",
    description: "经验学习者：追踪准确率、进化权重、提取模式、淘汰失效规则",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["full_review", "update_weights", "extract_patterns", "retire_rules"],
          description: "操作类型",
        },
        lookback_days: {
          type: "number",
          description: "回溯天数，默认30",
          default: 30,
        },
        symbol: {
          type: "string",
          description: "指定标的（可选）",
        },
      },
      required: ["action"],
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const action = args.action || "full_review";
      const lookbackDays = args.lookback_days || 30;
      const symbol = args.symbol;

      try {
        const result: MemoryLearnerResult = {
          agent: "memory-learner",
          timestamp: new Date().toISOString(),
          action,
          accuracy_report: {
            overall_hit_rate: 0,
            total_predictions: 0,
            correct_predictions: 0,
            by_agent: {},
          },
          weight_updates: {},
          pattern_alerts: [],
          retired_rules: [],
          next_review: getNextReviewDate(),
        };

        // 执行准确率统计
        if (action === "full_review" || action === "update_weights") {
          const accuracy = computeAccuracy(lookbackDays, symbol);
          result.accuracy_report = accuracy;
          result.weight_updates = computeWeightUpdates(accuracy);
        }

        // 提取模式
        if (action === "full_review" || action === "extract_patterns") {
          result.pattern_alerts = extractPatterns(lookbackDays);
        }

        // 淘汰规则
        if (action === "full_review" || action === "retire_rules") {
          result.retired_rules = retireRules();
        }

        // 持久化权重更新
        if (action === "full_review" || action === "update_weights") {
          saveWeightUpdates(result.weight_updates);
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

// ── 辅助函数 ──────────────────────────────────────────────

function getNextReviewDate(): string {
  const next = new Date();
  next.setDate(next.getDate() + 7);
  return next.toISOString().split("T")[0];
}

function computeAccuracy(lookbackDays: number, symbol?: string): MemoryLearnerResult["accuracy_report"] {
  let whereClause = `WHERE a.created_at >= datetime('now', '-' || ? || ' days') AND m.was_correct IS NOT NULL`;
  const params: any[] = [lookbackDays];

  if (symbol) {
    whereClause += ` AND a.symbol = ?`;
    params.push(symbol);
  }

  // 总体准确率
  const totalStats = queryOne(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN m.was_correct = 1 THEN 1 ELSE 0 END) as correct
    FROM analysis_log a
    JOIN market_outcomes m ON m.analysis_id = a.id
    ${whereClause}
  `, ...params);

  const total = totalStats?.total || 0;
  const correct = totalStats?.correct || 0;
  const hitRate = total > 0 ? correct / total : 0;

  // 按 agent 统计
  const byAgent: Record<string, AgentAccuracy> = {};
  const agentStats = query(`
    SELECT
      a.source_signals,
      m.was_correct
    FROM analysis_log a
    JOIN market_outcomes m ON m.analysis_id = a.id
    ${whereClause}
  `, ...params);

  const agentCounts: Record<string, { hits: number; total: number }> = {};
  for (const row of agentStats) {
    try {
      const signals = JSON.parse(row.source_signals || "{}");
      for (const agent of Object.keys(signals)) {
        if (!agentCounts[agent]) agentCounts[agent] = { hits: 0, total: 0 };
        agentCounts[agent].total++;
        if (row.was_correct === 1) agentCounts[agent].hits++;
      }
    } catch (e) { console.error("[memoryLearner] parse source_signals failed:", e); }
  }

  for (const [agent, stats] of Object.entries(agentCounts)) {
    byAgent[agent] = {
      hit_rate: stats.total > 0 ? Math.round((stats.hits / stats.total) * 100) / 100 : 0,
      sample_count: stats.total,
    };
  }

  return {
    overall_hit_rate: Math.round(hitRate * 100) / 100,
    total_predictions: total,
    correct_predictions: correct,
    by_agent: byAgent,
  };
}

function computeWeightUpdates(accuracy: MemoryLearnerResult["accuracy_report"]): Record<string, WeightUpdate> {
  const updates: Record<string, WeightUpdate> = {};
  const avgHitRate = accuracy.overall_hit_rate;

  // 获取当前权重
  let currentWeights: Record<string, number> = { ...DEFAULT_WEIGHTS };
  try {
    const dbWeights = getSignalWeights();
    if (dbWeights && dbWeights.length > 0) {
      for (const w of dbWeights) {
        currentWeights[w.signal_name] = w.base_weight;
      }
    }
  } catch (e) { console.error("[memoryLearner] getSignalWeights failed:", e); }

  // 贝叶斯更新
  for (const [agent, stats] of Object.entries(accuracy.by_agent)) {
    if (stats.sample_count < 5) {
      updates[agent] = {
        old: currentWeights[agent] || 0,
        new: currentWeights[agent] || 0,
        reason: `样本不足(${stats.sample_count}个)，维持`,
      };
      continue;
    }

    const oldWeight = currentWeights[agent] || 0;
    const hitRate = stats.hit_rate;

    // 新权重 = 旧权重 × (准确率 / 平均准确率)
    let newWeight = avgHitRate > 0 ? oldWeight * (hitRate / avgHitRate) : oldWeight;

    // 限制调整幅度（单次最多调整30%）
    const maxAdjustment = 0.3;
    const adjustment = oldWeight === 0 ? 0 : (newWeight - oldWeight) / oldWeight;
    if (Math.abs(adjustment) > maxAdjustment) {
      newWeight = oldWeight * (1 + Math.sign(adjustment) * maxAdjustment);
    }

    updates[agent] = {
      old: Math.round(oldWeight * 1000) / 1000,
      new: Math.round(newWeight * 1000) / 1000,
      reason: hitRate > avgHitRate
        ? `准确率${(hitRate * 100).toFixed(0)}%→略升`
        : hitRate < avgHitRate
        ? `准确率${(hitRate * 100).toFixed(0)}%→略降`
        : `准确率${(hitRate * 100).toFixed(0)}%，维持`,
    };
  }

  // 归一化
  const totalNew = Object.values(updates).reduce((sum, u) => sum + u.new, 0);
  if (totalNew > 0) {
    for (const agent of Object.keys(updates)) {
      updates[agent].new = Math.round((updates[agent].new / totalNew) * 1000) / 1000;
    }
  }

  return updates;
}

function extractPatterns(lookbackDays: number): PatternAlert[] {
  const patterns: PatternAlert[] = [];

  // 查询所有有验证结果的分布
  const rows = query(`
    SELECT
      a.direction,
      a.source_signals,
      m.was_correct
    FROM analysis_log a
    JOIN market_outcomes m ON m.analysis_id = a.id
    WHERE a.created_at >= datetime('now', '-' || ? || ' days')
      AND m.was_correct IS NOT NULL
  `, lookbackDays);

  // 模式1: 技术面在熊市的失败率
  const bearishTechRows = rows.filter(r => {
    try {
      const signals = JSON.parse(r.source_signals || "{}");
      return r.direction === "bearish" && "technical" in signals;
    } catch { return false; }
  });
  if (bearishTechRows.length >= 5) {
    const failures = bearishTechRows.filter(r => r.was_correct === 0).length;
    const failureRate = failures / bearishTechRows.length;
    if (failureRate > 0.5) {
      patterns.push({
        pattern: `技术面在熊市判断失败率${(failureRate * 100).toFixed(0)}%`,
        condition: "bear_market",
        signal: "technical",
        action: "降低熊市中技术面权重",
      });
    }
  }

  // 模式2: 高估值股票的回调率
  const highValuationRows = rows.filter(r => {
    try {
      const signals = JSON.parse(r.source_signals || "{}");
      return signals.fundamental?.score > 0.5 && r.direction === "bullish";
    } catch { return false; }
  });
  if (highValuationRows.length >= 5) {
    const failures = highValuationRows.filter(r => r.was_correct === 0).length;
    const failureRate = failures / highValuationRows.length;
    if (failureRate > 0.6) {
      patterns.push({
        pattern: `高估值股票看多失败率${(failureRate * 100).toFixed(0)}%`,
        condition: "high_valuation",
        signal: "fundamental",
        action: "对高估值股票更谨慎",
      });
    }
  }

  return patterns;
}

function retireRules(): RetiredRule[] {
  const retired: RetiredRule[] = [];
  const today = new Date().toISOString().split("T")[0];

  // 查询需要淘汰的规则
  const rules = query(`
    SELECT id, rule, confidence, hit_count, miss_count
    FROM learned_rules
    WHERE active = 1
      AND (miss_count >= 3 OR (hit_count + miss_count >= 5 AND hit_count / (hit_count + miss_count) < 0.4))
  `);

  for (const rule of rules) {
    // 标记为淘汰
    execute("UPDATE learned_rules SET active = 0 WHERE id = ?", rule.id);

    retired.push({
      rule_id: rule.id,
      rule: rule.rule,
      reason: rule.miss_count >= 3 ? `连续失误${rule.miss_count}次` : `命中率过低`,
      retired_at: today,
    });
  }

  return retired;
}

function saveWeightUpdates(updates: Record<string, WeightUpdate>) {
  for (const [agent, update] of Object.entries(updates)) {
    execute(`
      INSERT INTO signal_weights (signal_name, base_weight, last_updated)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(signal_name) DO UPDATE SET
        base_weight = excluded.base_weight,
        last_updated = excluded.last_updated
    `, agent, update.new);
  }
}
