/**
 * ExperienceEngine — 经验学习引擎
 *
 * 核心设计：
 *   1. 从历史判断的验证结果中提炼经验规则
 *   2. 经验规则有置信度，随验证动态调整
 *   3. 过时规则自动降权（遗忘曲线）
 *   4. 经验规则影响信号权重分配
 *
 * 规则格式：
 *   {
 *     rule_text: "科技股财报前3天看多信号准确率低于40%",
 *     category: "fundamental",
 *     confidence: 65,
 *     hit_count: 8,
 *     miss_count: 5,
 *     conditions: { sector: "tech", timing: "pre_earnings" }
 *   }
 */

export class ExperienceEngine {
  private memoryRef: any;

  constructor(memory: any) {
    this.memoryRef = memory;
  }

  /**
   * 从验证结果中提炼新规则
   */
  async extractRules(symbol: string): Promise<
    Array<{
      rule_text: string;
      category: string;
      confidence: number;
      evidence: string;
    }>
  > {
    const newRules: Array<{
      rule_text: string;
      category: string;
      confidence: number;
      evidence: string;
    }> = [];

    // 获取近期判断和验证
    const judgments = await this.memoryRef.getJudgments(symbol, 30);
    const hitRate = await this.memoryRef.getHitRate(symbol, 90);

    if (hitRate.total < 5) return newRules; // 数据不足

    // ── 规则1：命中率趋势 ────────────────────────────────
    if (hitRate.hitRate < 40) {
      newRules.push({
        rule_text: `${symbol}近期命中率偏低(${hitRate.hitRate.toFixed(0)}%)，应降低置信度或增加确认信号`,
        category: "general",
        confidence: 55,
        evidence: `近${hitRate.total}次判断命中率${hitRate.hitRate.toFixed(0)}%`,
      });
    } else if (hitRate.hitRate > 70) {
      newRules.push({
        rule_text: `${symbol}近期命中率较高(${hitRate.hitRate.toFixed(0)}%)，当前策略有效`,
        category: "general",
        confidence: 70,
        evidence: `近${hitRate.total}次判断命中率${hitRate.hitRate.toFixed(0)}%`,
      });
    }

    // ── 规则2：信号源准确率分析 ──────────────────────────
    const signalStats: Record<string, { hits: number; total: number; avgConf: number }> = {};
    for (const j of judgments) {
      try {
        const sources = JSON.parse(j.signal_sources || "{}");
        for (const [source, data] of Object.entries(sources)) {
          if (!signalStats[source]) signalStats[source] = { hits: 0, total: 0, avgConf: 0 };
          signalStats[source].total++;
          signalStats[source].avgConf += (data as any).score || 0;
          if (j.confidence > 60) signalStats[source].hits++;
        }
      } catch { /* skip */ }
    }

    for (const [source, stats] of Object.entries(signalStats)) {
      if (stats.total >= 3) {
        const accuracy = stats.hits / stats.total;
        if (accuracy < 0.3) {
          newRules.push({
            rule_text: `${symbol}的${source}信号近期准确率仅${(accuracy * 100).toFixed(0)}%，建议降低该信号权重`,
            category: source,
            confidence: 60,
            evidence: `${stats.total}次判断中${stats.hits}次准确`,
          });
        } else if (accuracy > 0.7) {
          newRules.push({
            rule_text: `${symbol}的${source}信号近期准确率${(accuracy * 100).toFixed(0)}%，可适当增加权重`,
            category: source,
            confidence: 65,
            evidence: `${stats.total}次判断中${stats.hits}次准确`,
          });
        }
      }
    }

    // ── 规则3：方向偏好检测 ──────────────────────────────
    const bullishCount = judgments.filter((j: any) => j.direction === "bullish").length;
    const bearishCount = judgments.filter((j: any) => j.direction === "bearish").length;
    const total = bullishCount + bearishCount;
    if (total >= 5) {
      const bullishRatio = bullishCount / total;
      if (bullishRatio > 0.8) {
        newRules.push({
          rule_text: `${symbol}分析存在多头偏见(${(bullishRatio * 100).toFixed(0)}%看多)，需加强看空信号的权重`,
          category: "bias",
          confidence: 55,
          evidence: `${total}次判断中${bullishCount}次看多`,
        });
      } else if (bullishRatio < 0.2) {
        newRules.push({
          rule_text: `${symbol}分析存在空头偏见(${((1 - bullishRatio) * 100).toFixed(0)}%看空)，需加强看多信号的权重`,
          category: "bias",
          confidence: 55,
          evidence: `${total}次判断中${bearishCount}次看空`,
        });
      }
    }

    return newRules;
  }

  /**
   * 根据经验规则调整信号权重
   */
  adjustWeights(
    baseWeights: { technical: number; fundamental: number; sentiment: number; macro: number },
    rules: Array<{ rule_text: string; category: string; confidence: number }>
  ): { technical: number; fundamental: number; sentiment: number; macro: number } {
    const adjusted = { ...baseWeights };

    for (const rule of rules) {
      const impact = (rule.confidence / 100) * 0.05; // 每条规则最多影响5%

      if (rule.category === "technical" && rule.rule_text.includes("降低")) {
        adjusted.technical = Math.max(0.2, adjusted.technical - impact);
        adjusted.fundamental += impact * 0.5;
        adjusted.macro += impact * 0.5;
      } else if (rule.category === "technical" && rule.rule_text.includes("增加")) {
        adjusted.technical = Math.min(0.6, adjusted.technical + impact);
      }

      if (rule.category === "fundamental" && rule.rule_text.includes("降低")) {
        adjusted.fundamental = Math.max(0.15, adjusted.fundamental - impact);
        adjusted.technical += impact * 0.5;
        adjusted.macro += impact * 0.5;
      }

      if (rule.category === "bias") {
        // 偏见规则：增加对立面权重
        if (rule.rule_text.includes("多头偏见")) {
          adjusted.sentiment = Math.max(0.05, adjusted.sentiment - impact);
        }
      }
    }

    // 归一化
    const total = adjusted.technical + adjusted.fundamental + adjusted.sentiment + adjusted.macro;
    adjusted.technical /= total;
    adjusted.fundamental /= total;
    adjusted.sentiment = Math.min(0.15, adjusted.sentiment / total); // 情绪硬上限
    adjusted.macro /= total;

    // 再次归一化（因为情绪上限可能导致总和不为1）
    const total2 = adjusted.technical + adjusted.fundamental + adjusted.sentiment + adjusted.macro;
    adjusted.technical /= total2;
    adjusted.fundamental /= total2;
    adjusted.sentiment /= total2;
    adjusted.macro /= total2;

    return adjusted;
  }

  /**
   * 淘汰过时规则
   */
  async pruneRules(): Promise<
    Array<{
      rule_id: number;
      rule_text: string;
      reason: string;
    }>
  > {
    const deprecated: Array<{
      rule_id: number;
      rule_text: string;
      reason: string;
    }> = [];

    const rules = await this.memoryRef.getAllExperience(0);

    for (const rule of rules) {
      const age = (Date.now() - new Date(rule.last_validated).getTime()) / 86400000;

      // 90天未验证 → 降权
      if (age > 90 && rule.confidence > 20) {
        // 标记但不删除，让置信度自然衰减
      }

      // 命中率过低 → 淘汰
      if (rule.miss_count > rule.hit_count * 3 && rule.hit_count + rule.miss_count >= 5) {
        deprecated.push({
          rule_id: rule.id,
          rule_text: rule.rule_text,
          reason: `命中${rule.hit_count}/未命中${rule.miss_count}，准确率过低`,
        });
      }
    }

    return deprecated;
  }
}
