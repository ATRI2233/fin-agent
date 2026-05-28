import type { Plugin } from "@opencode-ai/plugin";
import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import path from "node:path";

/**
 * Agent definitions — names of .md files bundled in this package.
 * Source lives at: <plugin-root>/.opencode/agents/<name>.md
 */
const AGENT_NAMES = [
  "fin-orchestrator",
  "macro-scout",
  "sector-rotator",
  "sentiment-decoder",
  "technical-chartist",
  "fundamental-auditor",
  "smart-money-hound",
  "risk-gatekeeper",
  "fusion-brain",
] as const;

/**
 * MCP server configuration blocks to merge into opencode.json.
 * Keys are server names; values are the config objects.
 */
const MCP_SERVERS: Record<string, Record<string, unknown>> = {
  "fin-agent-mcp-server": {
    type: "stdio",
    command: "node",
    args: ["src/mcp-server/dist/index.js"],
    description: "核心金融分析 MCP - 聚合多源数据，提供技术分析、记忆层、逻辑一致性引擎",
  },
  "fred-mcp-server": {
    type: "stdio",
    command: "node",
    args: ["src/mcp-servers/fred/build/index.js"],
    description: "美联储经济数据 (FRED) - 800,000+ 经济时序数据",
  },
  "ashare-mcp-server": {
    type: "stdio",
    command: "python",
    args: ["src/mcp-servers/ashare/ashare_mcp_server.py"],
    description: "A 股数据 - 使用 akshare 提供行情、技术面、基本面、新闻数据",
  },
  "risk-mcp-server": {
    type: "stdio",
    command: "python",
    args: ["src/mcp-servers/risk/risk_mcp_server.py"],
    description: "本地风控计算 - 仓位管理，机构持仓分析",
  },
    "sec-edgar-mcp": {
      type: "stdio",
      command: "python",
      args: ["-m", "sec_edgar_mcp.server"],
      description: "SEC EDGAR 财报查询 - 公司 Filing 和财务数据",
    },
};

/** Shape of an agent entry in opencode.json */
interface AgentConfig {
  description: string;
  mode: "primary" | "subagent";
  path: string;
  permission?: Record<string, unknown>;
}

/**
 * Build the agent configuration entries for opencode.json.
 * Each agent points to its .md file in the project's .opencode/agents/ directory.
 */
function buildAgentConfigs(): Record<string, AgentConfig> {
  const configs: Record<string, AgentConfig> = {};

  for (const name of AGENT_NAMES) {
    const isPrimary = name === "fin-orchestrator";
    configs[name] = {
      description: getAgentDescription(name),
      mode: isPrimary ? "primary" : "subagent",
      path: `.opencode/agents/${name}.md`,
      ...(isPrimary
        ? {
            permission: {
              task: {
                "macro-scout": "allow",
                "sector-rotator": "allow",
                "sentiment-decoder": "allow",
                "technical-chartist": "allow",
                "fundamental-auditor": "allow",
                "smart-money-hound": "allow",
                "risk-gatekeeper": "allow",
                "fusion-brain": "allow",
              },
            },
          }
        : {
            permission: {
              edit: "deny",
              bash: "deny",
              read: "allow",
            },
          }),
    };
  }

  return configs;
}

/** Human-readable descriptions for each agent */
function getAgentDescription(name: string): string {
  const descriptions: Record<string, string> = {
    "fin-orchestrator": "金融分析编排器 - 协调8个专业代理并行分析股票市场",
    "macro-scout": "宏观环境侦察 - 利率、通胀、就业、大宗商品、恐惧贪婪指数",
    "sector-rotator": "板块轮动雷达 - 轮动阶段、风格偏好、赛道推荐",
    "sentiment-decoder": "新闻情绪解码 - 情绪评分、热点事件、背离预警",
    "technical-chartist": "技术形态绘图师 - RSI/MACD/布林带/均线/支撑阻力",
    "fundamental-auditor": "基本面估值审计 - 盈利/成长/安全/效率/现金流雷达图",
    "smart-money-hound": "聪明钱追踪 - 资金流向、机构持仓、龙虎榜",
    "risk-gatekeeper": "风控仓位守门 - 风险等级、凯利仓位、止损对冲",
    "fusion-brain": "融合计算引擎 - 多信号加权融合、一致性校验、记忆存取",
  };
  return descriptions[name] ?? name;
}

