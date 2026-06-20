import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// 统一数据库路径 (与 lib/dataHub.ts 一致)
const DB_DIR = path.resolve(__dirname, "..", "..", "..", "..", "..", "data");
const DB_PATH = path.join(DB_DIR, "fin-agent.db");
let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initTables(db);
  }
  return db;
}

function initTables(database: Database.Database) {
  database.exec(`
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

    CREATE TABLE IF NOT EXISTS signal_weights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_name TEXT NOT NULL UNIQUE,
      base_weight REAL NOT NULL,
      accuracy_7d REAL DEFAULT 0,
      accuracy_30d REAL DEFAULT 0,
      sample_count INTEGER DEFAULT 0,
      last_updated TEXT DEFAULT (datetime('now'))
    );

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
  `);

  database.exec(`INSERT OR IGNORE INTO signal_weights (signal_name, base_weight) VALUES
    ('technical', 0.40),
    ('fundamental', 0.35),
    ('sentiment', 0.10),
    ('macro', 0.10),
    ('options', 0.03),
    ('insider', 0.02)`);
}

export function autoLogAnalysis(result: {
  symbol: string;
  direction: string;
  confidence: number;
  key_prices?: any;
  reasons?: string;
  source_signals?: any;
}) {
  const d = getDb();
  d.prepare(`
    INSERT INTO analysis_log (symbol, direction, confidence, key_prices, reasons, source_signals)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    result.symbol,
    result.direction,
    result.confidence,
    JSON.stringify(result.key_prices || {}),
    result.reasons || "",
    JSON.stringify(result.source_signals || {})
  );
  console.error(`[memory] auto-logged analysis for ${result.symbol}`);
}

export function recallMemory(symbol: string, limit = 5): any[] {
  const d = getDb();
  return d.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM market_outcomes m WHERE m.analysis_id = a.id AND m.was_correct = 1) as correct_count,
      (SELECT COUNT(*) FROM market_outcomes m WHERE m.analysis_id = a.id AND m.was_correct IS NOT NULL) as total_verified
    FROM analysis_log a
    WHERE a.symbol = ?
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(symbol, limit) as any[];
}

export function verifyOutcome(analysisId: number, actualPrice: number) {
  const d = getDb();
  const analysis = d.prepare("SELECT * FROM analysis_log WHERE id = ?").get(analysisId) as any;
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

  d.prepare(`
    INSERT INTO market_outcomes (analysis_id, actual_price, actual_direction, was_correct, price_deviation_pct)
    VALUES (?, ?, ?, ?, ?)
  `).run(analysisId, actualPrice, analysis.direction, wasCorrect, deviation);

  return { analysis_id: analysisId, was_correct: !!wasCorrect, deviation_pct: deviation };
}

export function getExperienceSummary(days = 7): string {
  const d = getDb();

  const signalStats = d.prepare(`
    SELECT
      json_extract(a.source_signals, '$.technical') as tech,
      a.direction,
      m.was_correct
    FROM analysis_log a
    LEFT JOIN market_outcomes m ON m.analysis_id = a.id
    WHERE a.created_at >= datetime('now', '-' || ? || ' days')
      AND m.was_correct IS NOT NULL
  `).all(days) as any[];

  const totalStats = d.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN m.was_correct = 1 THEN 1 ELSE 0 END) as correct
    FROM analysis_log a
    JOIN market_outcomes m ON m.analysis_id = a.id
    WHERE a.created_at >= datetime('now', '-' || ? || ' days')
  `).get(days) as any;

  const hitRate = totalStats.total > 0
    ? Math.round((totalStats.correct / totalStats.total) * 100)
    : null;

  const rules = d.prepare(
    "SELECT rule, confidence, hit_count, miss_count FROM learned_rules WHERE active = 1 ORDER BY confidence DESC"
  ).all() as any[];

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
      parts.push(` · ${r.rule} (置信度${(r.confidence*100).toFixed(0)}%, 验证${rate}%)`);
    }
  }

  if (signalStats.length > 0) {
    parts.push("- 建议: 每次分析时优先考虑已验证的经验规则，避免重复已知错误");
  }

  return parts.join("\n");
}

export function addRule(rule: string, confidence: number, source = "auto") {
  getDb().prepare(
    "INSERT INTO learned_rules (rule, confidence, source) VALUES (?, ?, ?)"
  ).run(rule, confidence, source);
}

export function updateRuleAccuracy(ruleId: number, wasCorrect: boolean) {
  if (wasCorrect) {
    getDb().prepare("UPDATE learned_rules SET hit_count = hit_count + 1, confidence = MIN(1.0, confidence + 0.05) WHERE id = ?").run(ruleId);
  } else {
    const rule = getDb().prepare("SELECT * FROM learned_rules WHERE id = ?").get(ruleId) as any;
    if (rule && rule.miss_count + 1 >= 3 && rule.confidence < 0.3) {
      getDb().prepare("UPDATE learned_rules SET active = 0 WHERE id = ?").run(ruleId);
    } else {
      getDb().prepare("UPDATE learned_rules SET miss_count = miss_count + 1, confidence = MAX(0.1, confidence - 0.1) WHERE id = ?").run(ruleId);
    }
  }
}

export function listRules(activeOnly = true): any[] {
  const clause = activeOnly ? "WHERE active = 1" : "";
  return getDb().prepare(`SELECT * FROM learned_rules ${clause} ORDER BY confidence DESC`).all() as any[];
}

export function getSignalWeights(): any[] {
  return getDb().prepare("SELECT signal_name, base_weight, accuracy_30d FROM signal_weights").all() as any[];
}

export function getJudgments(symbol: string, limit = 10): any[] {
  return getDb().prepare("SELECT * FROM analysis_log WHERE symbol = ? ORDER BY created_at DESC LIMIT ?").all(symbol, limit) as any[];
}

export function getAllExperience(minConfidence = 0): any[] {
  return getDb().prepare("SELECT * FROM learned_rules WHERE active = 1 AND confidence >= ? ORDER BY confidence DESC").all(minConfidence) as any[];
}
