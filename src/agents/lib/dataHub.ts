/**
 * dataHub.ts — 统一数据访问层 (STUB VERSION)
 *
 * 所有 lib 工具的数据库操作都通过此模块。
 * 当前数据库已关闭，所有函数返回空/默认值。
 */

// ── 简单 LRU 缓存 (TTL + 最大容量) ─────────────────────────
interface LRUCacheEntry<V> {
  value: V;
  ts: number;
}

class LRUCache<K, V> {
  private map = new Map<K, LRUCacheEntry<V>>();

  constructor(
    private readonly maxSize: number,
    private readonly ttlMs: number
  ) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.map.size >= this.maxSize) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.set(key, { value, ts: Date.now() });
  }

  clear(): void {
    this.map.clear();
  }
}

// ── 导出路径 (供调试) ─────────────────────────────────────
export const DB_INFO = { dir: "（数据库已关闭）", path: "（数据库已关闭）" };

// ── 业务 Stub 函数 ─────────────────────────────────────────

/** 记录分析 */
export function logAnalysis(result: {
  symbol: string;
  direction: string;
  confidence: number;
  key_prices?: any;
  reasons?: string;
  source_signals?: any;
}) {
  // no-op
}

/** 查询历史记录 */
export function getHistory(symbol: string, limit = 5): any[] {
  return [];
}

/** 验证结果 */
export function verifyOutcome(analysisId: number, actualPrice: number) {
  return { analysis_id: analysisId, was_correct: null, deviation_pct: null, skipped: true };
}

/** 获取经验总结 */
export function getExperienceSummary(days = 7): string {
  return "[记忆系统已关闭]";
}

/** 添加规则 */
export function addRule(rule: string, confidence: number, source = "auto") {
  // no-op
}

/** 更新规则准确率 */
export function updateRuleAccuracy(ruleId: number, wasCorrect: boolean) {
  // no-op
}

/** 列出规则 */
export function listRules(activeOnly = true): any[] {
  return [];
}

/** 获取信号权重 */
export function getSignalWeights(): any[] {
  return [];
}

/** 获取历史判断 */
export function getJudgments(symbol: string, limit = 10): any[] {
  return [];
}

/**
 * Retention 清理:删除早于 retentionDays 的 analysis_log 行。
 * 返回实际删除的行数。调用方负责周期性触发(例如 cron / 启动时)。
 */
export function cleanupOldLogs(retentionDays = 90): number {
  return 0;
}

/** 获取所有经验 */
export function getAllExperience(minConfidence = 0): any[] {
  return [];
}