/**
 * Resolve the root directory of the installed plugin package.
 * Walks up from the compiled JS file to find the package root.
 */
function resolvePluginRoot(): string {
  // import.meta.url gives us the URL of the current module
  // e.g., file:///D:/path/to/plugin/opencode-plugin/dist/index.js
  const currentFileUrl = import.meta.url;
  const currentFilePath = new URL(currentFileUrl).pathname;

  // On Windows, pathname starts with / like /D:/path, so strip leading /
  const normalizedPath =
    process.platform === "win32" && currentFilePath.startsWith("/")
      ? currentFilePath.slice(1)
      : currentFilePath;

  // dist/index.js -> go up to package root
  return path.resolve(path.dirname(normalizedPath), "..");
}

/**
 * Recursively copy a directory from src to dest.
 * Creates dest if it doesn't exist. Skips files that already exist at dest.
 */
async function copyDirIfMissing(
  src: string,
  dest: string,
): Promise<number> {
  let copied = 0;

  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copied += await copyDirIfMissing(srcPath, destPath);
    } else {
      // Skip if file already exists at destination
      try {
        await fs.access(destPath);
        continue;
      } catch {
        // file doesn't exist, proceed to copy
      }
      await fs.copyFile(srcPath, destPath);
      copied++;
    }
  }

  return copied;
}

/**
 * Get the global opencode config directory.
 * Supports OPENCODE_CONFIG_DIR env var for non-standard installations.
 */
function getGlobalConfigDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return process.env.OPENCODE_CONFIG_DIR || path.join(home, ".config", "opencode");
}

/**
 * Get the project opencode config directory.
 * Walks up from startDir to find .opencode directory.
 */
