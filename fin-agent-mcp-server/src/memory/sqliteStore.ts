/**
 * MemoryStore — 基于 SQLite 的持久化记忆层
 *
 * 三张核心表：
 *   1. judgments   — 历史判断记录（看多/看空/中性 + 理由 + 时间戳）
 *   2. validations — 判断验证记录（实际走势 vs 预测，命中/偏离）
 *   3. experience  — 提炼出的经验规则（从验证中学习）
 *
 * 设计要点：
 *   - 每次判断必须记录，不可遗漏
 *   - 验证时自动计算命中率、偏差度
 *   - 经验规则有置信度，随验证次数动态调整
 *   - 支持"遗忘曲线"：过旧的判断权重自动衰减
 */

import sqlite3 from "sqlite3";

interface Judgment {
  id?: number;
  timestamp: string;       // ISO 8601
  symbol: string;          // 标的代码
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;      // 0-100
  reasoning: string;       // 判断理由
  key_factors: string;     // JSON: 关键因素列表
  target_price?: number;   // 目标价
  stop_price?: number;     // 止损价
  timeframe: string;       // 时间框架 (1d/1w/1m/3m)
  signal_sources: string;  // JSON: 信号来源权重 {technical:0.4, fundamental:0.35, sentiment:0.15, macro:0.1}
}

interface Validation {
  id?: number;
  judgment_id: number;
  timestamp: string;
  actual_direction: "bullish" | "bearish" | "neutral";
  actual_change_pct: number;  // 实际涨跌幅
  predicted_change_pct?: number;
  hit: boolean;               // 方向是否命中
  deviation: number;          // 偏差度
  notes: string;
}

interface ExperienceRule {
  id?: number;
  created_at: string;
  updated_at: string;
  rule_text: string;          // 规则描述
  category: string;           // technical / fundamental / sentiment / macro / options / insider
  confidence: number;         // 0-100
  hit_count: number;          // 验证命中次数
  miss_count: number;         // 验证未命中次数
  last_validated: string;
  source_judgment_ids: string; // JSON: 来源判断ID列表
}

interface InsiderTrade {
  id?: number;
  timestamp: string;
  symbol: string;
  insider_name: string;
  title?: string;
  transaction_type: "buy" | "sell" | "exercise" | "award" | "forfeit";
  shares: number;
  price: number;
  total_value: number;
  filing_date: string;
}

interface OptionsSignal {
  id?: number;
  timestamp: string;
  symbol: string;
  iv_percentile?: number;
  put_call_ratio?: number;
  max_pain?: number;
  near_term_iv?: number;
  volume_anomaly?: number;
  signal_type?: string;
  details?: string;
}

export class MemoryStore {
  private db: sqlite3.Database;

