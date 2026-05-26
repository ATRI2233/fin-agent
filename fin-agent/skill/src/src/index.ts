/**
 * fin-agent-skill — 金融分析 Skill 主入口
 *
 * 工作流：
 *   daily:  市场扫描 → 板块轮动 → 热门标的筛选 → 多信号融合 → 一致性校验 → 经验学习 → 输出报告
 *   weekly: 回顾命中率 → 提炼经验 → 调整权重 → 输出周报
 *   analyze: 单标的深度分析
 *
 * 通过 MCP 客户端调用 fin-agent-mcp-server 的 Tools
 */

import ZAI from "z-ai-web-dev-sdk";

// ── MCP 客户端配置 ────────────────────────────────────────
const MCP_SERVER_COMMAND = "node";
const MCP_SERVER_ARGS = ["../fin-agent-mcp-server/dist/index.js"];

// ── 类型定义 ──────────────────────────────────────────────
interface DailyReport {
  date: string;
  market_snapshot: any;
  sector_rotation: any;
  top_picks: Array<{
    symbol: string;
    name: string;
    fusion_result: any;
    consistency: any;
  }>;
  experience_updates: any;
  summary: string;
}

// ── 主流程 ────────────────────────────────────────────────

async function daily(): Promise<void> {
  console.log("═══════════════════════════════════════════");
  console.log("  金融分析 Agent — 每日报告");
  console.log(`  ${new Date().toISOString().split("T")[0]}`);
  console.log("═══════════════════════════════════════════\n");

  const zai = await ZAI.create();

  // ── Step 1: 市场快照 ──────────────────────────────────
  console.log("📊 Step 1: 获取市场快照...");
  const marketSnapshot = await callMCPTool("market_snapshot", {
    indices: ["^IXIC", "^GSPC", "^DJI", "VIX"],
    include_sectors: true,
  });
  console.log(`  纳斯达克: ${marketSnapshot?.indices?.regularMarketPrice?.raw || "N/A"}`);
  console.log(`  标普500: ${marketSnapshot?.indices?.regularMarketPrice?.raw || "N/A"}`);

  // ── Step 2: 板块轮动 ──────────────────────────────────
  console.log("\n🔄 Step 2: 板块轮动分析...");
  const sectorRotation = await callMCPTool("sector_rotation", {
    benchmark: "^GSPC",
    lookback_days: 20,
  });
  if (sectorRotation?.top_sectors) {
    console.log("  强势板块 Top3:");
    for (const s of sectorRotation.top_sectors) {
      console.log(`    ${s.name}(${s.ticker}): RS=${s.relative_strength.toFixed(2)}, ${s.change_pct_5d > 0 ? "+" : ""}${(s.change_pct_5d * 100).toFixed(1)}%`);
    }
  }

  // ── Step 3: 筛选热门标的 ──────────────────────────────
  console.log("\n🎯 Step 3: 筛选热门标的...");
  const topSectorTickers = getTopSectorTickers(sectorRotation);
  const topPicks: DailyReport["top_picks"] = [];

  for (const ticker of topSectorTickers.slice(0, 5)) {
    console.log(`  分析 ${ticker}...`);

    // 多信号融合
    const fusion = await callMCPTool("signal_fusion", {
      symbol: ticker,
      timeframe: "1m",
    });

    // 一致性校验
    const consistency = await callMCPTool("consistency_check", {
      symbol: ticker,
      current_direction: fusion?.direction || "neutral",
      current_confidence: fusion?.confidence || 50,
    });

    topPicks.push({
      symbol: ticker,
      name: ticker, // 实际应从数据获取
      fusion_result: fusion,
      consistency,
    });

    console.log(`    方向: ${fusion?.direction || "N/A"}, 置信度: ${fusion?.confidence || 0}%, 一致性: ${consistency?.consistency_score || 0}/100`);
  }

  // ── Step 4: 经验学习 ──────────────────────────────────
  console.log("\n🧠 Step 4: 经验学习...");
  const experience = await callMCPTool("experience_learn", {
    mode: "daily_review",
  });
  if (experience?.pattern_insights) {
    for (const insight of experience.pattern_insights) {
      console.log(`  💡 ${insight}`);
    }
  }

  // ── Step 5: 生成报告 ──────────────────────────────────
  console.log("\n📝 Step 5: 生成分析报告...");
  const report = await generateReport(zai, {
    date: new Date().toISOString().split("T")[0],
    market_snapshot: marketSnapshot,
    sector_rotation: sectorRotation,
    top_picks: topPicks,
    experience_updates: experience,
    summary: "",
  });

  console.log("\n" + report);
}

