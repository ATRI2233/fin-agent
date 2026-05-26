/**
 * ConsistencyEngine — 逻辑一致性引擎
 *
 * 核心设计：
 *   1. 每次新判断必须经过一致性校验才能输出
 *   2. 方向翻转需要"翻转理由"，否则降低置信度
 *   3. 短期反复翻转触发"震荡模式"，自动暂停判断
 *   4. 一致性评分影响最终置信度
 *
 * 使用方式：
 *   const engine = new ConsistencyEngine(memoryStore);
 *   const result = await engine.validate(symbol, newDirection, newConfidence, reasoning);
 *   // result.approved / result.adjusted_confidence / result.warnings
 */

export class ConsistencyEngine {
  private memoryRef: any; // MemoryStore 引用

  // 震荡检测阈值
  private readonly FLIP_THRESHOLD = 3;      // 30天内3次翻转 → 震荡
  private readonly COOLDOWN_DAYS = 3;       // 震荡后冷却期
  private readonly MIN_CONFIDENCE_DELTA = 15; // 置信度波动超过15%需要解释

  constructor(memory: any) {
    this.memoryRef = memory;
  }

  /**
   * 校验新判断的一致性
   * @returns 校验结果：是否批准、调整后置信度、警告列表
   */
  async validate(
    symbol: string,
    direction: "bullish" | "bearish" | "neutral",
    confidence: number,
    reasoning: string
  ): Promise<{
    approved: boolean;
    adjusted_confidence: number;
    consistency_score: number;
    warnings: string[];
    required_explanations: string[];
  }> {
    const warnings: string[] = [];
    const requiredExplanations: string[] = [];
    let adjustedConfidence = confidence;
    let consistencyScore = 100;

    // 获取历史判断
    const history = await this.memoryRef.getJudgments(symbol, 10);
    if (history.length === 0) {
      return {
        approved: true,
        adjusted_confidence: confidence,
        consistency_score: 100,
        warnings: ["首次分析该标的，无历史对比"],
        required_explanations: [],
      };
    }

    const latest = history[0];
    const latestAge = (Date.now() - new Date(latest.timestamp).getTime()) / 86400000;

    // ── 1. 方向翻转检测 ──────────────────────────────────
    if (
      direction !== "neutral" &&
      latest.direction !== "neutral" &&
      direction !== latest.direction
    ) {
      consistencyScore -= 25;
      warnings.push(`方向翻转：${latestAge.toFixed(0)}天前判断为${latest.direction}，现为${direction}`);

      // 检查是否有翻转理由
      const flipKeywords = ["财报", "突破", "破位", "政策", "利率", "事件", "earnings", "breakout", "breakdown", "policy", "rate"];
      const hasReason = flipKeywords.some((kw) => reasoning.toLowerCase().includes(kw));

      if (!hasReason) {
        requiredExplanations.push(
          `方向从${latest.direction}翻转为${direction}，但未提供翻转理由。请在判断中包含具体原因（如：新财报数据/技术面破位/宏观政策变化）`
        );
        adjustedConfidence = Math.max(10, adjustedConfidence - 20);
      }
    }

    // ── 2. 震荡模式检测 ──────────────────────────────────
    const thirtyDaysAgo = Date.now() - 30 * 86400000;
    const recentHistory = history.filter((j: any) => new Date(j.timestamp).getTime() > thirtyDaysAgo);
    let flipCount = 0;
    for (let i = 1; i < recentHistory.length; i++) {
      if (
        recentHistory[i].direction !== "neutral" &&
        recentHistory[i - 1].direction !== "neutral" &&
        recentHistory[i].direction !== recentHistory[i - 1].direction
      ) {
        flipCount++;
      }
    }

    if (flipCount >= this.FLIP_THRESHOLD) {
      consistencyScore -= 30;
      warnings.push(`⚠️ 震荡模式：30天内翻转${flipCount}次`);

      // 检查是否在冷却期内
      if (latestAge < this.COOLDOWN_DAYS) {
        return {
          approved: false,
          adjusted_confidence: 0,
          consistency_score: consistencyScore,
          warnings: [...warnings, `冷却期内（距上次判断仅${latestAge.toFixed(1)}天），判断被暂停`],
          required_explanations: requiredExplanations,
        };
      }

      adjustedConfidence = Math.max(10, adjustedConfidence * 0.5);
    }

    // ── 3. 置信度波动检测 ────────────────────────────────
    if (latest.confidence && Math.abs(confidence - latest.confidence) > this.MIN_CONFIDENCE_DELTA) {
      consistencyScore -= 10;
      warnings.push(
        `置信度大幅波动：${latest.confidence}% → ${confidence}%（变化${Math.abs(confidence - latest.confidence)}%）`
      );
      requiredExplanations.push("请解释置信度大幅变化的原因");
    }

    // ── 4. 同向过度自信检测 ──────────────────────────────
    const sameDirectionCount = recentHistory.filter((j: any) => j.direction === direction).length;
    if (sameDirectionCount >= 5 && confidence > 80) {
      consistencyScore -= 10;
      warnings.push(`连续${sameDirectionCount}次${direction}判断，可能存在确认偏见`);
    }

    consistencyScore = Math.max(0, consistencyScore);

    return {
      approved: true,
      adjusted_confidence: Math.round(adjustedConfidence),
      consistency_score: consistencyScore,
      warnings,
      required_explanations: requiredExplanations,
    };
  }
}
