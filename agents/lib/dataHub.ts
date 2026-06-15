/**
 * dataHub.ts — 统一数据访问层
 *
 * 所有 lib 工具的数据库操作都通过此模块。
 * 提供：连接管理、事务、Schema 迁移、通用查询接口。
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// ── 数据库路径 ────────────────────────────────────────────
const DB_DIR = path.resolve(__dirname, "..", "..", "..", "data");
const DB_PATH = path.join(DB_DIR, "fin-agent.db");

// ── 单例连接 ──────────────────────────────────────────────
let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

// ── Schema 初始化 ─────────────────────────────────────────
function initSchema(database: Database.Database) {
  database.exec(`
    -- 分析记录
    CREATE TABLE IF NOT EXISTS analysis_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      confidence INTEGER NOT NULL,
      key_prices TEXT,
      reasons TEXT,
      source_signals TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 验证结果
    CREATE TABLE IF NOT EXISTS market_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER NOT NULL,
      check_date TEXT DEFAULT (datetime('now')),
      actual_price REAL,
      actual_direction TEXT,
      was_correct INTEGER,
      price_deviation_pct REAL,
      FOREIGN KEY (analysis_id) REFERENCES analysis_log(id)
    );

    -- 信号权重
    CREATE TABLE IF NOT EXISTS signal_weights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_name TEXT NOT NULL UNIQUE,
      base_weight REAL NOT NULL,
      accuracy_7d REAL DEFAULT 0,
      accuracy_30d REAL DEFAULT 0,
      sample_count INTEGER DEFAULT 0,
      last_updated TEXT DEFAULT (datetime('now'))
    );

    -- 经验规则
    CREATE TABLE IF NOT EXISTS learned_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      source TEXT DEFAULT 'auto',
      hit_count INTEGER DEFAULT 0,
      miss_count INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 索引
    CREATE INDEX IF NOT EXISTS idx_analysis_symbol ON analysis_log(symbol);
    CREATE INDEX IF NOT EXISTS idx_analysis_created ON analysis_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_outcomes_analysis ON market_outcomes(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_rules_active ON learned_rules(active);
  `);

  // 默认信号权重
  database.exec(`INSERT OR IGNORE INTO signal_weights (signal_name, base_weight) VALUES
    ('technical', 0.40),
    ('fundamental', 0.35),
    ('sentiment', 0.10),
    ('macro', 0.10),
    ('options', 0.03),
    ('insider', 0.02)`);
}

// ── 通用查询接口 ──────────────────────────────────────────

/** 查询多行 */
export function query<T = any>(sql: string, ...params: any[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

/** 查询单行 */
export function queryOne<T = any>(sql: string, ...params: any[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

/** 执行写操作 (INSERT/UPDATE/DELETE) */
export function execute(sql: string, ...params: any[]): Database.RunResult {
  return getDb().prepare(sql).run(...params);
}

/** 事务执行 */
export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}

// ── 业务查询 (复用通用接口) ────────────────────────────────

/** 记录分析 */
export function logAnalysis(result: {
  symbol: string;
  direction: string;
  confidence: number;
  key_prices?: any;
  reasons?: string;
  source_signals?: any;
}) {
  execute(
    `INSERT INTO analysis_log (symbol, direction, confidence, key_prices, reasons, source_signals)
     VALUES (?, ?, ?, ?, ?, ?)`,
    result.symbol,
    result.direction,
    result.confidence,
    JSON.stringify(result.key_prices || {}),
    result.reasons || "",
    JSON.stringify(result.source_signals || {})
  );
}

/** 查询历史记录 */
export function getHistory(symbol: string, limit = 5): any[] {
  return query(
    `SELECT a.*,
       (SELECT COUNT(*) FROM market_outcomes m WHERE m.analysis_id = a.id AND m.was_correct = 1) as correct_count,
       (SELECT COUNT(*) FROM market_outcomes m WHERE m.analysis_id = a.id AND m.was_correct IS NOT NULL) as total_verified
     FROM analysis_log a
     WHERE a.symbol = ?
     ORDER BY a.created_at DESC
     LIMIT ?`,
    symbol, limit
  );
}

/** 验证结果 */
export function verifyOutcome(analysisId: number, actualPrice: number) {
  const analysis = queryOne("SELECT * FROM analysis_log WHERE id = ?", analysisId);
  if (!analysis) throw new Error(`analysis ${analysisId} not found`);

  const keyPrices = JSON.parse(analysis.key_prices || "{}");
  const support = keyPrices.support?.[0] || 0;
  const resistance = keyPrices.resistance?.[0] || 0;

  let wasCorrect: number;
  if (analysis.direction === "bullish" && actualPrice > support) wasCorrect = 1;
  else if (analysis.direction === "bearish" && actualPrice < resistance) wasCorrect = 1;
  else if (analysis.direction === "neutral") wasCorrect = 1;
  else wasCorrect = 0;

  const entryPrice = (support + resistance) / 2 || actualPrice;
  const deviation = ((actualPrice - entryPrice) / entryPrice) * 100;

  execute(
    `INSERT INTO market_outcomes (analysis_id, actual_price, actual_direction, was_correct, price_deviation_pct)
     VALUES (?, ?, ?, ?, ?)`,
    analysisId, actualPrice, analysis.direction, wasCorrect, deviation
  );

  return { analysis_id: analysisId, was_correct: !!wasCorrect, deviation_pct: deviation };
}

/** 获取经验总结 */
export function getExperienceSummary(days = 7): string {
  const totalStats = queryOne(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN m.was_correct = 1 THEN 1 ELSE 0 END) as correct
    FROM analysis_log a
    JOIN market_outcomes m ON m.analysis_id = a.id
    WHERE a.created_at >= datetime('now', '-' || ? || ' days')
  `, days);

  const hitRate = totalStats && totalStats.total > 0
    ? Math.round((totalStats.correct / totalStats.total) * 100)
    : null;

  const rules = query(
    "SELECT rule, confidence, hit_count, miss_count FROM learned_rules WHERE active = 1 ORDER BY confidence DESC"
  );

  const parts: string[] = [];
  parts.push(`[记忆系统] 近${days}天经验回顾:`);

  if (hitRate !== null) {
    parts.push(`- 总命中率: ${hitRate}% (${totalStats.correct}/${totalStats.total})`);
  } else {
    parts.push("- 暂无验证数据，多跑几天才有统计");
  }

  if (rules.length > 0) {
    parts.push(`- 有效经验规则 (${rules.length}条):`);
    for (const r of rules) {
      const total = r.hit_count + r.miss_count;
      const rate = total > 0 ? Math.round((r.hit_count / total) * 100) : "?";
      parts.push(`  · ${r.rule} (置信度${(r.confidence * 100).toFixed(0)}%, 验证${rate}%)`);
    }
  }

  return parts.join("\n");
}

/** 添加规则 */
export function addRule(rule: string, confidence: number, source = "auto") {
  execute("INSERT INTO learned_rules (rule, confidence, source) VALUES (?, ?, ?)", rule, confidence, source);
}

/** 更新规则准确率 */
export function updateRuleAccuracy(ruleId: number, wasCorrect: boolean) {
  if (wasCorrect) {
    execute("UPDATE learned_rules SET hit_count = hit_count + 1, confidence = MIN(1.0, confidence + 0.05) WHERE id = ?", ruleId);
  } else {
    const rule = queryOne("SELECT * FROM learned_rules WHERE id = ?", ruleId);
    if (rule && rule.miss_count + 1 >= 3 && rule.confidence < 0.3) {
      execute("UPDATE learned_rules SET active = 0 WHERE id = ?", ruleId);
    } else {
      execute("UPDATE learned_rules SET miss_count = miss_count + 1, confidence = MAX(0.1, confidence - 0.1) WHERE id = ?", ruleId);
    }
  }
}

/** 列出规则 */
export function listRules(activeOnly = true): any[] {
  const clause = activeOnly ? "WHERE active = 1" : "";
  return query(`SELECT * FROM learned_rules ${clause} ORDER BY confidence DESC`);
}

/** 获取信号权重 */
export function getSignalWeights(): any[] {
  return query("SELECT signal_name, base_weight, accuracy_30d FROM signal_weights");
}

/** 获取历史判断 */
export function getJudgments(symbol: string, limit = 10): any[] {
  return query("SELECT * FROM analysis_log WHERE symbol = ? ORDER BY created_at DESC LIMIT ?", symbol, limit);
}

/** 获取所有经验 */
export function getAllExperience(minConfidence = 0): any[] {
  return query("SELECT * FROM learned_rules WHERE active = 1 AND confidence >= ? ORDER BY confidence DESC", minConfidence);
}

// ── 优雅关闭数据库连接 ─────────────────────────────────────
export function closeDb() {
  if (db) {
    try {
      db.close();
      db = null;
      console.error("[dataHub] 数据库连接已关闭");
    } catch (err) {
      console.error("[dataHub] 关闭数据库连接失败:", err);
    }
  }
}

process.on("SIGTERM", () => {
  closeDb();
  process.exit(0);
});

process.on("SIGINT", () => {
  closeDb();
  process.exit(0);
});

// ── 导出路径 (供调试) ─────────────────────────────────────
export const DB_INFO = { dir: DB_DIR, path: DB_PATH };