async function weekly(): Promise<void> {
  console.log("═══════════════════════════════════════════");
  console.log("  金融分析 Agent — 周度总结");
  console.log("═══════════════════════════════════════════\n");

  const experience = await callMCPTool("experience_learn", { mode: "weekly_summary" });
  console.log("周度命中率:", experience?.weekly_performance?.hit_rate || "N/A");
  console.log("活跃规则数:", experience?.active_rules || 0);

  if (experience?.recommendations) {
    console.log("\n建议:");
    for (const r of experience.recommendations) {
      console.log(`  • ${r}`);
    }
  }
}

async function analyze(symbol: string): Promise<void> {
  console.log(`\n🔍 深度分析: ${symbol}\n`);

  // 多信号融合
  const fusion = await callMCPTool("signal_fusion", {
    symbol,
    timeframe: "1m",
  });

  // 技术位
  const techLevels = await callMCPTool("technical_levels", {
    ticker: symbol,
  });

  // 一致性
  const consistency = await callMCPTool("consistency_check", {
    symbol,
    current_direction: fusion?.direction || "neutral",
    current_confidence: fusion?.confidence || 50,
  });

  // 输出
  console.log("═══ 融合结果 ═══");
  console.log(`方向: ${fusion?.direction}`);
  console.log(`置信度: ${fusion?.confidence}%`);
  console.log(`加权分数: ${fusion?.weighted_score}`);

  if (fusion?.action_plan) {
    console.log("\n═══ 操作计划 ═══");
    console.log(`入场价: ${fusion.action_plan.entry_price}`);
    console.log(`目标价: ${fusion.action_plan.target_price}`);
    console.log(`止损价: ${fusion.action_plan.stop_loss}`);
    console.log(`建议仓位: ${fusion.action_plan.position_size_pct}%`);
    console.log(`风险收益比: ${fusion.action_plan.risk_reward_ratio}`);
  }

  if (techLevels?.key_levels) {
    console.log("\n═══ 关键价位 ═══");
    for (const level of techLevels.key_levels) {
      console.log(`  ${level.type === "support" ? "支撑" : "阻力"} ${level.price} (${level.strength}) - ${level.reason}`);
    }
  }

  if (techLevels?.action_points) {
    console.log("\n═══ 操作点 ═══");
    for (const point of techLevels.action_points) {
      console.log(`  ${point.action.toUpperCase()} @ ${point.price} (置信度${point.confidence}%) - ${point.reason}`);
    }
  }

  console.log("\n═══ 一致性 ═══");
  console.log(`一致性评分: ${consistency?.consistency_score}/100`);
  if (consistency?.issues?.length) {
    console.log("问题:");
    for (const issue of consistency.issues) {
      console.log(`  ⚠️ ${issue}`);
    }
  }
}

// ── MCP Tool 调用（通过 ZAI SDK）──────────────────────────
// 实际部署时通过 MCP 协议调用，这里用简化版本

async function callMCPTool(toolName: string, args: any): Promise<any> {
  try {
    const zai = await ZAI.create();
    // 通过 z-ai-web-dev-sdk 调用 MCP Tool
    const result = await (zai.functions.invoke as any)("mcp_call", {
      server: "fin-agent-mcp-server",
      tool: toolName,
      arguments: args,
    });
    return result;
  } catch {
    // MCP 不可用时，直接调用 Finance API 作为降级
    console.log(`  [降级] MCP ${toolName} 不可用，使用直接 API 调用`);
    return await fallbackCall(toolName, args);
  }
}

// ── 降级方案：直接调用 Finance API ────────────────────────

