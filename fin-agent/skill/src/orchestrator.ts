/**
 * 多 Agent 调度器 — 8 Agent 并行协作
 *
 * 流程：
 *   1. 解析 agent 配置（fin-agent/skill/agents/*.md）
 *   2. 并行执行 Agent 1-7（各自调用白名单内的 MCP 工具）
 *   3. 收集结果传入 Agent 8（Fusion Brain 做融合计算）
 *   4. 输出最终结果
 *
 * 用法：npx ts-node src/orchestrator.ts <SYMBOL> <US|CN>
 */

import * as fs from "fs";
import * as path from "path";
import ZAI from "z-ai-web-dev-sdk";

// ── 类型定义 ──────────────────────────────────────────────

interface AgentConfig {
  name: string;
  description: string;
  role: string;
  tools: string[];
}

interface AgentResult {
  agent: string;
  timestamp: string;
  symbol: string;
  market: string;
  [key: string]: any;
}

// ── 工具到 MCP Server 路由表 ──────────────────────────────

const TOOL_SERVER_MAP: Record<string, string> = {
  // fin-agent-mcp-server
  market_snapshot: "fin-agent",
  sector_rotation: "fin-agent",
  technical_levels: "fin-agent",
  news_sentiment: "fin-agent",
  fundamental_scan: "fin-agent",
  signal_fusion: "fin-agent",
  options_greeks: "fin-agent",
  analyst_ratings: "fin-agent",
  sec_filings: "fin-agent",
  insider_trading: "fin-agent",
  fear_greed_index: "fin-agent",
  commodity_prices: "fin-agent",
  risk_gauge: "fin-agent",
  earnings_calendar: "fin-agent",
  memory_recall: "fin-agent",
  memory_verify: "fin-agent",
  experience_summary: "fin-agent",
  rule_manage: "fin-agent",
  consistency_check: "fin-agent",

  // ashare-mcp-server
  ashare_quote: "ashare",
  ashare_technical_levels: "ashare",
  ashare_fundamental_scan: "ashare",
  ashare_news_sentiment: "ashare",
  ashare_market_snapshot: "ashare",
  ashare_fund_flow: "ashare",
  ashare_lhb: "ashare",

  // fred-mcp-server
  fred_series: "fred",
  fred_search: "fred",
  fred_browse: "fred",

  // risk-mcp-server
  position_sizing: "risk",
  institutional_flow: "risk",

  // sec-edgar-mcp
  get_cik_by_ticker: "sec-edgar",
  get_company_info: "sec-edgar",
  search_companies: "sec-edgar",
  get_company_facts: "sec-edgar",
  get_recent_filings: "sec-edgar",
  get_filing_content: "sec-edgar",
  analyze_8k: "sec-edgar",
  get_filing_sections: "sec-edgar",
  get_financials: "sec-edgar",
  get_segment_data: "sec-edgar",
  get_key_metrics: "sec-edgar",
  compare_periods: "sec-edgar",
  discover_company_metrics: "sec-edgar",
  get_xbrl_concepts: "sec-edgar",
  discover_xbrl_concepts: "sec-edgar",
  get_insider_transactions: "sec-edgar",
  get_insider_summary: "sec-edgar",
  get_form4_details: "sec-edgar",
  analyze_form4_transactions: "sec-edgar",
  analyze_insider_sentiment: "sec-edgar",
  get_recommended_tools: "sec-edgar",
};

// ── Agent 配置解析 ────────────────────────────────────────

