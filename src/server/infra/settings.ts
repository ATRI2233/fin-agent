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
  DB_BUSY_TIMEOUT_MS: z.coerce.number().int().default(30000),
  DB_JOURNAL_MODE: z.enum(["WAL", "DELETE"]).default("WAL"),

  // OpenClaw
  OPENCLAW_GATEWAY_HOST: z.string().default("127.0.0.1"),
  OPENCLAW_GATEWAY_PORT: z.coerce.number().int().default(18789),
  OPENCLAW_API_BASE: z.string().default("https://opencode.ai/zen/go/v1"),
  OPENCLAW_API_KEY: z.string().default(""),
  OPENCLAW_AUTH_TOKEN: z.string().default(""),
  MCP_CONFIG_PATH: z.string().default(".opencode/opencode.json"),

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

  // CORS — comma-separated allow-list of origins permitted to send credentialed
  // requests. The wildcard "*" is intentionally NOT used: per the CORS spec,
  // `Access-Control-Allow-Origin: *` is forbidden together with
  // `Access-Control-Allow-Credentials: true`. The default covers the Vite dev
  // server and the production origin behind which the webui is served.
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://127.0.0.1:5173"),

  // Logging
  LOG_LEVEL: z.enum(["DEBUG", "INFO", "WARNING", "ERROR"]).default("INFO"),
});

// ── 解析 ──

const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => k.startsWith("FIN_AGENT_"))
);

// 手动处理 boolean 字段，避免 z.coerce.boolean 的 bug
const envWithBooleans = {
  ...rawEnv,
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
  if (s.OPENCLAW_GATEWAY_PORT === s.API_PORT) {
    throw new ConfigError("OPENCLAW_GATEWAY_PORT must differ from API_PORT", {
      OPENCLAW_GATEWAY_PORT: s.OPENCLAW_GATEWAY_PORT,
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

export function getOpenclawGatewayUrl(s: Settings): string {
  return `http://${s.OPENCLAW_GATEWAY_HOST}:${s.OPENCLAW_GATEWAY_PORT}`;
}