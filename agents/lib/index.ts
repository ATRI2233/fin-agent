/**
 * lib-mcp-server — 纯逻辑工具 MCP 服务器
 *
 * 包装 agents/lib/ 中的纯逻辑工具为 MCP 服务器，
 * 让 OpenCode Agent 可以调用这些工具。
 *
 * 工具列表：
 *   - memory_recall      查询历史判断
 *   - memory_verify      验证历史判断
 *   - experience_summary  经验总结
 *   - rule_manage        规则管理
 *   - consistency_check  一致性校验
 */

import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { registerMemoryRecall, registerMemoryVerify, registerExperienceSummary, registerRuleManage, registerMemorySave } from "./memoryTools.js";
import { registerConsistencyCheck } from "./consistencyCheck.js";
import { registerDevilAdvocate } from "./devilAdvocate.js";
import { registerConflictResolver } from "./conflictResolver.js";
import { registerMemoryLearner } from "./memoryLearner.js";
import { ToolRegistration } from "./types.js";

// ── 收集所有工具注册 ──────────────────────────────────────
const tools: ToolRegistration[] = [
  registerMemoryRecall(),
  registerMemoryVerify(),
  registerMemorySave(),
  registerExperienceSummary(),
  registerRuleManage(),
  registerConsistencyCheck(),
  registerDevilAdvocate(),
  registerConflictResolver(),
  registerMemoryLearner(),
];

// ── 创建 MCP Server ──────────────────────────────────────
const server = new Server(
  {
    name: "lib-mcp-server",
    version: "1.0.0",
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
  return await tool.handler(request);
});

// ── 启动 ─────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[lib-mcp-server] 已启动，等待 MCP 客户端连接...");
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