function parseAgentConfig(filePath: string): AgentConfig {
  const content = fs.readFileSync(filePath, "utf-8");

  // 解析 frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  let name = "";
  let description = "";
  let role = "";
  if (fmMatch) {
    const fm = fmMatch[1];
    const nameMatch = fm.match(/name:\s*(.+)/);
    const descMatch = fm.match(/description:\s*"(.+)"/);
    const roleMatch = fm.match(/role:\s*(.+)/);
    if (nameMatch) name = nameMatch[1].trim();
    if (descMatch) description = descMatch[1].trim();
    if (roleMatch) role = roleMatch[1].trim();
  }

  // 解析工具列表（从 markdown 中提取 `tool_name` 格式）
  const toolPattern = /`([a-z_]+)`/g;
  const tools: string[] = [];
  let match: RegExpExecArray | null;

  // 只从"可用工具"区域提取
  const toolSection = content.split(/## 可用工具/)[1]?.split(/## /)[0] || "";
  while ((match = toolPattern.exec(toolSection)) !== null) {
    const tool = match[1];
    // 过滤掉非工具名的反引号内容
    if (TOOL_SERVER_MAP[tool] && !tools.includes(tool)) {
      tools.push(tool);
    }
  }

  return { name, description, role, tools };
}

function loadAllAgents(): AgentConfig[] {
  const agentsDir = path.join(__dirname, "..", "agents");
  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md") && f !== "README.md");

  // 按 agent 编号排序（macro-scout=1, sector-rotator=2, ...）
  const order = [
    "macro-scout",
    "sector-rotator",
    "sentiment-decoder",
    "technical-chartist",
    "fundamental-auditor",
    "smart-money-hound",
    "risk-gatekeeper",
    "fusion-brain",
  ];

  const agents: AgentConfig[] = [];
  for (const name of order) {
    const file = files.find((f) => f === `${name}.md`);
    if (file) {
      agents.push(parseAgentConfig(path.join(agentsDir, file)));
    }
  }
  return agents;
}

// ── MCP 工具调用（通过 ZAI SDK）──────────────────────────

async function callTool(toolName: string, args: any): Promise<any> {
  const server = TOOL_SERVER_MAP[toolName];
  if (!server) {
    throw new Error(`未知工具: ${toolName}，无对应的 MCP Server`);
  }

  try {
    const zai = await ZAI.create();
    const result = await (zai.functions.invoke as any)("mcp_call", {
      server,
      tool: toolName,
      arguments: args,
    });
    return result;
  } catch (err: any) {
    console.error(`  [${toolName}] 调用失败: ${err.message}`);
    return null;
  }
}

// ── Agent 执行器 ──────────────────────────────────────────

// 每个 agent 的工具调用逻辑（根据 agent 角色决定调用哪些工具、传什么参数）
async function runAgent(
  agent: AgentConfig,
  symbol: string,
  market: string
): Promise<AgentResult> {
  const startTime = Date.now();
  const result: AgentResult = {
    agent: agent.name,
    timestamp: new Date().toISOString(),
    symbol,
    market,
  };

  const isCN = market === "CN";

  try {
    switch (agent.name) {
      case "macro-scout": {
        // Agent 1: 宏观环境
        const calls: Promise<any>[] = [];
        if (isCN) {
          calls.push(callTool("ashare_market_snapshot", {}));
        } else {
          calls.push(callTool("market_snapshot", { indices: ["^IXIC", "^GSPC", "^DJI"], include_sectors: true }));
        }
        calls.push(callTool("commodity_prices", {}));
        calls.push(callTool("fear_greed_index", {}));
        calls.push(callTool("fred_series", { series_id: "DGS10" }));

        const [snap, commodities, fearGreed, rates] = await Promise.all(calls);
        result.snapshot = snap;
        result.commodities = commodities;
        result.fear_greed = fearGreed;
        result.rates = rates;
        break;
      }

      case "sector-rotator": {
        // Agent 2: 板块轮动
        const calls: Promise<any>[] = [];
        if (isCN) {
          calls.push(callTool("ashare_fund_flow", { symbol }));
          calls.push(callTool("ashare_market_snapshot", {}));
          calls.push(callTool("ashare_news_sentiment", { symbol }));
        } else {
          calls.push(callTool("sector_rotation", { benchmark: "^GSPC", lookback_days: 20 }));
        }
        const results = await Promise.all(calls);
        if (isCN) {
          result.fund_flow = results[0];
          result.market_snapshot = results[1];
          result.sector_news = results[2];
        } else {
          result.sector_rotation = results[0];
        }
        break;
      }

      case "sentiment-decoder": {
        // Agent 3: 新闻情绪
        if (isCN) {
          result.news = await callTool("ashare_news_sentiment", { symbol });
        } else {
          result.news = await callTool("news_sentiment", { symbol });
        }
        break;
      }

      case "technical-chartist": {
        // Agent 4: 技术形态
        if (isCN) {
          const [tech, quote] = await Promise.all([
            callTool("ashare_technical_levels", { symbol }),
            callTool("ashare_quote", { symbol }),
          ]);
          result.technical = tech;
          result.quote = quote;
        } else {
          result.technical = await callTool("technical_levels", { ticker: symbol });
        }
        break;
      }

      case "fundamental-auditor": {
        // Agent 5: 基本面
        const calls: Promise<any>[] = [];
        if (isCN) {
          calls.push(callTool("ashare_fundamental_scan", { symbol }));
        } else {
          calls.push(callTool("fundamental_scan", { symbol }));
          calls.push(callTool("analyst_ratings", { symbol }));
          calls.push(callTool("earnings_calendar", { symbol }));
          calls.push(callTool("sec_filings", { symbol }));
        }
        const results = await Promise.all(calls);
        if (isCN) {
          result.fundamental = results[0];
        } else {
          result.fundamental = results[0];
          result.analyst = results[1];
          result.earnings = results[2];
          result.filings = results[3];
        }
        break;
      }

      case "smart-money-hound": {
        // Agent 6: 聪明钱
        const calls: Promise<any>[] = [];
        if (isCN) {
          calls.push(callTool("ashare_fund_flow", { symbol }));
          calls.push(callTool("ashare_lhb", { symbol }));
        } else {
          calls.push(callTool("insider_trading", { symbol }));
          calls.push(callTool("institutional_flow", { symbol }));
        }
        const results = await Promise.all(calls);
        if (isCN) {
          result.fund_flow = results[0];
          result.lhb = results[1];
        } else {
          result.insider = results[0];
          result.institutional = results[1];
        }
        break;
      }

      case "risk-gatekeeper": {
        // Agent 7: 风控
        const calls: Promise<any>[] = [];
        calls.push(callTool("risk_gauge", { symbol }));
        calls.push(callTool("position_sizing", { symbol }));
        if (!isCN) {
          calls.push(callTool("options_greeks", { symbol }));
        }
        const results = await Promise.all(calls);
        result.risk = results[0];
        result.position = results[1];
        if (!isCN) result.options = results[2];
        break;
      }

      case "fusion-brain": {
        // Agent 8: 不单独运行，由调度器传入其他 agent 的结果
        break;
      }
    }
  } catch (err: any) {
    result.error = err.message;
  }

  result._duration_ms = Date.now() - startTime;
  return result;
}

// ── 融合计算 ─────────────────────────────────────────────

async function runFusionBrain(
  symbol: string,
  market: string,
  agentResults: Record<string, AgentResult>
): Promise<any> {
  // 查历史
  const history = await callTool("memory_recall", { symbol });

  // 构造融合输入
  const fusionInput = {
    symbol,
    market,
    signals: {
      macro: agentResults["macro-scout"] || {},
      sector: agentResults["sector-rotator"] || {},
      sentiment: agentResults["sentiment-decoder"] || {},
      technical: agentResults["technical-chartist"] || {},
      fundamental: agentResults["fundamental-auditor"] || {},
      smart_money: agentResults["smart-money-hound"] || {},
      risk: agentResults["risk-gatekeeper"] || {},
    },
    history: history || null,
  };

  // 调用信号融合
  const fusion = await callTool("signal_fusion", {
    symbol,
    timeframe: "1m",
    ...fusionInput,
  });

  // 一致性校验
  const consistency = await callTool("consistency_check", {
    symbol,
    current_direction: fusion?.direction || "neutral",
    current_confidence: fusion?.confidence || 50,
  });

  return {
    engine: "fusion-brain",
    timestamp: new Date().toISOString(),
    symbol,
    fusion,
    consistency,
    history,
    raw_signals: fusionInput.signals,
  };
}

// ── 调度主流程 ────────────────────────────────────────────

async function orchestrate(symbol: string, market: string): Promise<void> {
  console.log("═".repeat(60));
  console.log(`  多 Agent 协作分析 — ${symbol} (${market})`);
  console.log(`  ${new Date().toISOString()}`);
  console.log("═".repeat(60));

  // 加载 agent 配置
  const agents = loadAllAgents();
  const fusionBrain = agents.find((a) => a.name === "fusion-brain");
  const dataAgents = agents.filter((a) => a.name !== "fusion-brain");

  console.log(`\n已加载 ${agents.length} 个 Agent 配置:`);
  for (const a of agents) {
    console.log(`  ${a.name} — ${a.tools.length} 个工具`);
  }

  // ── Step 1: 并行执行 Agent 1-7 ─────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log("Step 1: 并行执行 Agent 1-7...");
  console.log("─".repeat(60));

  const startTime = Date.now();

  const results = await Promise.all(
    dataAgents.map(async (agent) => {
      const label = `[${agent.name}]`;
      console.log(`  ${label} 开始执行...`);
      try {
        const result = await runAgent(agent, symbol, market);
        console.log(`  ${label} 完成 (${result._duration_ms}ms)`);
        return result;
      } catch (err: any) {
        console.error(`  ${label} 失败: ${err.message}`);
        return { agent: agent.name, error: err.message, timestamp: new Date().toISOString(), symbol, market };
      }
    })
  );

  const parallelTime = Date.now() - startTime;
  console.log(`\n  Agent 1-7 全部完成，耗时 ${parallelTime}ms（并行）`);

  // 整理结果
  const agentResults: Record<string, AgentResult> = {};
  for (const r of results) {
    agentResults[r.agent] = r;
  }

  // ── Step 2: 传入 Fusion Brain ──────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log("Step 2: Fusion Brain 融合计算...");
  console.log("─".repeat(60));

  const fusionStart = Date.now();
  const fusionResult = await runFusionBrain(symbol, market, agentResults);
  const fusionTime = Date.now() - fusionStart;

  console.log(`  Fusion Brain 完成 (${fusionTime}ms)`);

  // ── Step 3: 输出全部 8 个 Agent 结果 ────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  全部 Agent 输出 — ${symbol} (${market})`);
  console.log("═".repeat(60));

  // Agent 1-7 各自输出
  for (const r of results) {
    const idx = dataAgents.findIndex((a) => a.name === r.agent) + 1;
    console.log(`\n${"─".repeat(60)}`);
    console.log(`Agent ${idx} — ${r.agent} (${r._duration_ms || 0}ms)`);
    console.log("─".repeat(60));
    console.log(JSON.stringify(r, null, 2));
  }

  // Agent 8 输出
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Agent 8 — fusion-brain (${fusionTime}ms)`);
  console.log("─".repeat(60));
  console.log(JSON.stringify(fusionResult, null, 2));

  console.log(`\n${"═".repeat(60)}`);
  console.log(`总耗时: ${parallelTime + fusionTime}ms`);
  console.log(`  Agent 1-7 并行: ${parallelTime}ms`);
  console.log(`  Agent 8 Fusion Brain: ${fusionTime}ms`);
}

// ── CLI 入口 ──────────────────────────────────────────────

async function main() {
  const symbol = process.argv[2];
  const market = (process.argv[3] || "US").toUpperCase();

  if (!symbol) {
    console.log("用法: npx ts-node src/orchestrator.ts <SYMBOL> <US|CN>");
    console.log("示例:");
    console.log("  npx ts-node src/orchestrator.ts AAPL US");
    console.log("  npx ts-node src/orchestrator.ts 600036 CN");
    process.exit(1);
  }

  await orchestrate(symbol, market);
}

main().catch((err) => {
  console.error("调度失败:", err);
  process.exit(1);
});
