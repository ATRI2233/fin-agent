/**
 * fin-agent-mcp-server — 金融分析 MCP 服务器
 *
 * 核心设计理念：
 *   1. 多源数据聚合：新闻/财报/技术面/宏观 — 各自独立采集，互不干扰
 *   2. 信号加权融合：技术面35% + 基本面30% + 情绪10% + 宏观10% + 期权10% + 内部交易5%
 *   3. 持久化记忆层：SQLite 存储历史判断、验证结果、经验规则、内部交易、期权信号
 *   4. 逻辑一致性引擎：每次新判断必须与历史判断对比，不一致时强制解释
 *   5. 技术位计算器：支撑/阻力/关键价位自动标注
 *   6. 外部 MCP 集成：通过 MCPClientManager 调用 stock-scanner/mcp-edgar 等
 *
 * MCP Tools 暴露给 Agent：
 *   - market_snapshot    市场快照（指数+板块+成交量）
 *   - sector_rotation    板块轮动分析
 *   - technical_levels   技术位计算（支撑/阻力/趋势线）
 *   - news_sentiment     新闻情绪（带衰减因子）
 *   - fundamental_scan   基本面扫描（财报/估值/盈利质量）
 *   - signal_fusion      多信号融合（核心：加权+一致性校验）
 *   - options_greeks     期权 Greeks（Delta/Gamma/Theta/Vega/Rho）
 *   - analyst_ratings    分析师评级/目标价
 *   - sec_filings        SEC 文件查询（10-K/10-Q/8-K）
 *   - insider_trading    内部交易追踪
 *   - fear_greed_index   恐惧贪婪指数
 *   - commodity_prices   大宗商品价格
 *   - memory_recall      查询历史判断与验证
 *   - risk_gauge        风控指标计算（波动率/回撤/VaR）
 *   - earnings_calendar 财报日历（未来7日财报发布）
 *   - experience_summary 输出近N天经验总结
 *   - rule_manage        管理经验规则
 */

import "./proxy.js";
import "dotenv/config";

import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { registerMarketSnapshot } from "./tools/marketSnapshot.js";
import { registerSectorRotation } from "./tools/sectorRotation.js";
import { registerTechnicalLevels } from "./tools/technicalLevels.js";
import { registerNewsSentiment } from "./tools/newsSentiment.js";
import { registerFundamentalScan } from "./tools/fundamentalScan.js";
import { registerSignalFusion } from "./tools/signalFusion.js";
import { registerOptionsGreeks } from "./tools/optionsGreeks.js";
import { registerAnalystRatings } from "./tools/analystRatings.js";
import { registerSECFilings } from "./tools/secFilings.js";
import { registerInsiderTrading } from "./tools/insiderTrading.js";
import { registerFearGreedIndex } from "./tools/fearGreedIndex.js";
import { registerCommodityPrices } from "./tools/commodityPrices.js";
import { registerRiskGauge } from "./tools/riskGauge.js";
import { registerEarningsCalendar } from "./tools/earningsCalendar.js";
import { registerMemoryRecall, registerMemoryVerify, registerExperienceSummary, registerRuleManage } from "./tools/memoryTools.js";
import { registerConsistencyCheck } from "./tools/consistencyCheck.js";
import { MCPClientManager } from "./mcp/mcpClientManager.js";
import { ToolRegistration } from "./types.js";

// ── MCP 客户端管理器（用于调用外部 MCP 服务器）────────────
const externalMCPManager = new MCPClientManager();

// ── 收集所有工具注册 ──────────────────────────────────────
const tools: ToolRegistration[] = [
  registerMarketSnapshot(externalMCPManager),
  registerSectorRotation(externalMCPManager),
  registerTechnicalLevels(externalMCPManager),
  registerNewsSentiment(externalMCPManager),
  registerFundamentalScan(externalMCPManager),
  registerSignalFusion(externalMCPManager),
  registerOptionsGreeks(externalMCPManager),
  registerAnalystRatings(externalMCPManager),
  registerSECFilings(externalMCPManager),
  registerInsiderTrading(externalMCPManager),
  registerFearGreedIndex(externalMCPManager),
  registerCommodityPrices(externalMCPManager),
  registerRiskGauge(externalMCPManager),
  registerEarningsCalendar(externalMCPManager),
  registerMemoryRecall(),
  registerMemoryVerify(),
  registerExperienceSummary(),
  registerRuleManage(),
  registerConsistencyCheck(),
];

// ── 创建 MCP Server ──────────────────────────────────────
const server = new Server(
  {
    name: "fin-agent-mcp-server",
    version: "1.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ── 统一 tools/list handler ──────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

// ── 统一 tools/call handler（按 name 路由）────────────────
server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
  const tool = tools.find((t) => t.name === request.params.name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }
  const result = await tool.handler(request);

  // ── 自动记录中间件 ─────────────────────────────────────
  const AUTO_LOG_TOOLS = ["market_snapshot", "signal_fusion", "consistency_check"];
  if (AUTO_LOG_TOOLS.includes(request.params.name)) {
    try {
      const { autoLogAnalysis } = await import("./memory/memoryStore.js");
      const args = request.params.arguments || {};
      const parsed = result.content?.[0]?.text ? JSON.parse(result.content[0].text) : {};
      autoLogAnalysis({
        symbol: parsed?.symbol || args?.symbol || args?.indices?.[0] || "SPX",
        direction: parsed?.direction || parsed?.signal || "neutral",
        confidence: parsed?.confidence || 50,
        key_prices: parsed?.key_prices || parsed?.pivot_points,
        reasons: typeof parsed === "string" ? parsed : JSON.stringify(parsed).slice(0, 500),
        source_signals: parsed?.signals || parsed?.signal_sources,
      });
    } catch (e) {
      console.error("[memory] auto-log failed:", e);
    }
  }

  return result;
});

// ── 启动 ─────────────────────────────────────────────────
async function main() {
  await externalMCPManager.initialize();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[fin-agent-mcp-server] 已启动，等待 MCP 客户端连接...");
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
