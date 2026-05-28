/**
 * MCP Auto-Configuration Script
 *
 * Detects which MCP servers are available in the project,
 * generates the correct opencode.json mcp config entries,
 * and merges them into the existing config without overwriting.
 *
 * Usage:
 *   import { configureMcp } from "./configure-mcp.js";
 *   await configureMcp("/path/to/project");
 */

import { promises as fs } from "node:fs";
import path from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

interface McpServerMeta {
  /** Unique key in opencode.json mcp section */
  key: string;
  /** "stdio" | "sse" — transport type */
  type: string;
  /** Executable command */
  command: string;
  /** Arguments passed to the command (relative to projectDir) */
  args: string[];
  /** Human-readable description */
  description: string;
  /**
   * Relative path inside projectDir to check for existence.
   * If present, the server is considered available.
   */
  detectionPath: string;
  /** Required environment variable names — rendered as {env:VAR} */
  envVars?: string[];
  /** Whether this server is enabled by default */
  enabled?: boolean;
}

interface McpConfigEntry {
  type: string;
  command: string;
  args: string[];
  description: string;
  enabled: boolean;
  env?: Record<string, string>;
}

// ─── Server Registry ─────────────────────────────────────────────────────────

const MCP_SERVER_REGISTRY: McpServerMeta[] = [
  {
    key: "fin-agent-mcp-server",
    type: "stdio",
    command: "node",
    args: ["src/mcp-server/dist/index.js"],
    description:
      "核心金融分析 MCP — 聚合多源数据，提供技术分析、记忆层、逻辑一致性引擎",
    detectionPath: "src/mcp-server/dist/index.js",
    enabled: true,
  },
  {
    key: "fred-mcp-server",
    type: "stdio",
    command: "node",
    args: ["src/mcp-servers/fred/build/index.js"],
    description:
      "美联储经济数据 (FRED) — 800,000+ 经济时序数据，搜索/浏览/获取",
    detectionPath: "src/mcp-servers/fred/build/index.js",
    envVars: ["FRED_API_KEY"],
    enabled: true,
  },
  {
    key: "ashare-mcp-server",
    type: "stdio",
    command: "python",
    args: ["src/mcp-servers/ashare/ashare_mcp_server.py"],
    description:
      "A 股数据 — 使用 akshare 提供行情、技术面、基本面、新闻数据",
    detectionPath: "src/mcp-servers/ashare/ashare_mcp_server.py",
    enabled: true,
  },
  {
    key: "risk-mcp-server",
    type: "stdio",
    command: "python",
    args: ["src/mcp-servers/risk/risk_mcp_server.py"],
    description: "本地风控计算 — 仓位管理，机构持仓分析",
    detectionPath: "src/mcp-servers/risk/risk_mcp_server.py",
    enabled: true,
  },
  {
    key: "sec-edgar-mcp",
    type: "stdio",
    command: "python",
    args: ["src/mcp-servers/sec-edgar/sec_edgar_mcp_server.py"],
    description:
      "SEC EDGAR 财报查询 — 公司 Filing 和财务数据结构化获取",
    detectionPath: "src/mcp-servers/sec-edgar/sec_edgar_mcp_server.py",
    enabled: true,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check whether a file or directory exists.
 */
async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely read and parse a JSON file.
 * Returns null if the file doesn't exist or contains invalid JSON.
 */
async function readJsonSafe(
  filePath: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Type guard: value is a plain object (not array, not null).
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge `source` into `target` **without overwriting** existing keys.
 *
 * - If a key exists in `target` → keep the target value.
 * - If both sides are plain objects → recurse.
 * - Arrays and primitives in target are never replaced.
 */
function deepMergeNoOverwrite(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (!(key in result)) {
      result[key] = source[key];
    } else if (isPlainObject(result[key]) && isPlainObject(source[key])) {
      result[key] = deepMergeNoOverwrite(
        result[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    }
    // else: key exists in target — skip (no overwrite)
  }

  return result;
}

// ─── Core Logic ──────────────────────────────────────────────────────────────

/**
 * Detect which MCP servers are available in the project.
 *
 * For each server in the registry, checks whether its `detectionPath`
 * exists relative to `projectDir`.
 *
 * Returns only the subset that was found.
 */
async function detectAvailableServers(
  projectDir: string,
): Promise<McpServerMeta[]> {
  const available: McpServerMeta[] = [];

  for (const server of MCP_SERVER_REGISTRY) {
    const fullPath = path.join(projectDir, server.detectionPath);
    if (await exists(fullPath)) {
      available.push(server);
    }
  }

  return available;
}

/**
 * Build a single MCP config entry for opencode.json from server metadata.
 *
 * Environment variable placeholders use the `{env:VAR_NAME}` syntax
 * so that opencode resolves them at runtime.
 */
function buildConfigEntry(meta: McpServerMeta): McpConfigEntry {
  const entry: McpConfigEntry = {
    type: meta.type,
    command: meta.command,
    args: [...meta.args],
    description: meta.description,
    enabled: meta.enabled ?? true,
  };

  // Attach env vars as {env:VAR} placeholders
  if (meta.envVars && meta.envVars.length > 0) {
    entry.env = {};
    for (const varName of meta.envVars) {
      entry.env[varName] = `{env:${varName}}`;
    }
  }

  return entry;
}

/**
 * Build the full mcp config object from detected servers.
 * Keys are server names; values are McpConfigEntry objects.
 */
function buildMcpConfig(
  servers: McpServerMeta[],
): Record<string, McpConfigEntry> {
  const config: Record<string, McpConfigEntry> = {};
  for (const server of servers) {
    config[server.key] = buildConfigEntry(server);
  }
  return config;
}

/**
 * Merge new MCP config into the existing opencode.json structure.
 *
 * Only adds servers that don't already exist in `existing.mcp`.
 * Never overwrites user-modified server configs.
 */
function mergeMcpIntoConfig(
  existing: Record<string, unknown>,
  newMcp: Record<string, McpConfigEntry>,
): Record<string, unknown> {
  const existingMcp = isPlainObject(existing.mcp)
    ? (existing.mcp as Record<string, unknown>)
    : {};

  const mergedMcp = deepMergeNoOverwrite(existingMcp, newMcp);
  return { ...existing, mcp: mergedMcp };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Configure MCP servers in the project's `opencode.json`.
 *
 * 1. Scans `projectDir` for known MCP server entry points.
 * 2. Generates config entries with `{env:VAR}` placeholders.
 * 3. Reads existing `opencode.json` (if any).
 * 4. Merges MCP config — **never overwrites** existing entries.
 * 5. Writes the updated config back to disk.
 *
 * @param projectDir - Absolute path to the project root directory.
 */
export async function configureMcp(projectDir: string): Promise<void> {
  // 1. Detect available servers
  const available = await detectAvailableServers(projectDir);

  if (available.length === 0) {
    console.log("[configure-mcp] No MCP servers detected in project.");
    return;
  }

  console.log(
    `[configure-mcp] Detected ${available.length} MCP server(s): ${available.map((s) => s.key).join(", ")}`,
  );

  // 2. Build config entries
  const newMcp = buildMcpConfig(available);

  // 3. Read global opencode.json (where opencode actually reads config from)
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const globalConfigDir = path.join(homeDir, '.config', 'opencode');
  const configPath = path.join(globalConfigDir, "opencode.json");
  const existing = await readJsonSafe(configPath);

  if (existing) {
    console.log("[configure-mcp] Existing opencode.json found — merging (no overwrite).");
  } else {
    console.log("[configure-mcp] No opencode.json found — creating new one.");
  }

  // 4. Merge
  const base = existing ?? {};
  const updated = mergeMcpIntoConfig(base, newMcp);

  // 5. Write
  await fs.writeFile(configPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  console.log(`[configure-mcp] Wrote MCP config to ${configPath}`);
}

export default configureMcp;