async function fallbackCall(toolName: string, args: any): Promise<any> {
  const GATEWAY_URL = process.env.GATEWAY_URL || "https://internal-api.z.ai";
  const API_PREFIX = process.env.API_PREFIX || "/external/finance";

  async function fetchAPI(endpoint: string): Promise<any> {
    const url = `${GATEWAY_URL}${API_PREFIX}${endpoint}`;
    const res = await fetch(url, { headers: { "X-Z-AI-From": "Z" } });
    if (!res.ok) return null;
    const data = await res.json();
    return (data as any)?.body || data;
  }

  switch (toolName) {
    case "market_snapshot": {
      const indices = args.indices || ["^IXIC", "^GSPC", "^DJI"];
      const data = await fetchAPI(`/v1/markets/stock/quotes?ticker=${indices.join(",")}`);
      return { indices: data };
    }
    case "sector_rotation": {
      const etfs = "XLK,XLF,XLE,XLV,XLY,XLP,XLI,XLU,XLB,XLRE,XLC";
      const data = await fetchAPI(`/v1/markets/stock/quotes?ticker=${etfs}`);
      return { all_sectors: data };
    }
    case "signal_fusion": {
      const quote = await fetchAPI(`/v1/markets/quote?ticker=${args.symbol}&type=STOCKS`);
      const news = await fetchAPI(`/v2/markets/news?ticker=${args.symbol}`);
      return {
        symbol: args.symbol,
        direction: "neutral",
        confidence: 30,
        weighted_score: 0,
        action_plan: { entry_price: 0, target_price: 0, stop_loss: 0, position_size_pct: 0, timeframe: args.timeframe, risk_reward_ratio: 0 },
        signals: [],
        key_factors: ["降级模式：数据不完整"],
        warnings: ["MCP 服务器不可用，结果仅供参考"],
      };
    }
    default:
      return null;
  }
}

// ── 报告生成 ──────────────────────────────────────────────

async function generateReport(zai: ZAI, data: DailyReport): Promise<string> {
  const prompt = `你是一位专业的金融分析师。基于以下数据，生成一份简洁的每日分析报告：

市场快照: ${JSON.stringify(data.market_snapshot?.indices || {}).slice(0, 500)}
板块轮动: ${JSON.stringify(data.sector_rotation?.top_sectors || []).slice(0, 500)}
热门标的: ${data.top_picks.map((p) => `${p.symbol}: ${p.fusion_result?.direction}(${p.fusion_result?.confidence}%)`).join(", ")}
经验洞察: ${JSON.stringify(data.experience_updates?.pattern_insights || []).slice(0, 300)}

请输出：
1. 今日市场概况（2-3句）
2. 强势板块与逻辑（每个板块1句）
3. 推荐关注标的及操作建议（含入场/目标/止损）
4. 风险提示
5. 一致性提醒（如有方向翻转）`;

  try {
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: "你是专业金融分析师，输出简洁、数据驱动、不废话。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    });
    return completion.choices[0]?.message?.content || "报告生成失败";
  } catch {
    return "报告生成失败（LLM 不可用）";
  }
}

// ── 辅助函数 ──────────────────────────────────────────────

function getTopSectorTickers(sectorRotation: any): string[] {
  if (!sectorRotation?.top_sectors) {
    // 默认热门标的
    return ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA"];
  }

  // 根据强势板块选择代表性标的
  const sectorStocks: Record<string, string[]> = {
    XLK: ["AAPL", "MSFT", "NVDA", "AVGO", "AMD"],
    XLF: ["JPM", "BAC", "GS", "MS"],
    XLE: ["XOM", "CVX", "COP"],
    XLV: ["UNH", "JNJ", "PFE", "LLY"],
    XLY: ["AMZN", "TSLA", "HD", "NKE"],
    XLI: ["CAT", "HON", "UNP", "GE"],
    XLP: ["PG", "KO", "PEP", "WMT"],
    XLU: ["NEE", "DUK", "SO"],
    XLB: ["LIN", "APD", "SHW"],
    XLRE: ["AMT", "PLD", "CCI"],
    XLC: ["META", "GOOGL", "DIS", "NFLX"],
  };

  const tickers: string[] = [];
  for (const sector of sectorRotation.top_sectors) {
    const stocks = sectorStocks[sector.ticker] || [];
    tickers.push(...stocks.slice(0, 2));
  }
  return tickers.slice(0, 8);
}

// ── CLI 入口 ──────────────────────────────────────────────

async function main() {
  const command = process.argv[2];
  const arg = process.argv[3];

  switch (command) {
    case "daily":
      await daily();
      break;
    case "weekly":
      await weekly();
      break;
    case "analyze":
      if (!arg) {
        console.error("用法: fin-agent analyze <TICKER>");
        process.exit(1);
      }
      await analyze(arg);
      break;
    default:
      console.log("用法: fin-agent <daily|weekly|analyze>");
      console.log("  daily   — 每日分析报告");
      console.log("  weekly  — 周度总结");
      console.log("  analyze — 个股深度分析");
  }
}

main().catch((err) => {
  console.error("执行失败:", err);
  process.exit(1);
});