function findProjectConfigDir(startDir: string): string | null {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, ".opencode");
    try {
      fsSync.accessSync(candidate);
      return candidate;
    } catch {
      // Not found, walk up
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Safely read and parse a JSON file. Returns null if file doesn't exist or is invalid.
 */
async function readJsonSafe(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Deep-merge source into target without overwriting existing keys.
 * Arrays are replaced entirely (not concatenated).
 * Nested objects are merged recursively.
 */
function deepMergeNoOverwrite(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (!(key in result)) {
      // Key doesn't exist in target — take source value directly
      result[key] = source[key];
    } else if (
      isPlainObject(result[key]) &&
      isPlainObject(source[key])
    ) {
      // Both are objects — recurse
      result[key] = deepMergeNoOverwrite(
        result[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    }
    // Key exists in target and source is not a compatible object — keep target value
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge the MCP servers config into the existing opencode.json config.
 * Only adds servers that don't already exist — never overwrites user config.
 */
function mergeMcpConfig(
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const mcpSection = (isPlainObject(existing.mcp) ? existing.mcp : {}) as Record<string, unknown>;
  const merged = deepMergeNoOverwrite(mcpSection, MCP_SERVERS);
  return { ...existing, mcp: merged };
}

/**
 * Merge the agent definitions into the existing opencode.json config.
 * Only adds agents that don't already exist.
 */
function mergeAgentConfig(
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const agentSection = (isPlainObject(existing.agents) ? existing.agents : {}) as Record<string, unknown>;
  const newAgents = buildAgentConfigs();
  const merged = deepMergeNoOverwrite(agentSection, newAgents);
  return { ...existing, agents: merged };
}

/**
 * Check if a file exists at the given path.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * OpenCode FinAgent Plugin
 *
 * On activation this plugin:
 * 1. Copies bundled .opencode/agents/*.md into the project directory
 * 2. Copies bundled .opencode/skills/fin-analysis-workflow/SKILL.md
 * 3. Merges MCP server and agent config into opencode.json
 * 4. Starts the WebUI management service
 */
export const FinAgentPlugin: Plugin = async (ctx) => {
  const { directory, $ } = ctx;

  try {
    const pluginRoot = resolvePluginRoot();
    const projectRoot = directory;
    const globalConfigDir = getGlobalConfigDir();

    console.log(`[fin-agent] Plugin root: ${pluginRoot}`);
    console.log(`[fin-agent] Project root: ${projectRoot}`);
    console.log(`[fin-agent] Global config: ${globalConfigDir}`);

    // ── Step 1: Copy agent definitions ──────────────────────────────
    const agentSrcDir = path.join(pluginRoot, ".opencode", "agents");
    const agentDestDir = path.join(projectRoot, ".opencode", "agents");

    let agentsCopied = 0;
    if (await fileExists(agentSrcDir)) {
      agentsCopied = await copyDirIfMissing(agentSrcDir, agentDestDir);
      console.log(`[fin-agent] Copied ${agentsCopied} agent file(s) to ${agentDestDir}`);
    } else {
      console.warn(`[fin-agent] Agent source directory not found: ${agentSrcDir}`);
    }

    // ── Step 2: Copy skill definition ───────────────────────────────
    const skillSrcDir = path.join(pluginRoot, ".opencode", "skills", "fin-analysis-workflow");
    const skillDestDir = path.join(projectRoot, ".opencode", "skills", "fin-analysis-workflow");

    let skillCopied = 0;
    if (await fileExists(skillSrcDir)) {
      skillCopied = await copyDirIfMissing(skillSrcDir, skillDestDir);
      console.log(`[fin-agent] Copied ${skillCopied} skill file(s) to ${skillDestDir}`);
    } else {
      console.warn(`[fin-agent] Skill source directory not found: ${skillSrcDir}`);
    }

    // ── Step 3: Read existing opencode.json (global-level) ───────────
    const globalConfigPath = path.join(globalConfigDir, "opencode.json");
    const globalConfig = await readJsonSafe(globalConfigPath);

    if (globalConfig) {
      console.log(`[fin-agent] Found existing global opencode.json — will merge (no overwrite)`);
    } else {
      console.log(`[fin-agent] No global opencode.json found — will create new one`);
    }

    // ── Step 4 & 5: Merge MCP + agent config ────────────────────────
    let config: Record<string, unknown> = globalConfig ?? {};
    config = mergeMcpConfig(config);
    config = mergeAgentConfig(config);

    // Ensure skill path is registered
    if (!config.skills) {
      config.skills = {};
    }
    const skillsSection = config.skills as Record<string, unknown>;
    if (!skillsSection["fin-analysis-workflow"]) {
      skillsSection["fin-analysis-workflow"] = {
        path: ".opencode/skills/fin-analysis-workflow/SKILL.md",
        enabled: true,
      };
    }

    // ── Step 6: Write updated opencode.json to global config ─────────
    await fs.writeFile(globalConfigPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    console.log(`[fin-agent] Wrote merged config to ${globalConfigPath}`);

    // ── Step 6b: Ensure project-level oh-my-openagent.jsonc with concurrency limit ──
    // This creates a project-level override so the 8-agent orchestration doesn't
    // overwhelm API rate limits. The user can adjust the value later via the WebUI.
    const projectOmOConfigPath = path.join(projectRoot, ".opencode", "oh-my-openagent.jsonc");
    let projectOmOConfig: Record<string, unknown> = {};
    try {
      const existingContent = await fs.readFile(projectOmOConfigPath, "utf-8");
      // Strip JSONC comments to parse
      const stripped = existingContent.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      projectOmOConfig = JSON.parse(stripped) as Record<string, unknown>;
      console.log(`[fin-agent] Found existing project-level oh-my-openagent.jsonc`);
    } catch {
      console.log(`[fin-agent] No existing project-level oh-my-openagent.jsonc — will create`);
    }

    // Only set defaultConcurrency if not explicitly configured by user
    if (projectOmOConfig.defaultConcurrency === undefined && 
        (!projectOmOConfig.providerConcurrency || !(projectOmOConfig.providerConcurrency as Record<string, unknown>).mimo)) {
      projectOmOConfig.defaultConcurrency = 4;
      console.log(`[fin-agent] Set defaultConcurrency=4 in project-level oh-my-openagent.jsonc`);
    }

    await fs.writeFile(projectOmOConfigPath, JSON.stringify(projectOmOConfig, null, 2) + "\n", "utf-8");
    console.log(`[fin-agent] Wrote project-level config to ${projectOmOConfigPath}`);

    // ── Step 6c: Build frontend for production ─────────────────────
    // Build the Vite/React frontend so the Express server can serve it statically.
    const webDir = path.join(pluginRoot, "web");
    const webDistDir = path.join(webDir, "dist");
    if (!await fileExists(webDistDir)) {
      console.log(`[fin-agent] Building frontend in ${webDir}...`);
      try {
        const buildResult = await $`npm run build`.cwd(webDir).quiet().nothrow();
        if (buildResult.exitCode === 0) {
          console.log(`[fin-agent] Frontend built successfully -> ${webDistDir}`);
        } else {
          console.warn(`[fin-agent] Frontend build failed (exit ${buildResult.exitCode}) — WebUI will be API-only`);
        }
      } catch (err) {
        console.warn(`[fin-agent] Frontend build error: ${(err as Error).message} — WebUI will be API-only`);
      }
    } else {
      console.log(`[fin-agent] Frontend already built at ${webDistDir} — skipping build`);
    }

    // ── Step 7: Start WebUI management service ──────────────────────
    // The WebUI server is an optional management interface.
    // Gracefully handle the case where it's not yet built.
    const webuiServerPath = path.join(pluginRoot, "web", "server", "dist", "index.js");
    const webuiPort = process.env.FIN_AGENT_WEBUI_PORT ?? "3120";

    if (await fileExists(webuiServerPath)) {
      try {
        console.log(`[fin-agent] Starting WebUI management service on port ${webuiPort}...`);
        // Use Bun's shell API ($) to start the server as a background process.
        // On Windows, use `start` to detach; on Unix, use `&`.
        if (process.platform === "win32") {
          await $`cmd /c start /b node ${webuiServerPath}`.env({
            ...process.env,
            FIN_AGENT_WEBUI_PORT: webuiPort,
          }).quiet();
        } else {
          await $`node ${webuiServerPath} &`.env({
            ...process.env,
            FIN_AGENT_WEBUI_PORT: webuiPort,
          }).quiet();
        }
        console.log(`[fin-agent] WebUI management service started on port ${webuiPort}`);
      } catch (err) {
        // Non-fatal — the plugin still works without the WebUI
        console.warn(`[fin-agent] WebUI service failed to start: ${(err as Error).message}`);
      }
    } else {
      console.log(`[fin-agent] WebUI server not found at ${webuiServerPath} — skipping`);
    }

    console.log(`[fin-agent] Plugin initialized successfully`);
  } catch (err) {
    // Catch-all: log but don't crash opencode
    console.error(`[fin-agent] Plugin initialization error: ${(err as Error).message}`);
  }

  return {
    tool: {
      // TODO: Add financial analysis tools in Wave 2
      // - stock-quote: Real-time stock price lookup
      // - stock-analysis: Technical & fundamental analysis
      // - market-overview: Market indices and sector performance
      // - risk-assess: Portfolio risk calculation
    },

    event: async (_input) => {
      // TODO: Add event handlers for context injection in Wave 2
    },
  };
};

export default FinAgentPlugin;
