import { z } from "zod";
import dotenv from "dotenv";
import { resolve } from "path";
import { ConfigError } from "./errors.js";

// ── .env 加载（绝对路径，M1 修复）──
const envPath = resolve(process.cwd(), "config", ".env");
dotenv.config({ path: envPath, override: false });

// ── 布尔值解析辅助函数 ──
// z.coerce.boolean 会把非空字符串（包括 "false"）转为 true
function parseBoolean(val: string | undefined, def: boolean): boolean {
  if (val == null) return def;
  const v = val.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  return def;
}

// ── zod Schema ──

const settingsSchema = z.object({
  // HTTP
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().default(8000),

  // Database
  DATABASE_URL: z.string().default("sqlite:///./data/finagent.db"),
  DB_POOL_SIZE: z.coerce.number().int().default(10),
  DB_POOL_MAX_OVERFLOW: z.coerce.number().int().default(10),
  DB_POOL_TIMEOUT: z.coerce.number().int().default(30),
  DB_POOL_PRE_PING: z.boolean().default(true),
  DB_BUSY_TIMEOUT_MS: z.coerce.number().int().default(30000),
  DB_JOURNAL_MODE: z.enum(["WAL", "DELETE"]).default("WAL"),

  // Opencode
  OPENCODE_BIN: z.string().default(""),
  OPENCODE_SERVE_HOST: z.string().default("127.0.0.1"),
  OPENCODE_SERVE_PORT: z.coerce.number().int().default(4096),
  OPENCODE_AGENTS_DIR: z.string().default(".opencode/agents"),
  OPENCODE_MCP_CONFIG: z.string().default(".opencode/opencode.json"),

  // Workflow
  NODE_TIMEOUT_SECONDS: z.coerce.number().default(600.0),
  MAX_PARALLEL_NODES: z.coerce.number().int().default(5),
  POLL_INTERVAL_SECONDS: z.coerce.number().default(0.5),
  PREDECESSOR_WAIT_TIMEOUT_SECONDS: z.coerce.number().default(600.0),

  // Retry
  MAX_AGENT_RETRIES: z.coerce.number().int().default(3),
  RETRY_BASE_DELAY_SECONDS: z.coerce.number().default(1.0),
  RETRY_BACKOFF_FACTOR: z.coerce.number().default(2.0),
  CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().default(5),

  // Tracing
  TRACE_ID_HEADER: z.string().default("X-Trace-Id"),
  TRACE_ID_ENV_VAR: z.string().default("FIN_AGENT_TRACE_ID"),

  // Auth
  API_KEY: z.string().default(""),
  AUTH_SKIP_LOCALHOST: z.boolean().default(false),

  // Logging
  LOG_LEVEL: z.enum(["DEBUG", "INFO", "WARNING", "ERROR"]).default("INFO"),
  LOG_FORMAT: z.enum(["json", "console"]).default("json"),
});

// ── 解析 ──

const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => k.startsWith("FIN_AGENT_"))
);

// 手动处理 boolean 字段，避免 z.coerce.boolean 的 bug
const envWithBooleans = {
  ...rawEnv,
  DB_POOL_PRE_PING: parseBoolean(rawEnv.FIN_AGENT_DB_POOL_PRE_PING, true),
  AUTH_SKIP_LOCALHOST: parseBoolean(rawEnv.FIN_AGENT_AUTH_SKIP_LOCALHOST, false),
};

const parsed = settingsSchema.safeParse(envWithBooleans);

if (!parsed.success) {
  throw new ConfigError("Invalid configuration", {
    errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  });
}

// ── 导出 Settings ──

export type Settings = z.infer<typeof settingsSchema>;

export const settings: Settings = parsed.data;

// ── 运行时校验（与 Python validate() 等效）──

export function validateSettings(s: Settings): void {
  if (s.OPENCODE_SERVE_PORT === s.API_PORT) {
    throw new ConfigError("OPENCODE_SERVE_PORT must differ from API_PORT", {
      OPENCODE_SERVE_PORT: s.OPENCODE_SERVE_PORT,
      API_PORT: s.API_PORT,
    });
  }

  if (s.API_KEY && s.API_KEY.length < 32) {
    throw new ConfigError("API_KEY must be at least 32 characters", {
      length: s.API_KEY.length,
    });
  }

  if (s.DB_POOL_SIZE < s.MAX_PARALLEL_NODES) {
    throw new ConfigError("DB_POOL_SIZE must be >= MAX_PARALLEL_NODES", {
      DB_POOL_SIZE: s.DB_POOL_SIZE,
      MAX_PARALLEL_NODES: s.MAX_PARALLEL_NODES,
    });
  }
}

export function getOpencodeServeUrl(s: Settings): string {
  return `http://${s.OPENCODE_SERVE_HOST}:${s.OPENCODE_SERVE_PORT}`;
}