  constructor(dbPath: string) {
    this.db = new sqlite3.Database(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.serialize(() => {
      // 判断记录表
      this.db.run(`
        CREATE TABLE IF NOT EXISTS judgments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          symbol TEXT NOT NULL,
          direction TEXT NOT NULL CHECK(direction IN ('bullish','bearish','neutral')),
          confidence INTEGER NOT NULL CHECK(confidence BETWEEN 0 AND 100),
          reasoning TEXT NOT NULL,
          key_factors TEXT NOT NULL DEFAULT '[]',
          target_price REAL,
          stop_price REAL,
          timeframe TEXT NOT NULL DEFAULT '1m',
          signal_sources TEXT NOT NULL DEFAULT '{}'
        )
      `);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_judgments_symbol ON judgments(symbol)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_judgments_timestamp ON judgments(timestamp)`);

      // 验证记录表
      this.db.run(`
        CREATE TABLE IF NOT EXISTS validations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          judgment_id INTEGER NOT NULL,
          timestamp TEXT NOT NULL,
          actual_direction TEXT NOT NULL,
          actual_change_pct REAL NOT NULL,
          predicted_change_pct REAL,
          hit INTEGER NOT NULL DEFAULT 0,
          deviation REAL NOT NULL DEFAULT 0,
          notes TEXT DEFAULT '',
          FOREIGN KEY (judgment_id) REFERENCES judgments(id)
        )
      `);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_validations_judgment ON validations(judgment_id)`);

      // 经验规则表
      this.db.run(`
        CREATE TABLE IF NOT EXISTS experience (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          rule_text TEXT NOT NULL UNIQUE,
          category TEXT NOT NULL,
          confidence INTEGER NOT NULL DEFAULT 50,
          hit_count INTEGER NOT NULL DEFAULT 0,
          miss_count INTEGER NOT NULL DEFAULT 0,
          last_validated TEXT,
          source_judgment_ids TEXT DEFAULT '[]'
        )
      `);

      // 内部交易记录表
      this.db.run(`
        CREATE TABLE IF NOT EXISTS insider_trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          symbol TEXT NOT NULL,
          insider_name TEXT NOT NULL,
          title TEXT,
          transaction_type TEXT NOT NULL,
          shares INTEGER NOT NULL,
          price REAL NOT NULL,
          total_value REAL NOT NULL,
          filing_date TEXT NOT NULL
        )
      `);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_insider_symbol ON insider_trades(symbol)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_insider_date ON insider_trades(filing_date)`);

      // 期权信号记录表
      this.db.run(`
        CREATE TABLE IF NOT EXISTS options_signals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          symbol TEXT NOT NULL,
          iv_percentile REAL,
          put_call_ratio REAL,
          max_pain REAL,
          near_term_iv REAL,
          volume_anomaly INTEGER DEFAULT 0,
          signal_type TEXT,
          details TEXT
        )
      `);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_options_symbol ON options_signals(symbol)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_options_date ON options_signals(timestamp)`);
    });
  }

  // ── 判断 CRUD ──────────────────────────────────────────

  async recordJudgment(j: Omit<Judgment, "id">): Promise<number> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO judgments (timestamp, symbol, direction, confidence, reasoning, key_factors, target_price, stop_price, timeframe, signal_sources)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [j.timestamp, j.symbol, j.direction, j.confidence, j.reasoning, j.key_factors, j.target_price, j.stop_price, j.timeframe, j.signal_sources],
        function (err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async getJudgments(symbol: string, limit = 20): Promise<Judgment[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM judgments WHERE symbol = ? ORDER BY timestamp DESC LIMIT ?`,
        [symbol, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows as Judgment[]);
        }
      );
    });
  }

  async getRecentJudgments(days = 30, limit = 50): Promise<Judgment[]> {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM judgments WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?`,
        [cutoff, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows as Judgment[]);
        }
      );
    });
  }

  // ── 验证 CRUD ──────────────────────────────────────────

  async recordValidation(v: Omit<Validation, "id">): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO validations (judgment_id, timestamp, actual_direction, actual_change_pct, predicted_change_pct, hit, deviation, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.judgment_id, v.timestamp, v.actual_direction, v.actual_change_pct, v.predicted_change_pct, v.hit ? 1 : 0, v.deviation, v.notes],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async getValidationsForJudgment(judgmentId: number): Promise<Validation[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM validations WHERE judgment_id = ?`,
        [judgmentId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows as Validation[]);
        }
      );
    });
  }

  // ── 经验规则 CRUD ──────────────────────────────────────

  async upsertExperience(rule: Omit<ExperienceRule, "id">): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO experience (created_at, updated_at, rule_text, category, confidence, hit_count, miss_count, last_validated, source_judgment_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(rule_text) DO UPDATE SET
           updated_at = excluded.updated_at,
           confidence = excluded.confidence,
           hit_count = excluded.hit_count,
           miss_count = excluded.miss_count,
           last_validated = excluded.last_validated,
           source_judgment_ids = excluded.source_judgment_ids`,
        [rule.created_at, rule.updated_at, rule.rule_text, rule.category, rule.confidence, rule.hit_count, rule.miss_count, rule.last_validated, rule.source_judgment_ids],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async getExperienceByCategory(category: string): Promise<ExperienceRule[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM experience WHERE category = ? ORDER BY confidence DESC`,
        [category],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows as ExperienceRule[]);
        }
      );
    });
  }

  async getAllExperience(minConfidence = 30): Promise<ExperienceRule[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM experience WHERE confidence >= ? ORDER BY confidence DESC`,
        [minConfidence],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows as ExperienceRule[]);
        }
      );
    });
  }

  // ── 统计 ───────────────────────────────────────────────

  async getHitRate(symbol?: string, days = 90): Promise<{
    total: number;
    hits: number;
    hitRate: number;
    avgDeviation: number;
  }> {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    let query = `
      SELECT COUNT(*) as total,
             SUM(v.hit) as hits,
             AVG(v.deviation) as avg_deviation
      FROM validations v
      JOIN judgments j ON v.judgment_id = j.id
      WHERE v.timestamp >= ?
    `;
    const params: (string | number)[] = [cutoff];
    if (symbol) {
      query += ` AND j.symbol = ?`;
      params.push(symbol);
    }
    return new Promise((resolve, reject) => {
      this.db.get(query, params, (err, row: any) => {
        if (err) reject(err);
        else resolve({
          total: row?.total ?? 0,
          hits: row?.hits ?? 0,
          hitRate: row?.total ? (row.hits / row.total) * 100 : 0,
          avgDeviation: row?.avg_deviation ?? 0,
        });
      });
    });
  }

  // ── 内部交易记录 CRUD ──────────────────────────────────

  async recordInsiderTrade(t: Omit<InsiderTrade, "id">): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO insider_trades (timestamp, symbol, insider_name, title, transaction_type, shares, price, total_value, filing_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.timestamp, t.symbol, t.insider_name, t.title, t.transaction_type, t.shares, t.price, t.total_value, t.filing_date],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async getInsiderTrades(symbol: string, days = 90, limit = 50): Promise<InsiderTrade[]> {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM insider_trades WHERE symbol = ? AND filing_date >= ? ORDER BY filing_date DESC LIMIT ?`,
        [symbol, cutoff, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows as InsiderTrade[]);
        }
      );
    });
  }

  // ── 期权信号记录 CRUD ──────────────────────────────────

  async recordOptionsSignal(s: Omit<OptionsSignal, "id">): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO options_signals (timestamp, symbol, iv_percentile, put_call_ratio, max_pain, near_term_iv, volume_anomaly, signal_type, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.timestamp, s.symbol, s.iv_percentile, s.put_call_ratio, s.max_pain, s.near_term_iv, s.volume_anomaly, s.signal_type, s.details],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async getOptionsSignals(symbol: string, days = 30, limit = 20): Promise<OptionsSignal[]> {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM options_signals WHERE symbol = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT ?`,
        [symbol, cutoff, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows as OptionsSignal[]);
        }
      );
    });
  }

  // ── 遗忘曲线衰减 ──────────────────────────────────────
  // 越旧的判断权重越低，半衰期 30 天

  getDecayWeight(timestamp: string): number {
    const age = (Date.now() - new Date(timestamp).getTime()) / 86400000; // 天
    return Math.exp(-0.693 * age / 30); // 半衰期30天
  }
}
