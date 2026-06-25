# Fin-Agent 全代码库审计报告总索引

> **审计范围：** 全代码库 5 个模块 + 跨层集成 | **日期：** 2026/06/25 | **总发现数：** ~288

---

## 📊 总体统计

| # | 审计报告 | 文件 | Bug | 死代码 | 冗余 | 设计 | **总计** |
|---|---------|------|:---:|:------:|:---:|:---:|:-------:|
| 01 | [Server Backend](01-server-backend-audit.md) | `project/src/server/` | 31 | 6 | 5 | 17 | **59** |
| 02 | [Agent/MCP System](02-agent-mcp-audit.md) | `project/src/agents/` | 18 | 16 | 12 | 18 | **64** |
| 03 | [WebUI Frontend](03-webui-frontend-audit.md) | `project/src/webui/` | 12 | 27 | 26 | 38 | **103** |
| 04 | [Tests & Config](04-tests-config-audit.md) | `project/tests/` + `project/config/` | 4 | 4 | 1 | 5 | **14** |
| 05 | [Cross-layer Integration](05-cross-layer-integration-audit.md) | 跨层契约 | 15 | 2 | 5 | 26 | **48** |
| | **合计** | | **80** | **55** | **49** | **104** | **~288** |

---

## 🚨 Top 15 需立即修复的问题

| 优先级 | 问题 | 报告# | 严重度 |
|--------|------|-------|--------|
| P0 | `.env` 前缀过滤使全部配置静默失效 | 01, 05 | 🔴 CRITICAL |
| P0 | `PRAGMA foreign_keys = ON` 缺失 — 全部外键约束失效 | 01 | 🔴 CRITICAL |
| P0 | `conversations.ts` 使用未声明的 `conversationRepo` → 全路由 HTTP 500 | 01, 05 | 🔴 CRITICAL |
| P0 | `dataHub.ts` ESM 模式下 `__dirname` 崩溃 | 02 | 🔴 CRITICAL |
| P0 | 集成测试导入不存在的函数，测试无法运行 | 04 | 🔴 CRITICAL |
| P1 | `dataHub.ts` 验证系统因 `support=0` 被系统性破坏 | 02 | 🟠 HIGH |
| P1 | 清理日期格式与 SQLite 不匹配，数据库无限增长 | 02 | 🟠 HIGH |
| P1 | 前后端 8+ 处 API 路径/字段名不一致 → 前端始终拿 `undefined` | 05 | 🟠 HIGH |
| P1 | 同步执行超时前端 30s timeout | 05 | 🟠 HIGH |
| P1 | Agent 输出通过级联 `as any` 完全失去类型安全 | 05 | 🟠 HIGH |
| P2 | `scheduleNode` 11 个位置参数 | 01 | 🟡 MEDIUM |
| P2 | 6 个 MCP 工具静默返回模拟数据无标识 | 02 | 🟡 MEDIUM |
| P2 | Frontend `filePath` 列永久不可用 | 03 | 🟡 MEDIUM |
| P2 | WorkflowSettingsModal 每次保存静默清除 cron_expression | 03 | 🟡 MEDIUM |
| P2 | API key 损坏/重复 (FINNHUB doubled, FMP=FRED) | 04 | 🟡 MEDIUM |

---

## 📁 文件清单

```
project/docs/audit/
├── 00-audit-summary.md          ← 本文件（总索引）
├── 01-server-backend-audit.md   ← Server 后端审计（59 发现）
├── 02-agent-mcp-audit.md        ← Agent/MCP 系统审计（64 发现）
├── 03-webui-frontend-audit.md   ← WebUI 前端审计（103 发现）
├── 04-tests-config-audit.md     ← 测试与配置审计（14 发现）
└── 05-cross-layer-integration-audit.md  ← 跨层集成审计（48 发现）
```

---

## 🔥 按模块的 Bug 密度

| 模块 | 文件数 | Bug 数 | Bug/文件 | 最高风险文件 |
|------|:-----:|:------:|:--------:|------------|
| `server/api/v1/routes/` | 5 | ~12 | 2.4 | `conversations.ts` |
| `server/infra/` | 5 | ~8 | 1.6 | `settings.ts`, `db.ts` |
| `server/modules/execution/` | 3 | ~10 | 3.3 | `repo.ts` |
| `server/modules/workflow/` | 5 | ~10 | 2.0 | `workflow_runner.ts` |
| `agents/lib/` | 3 | ~6 | 2.0 | `dataHub.ts` |
| `agents/adapter/` | 2 | ~3 | 1.5 | `OpenClawAdapter.ts` |
| `agents/mcp/core/src/tools/` | ~8 | ~8 | 1.0 | 6 个静默模拟数据工具 |
| `webui/src/pages/` | ~15 | ~8 | 0.5 | `FrameworkPage.tsx` |
| `webui/src/styles/` | 1 | 0 | 0 | `theme.css`（27 个无用类） |

---

## 🏗 架构层面的系统性风险

1. **类型安全全面缺失** — `as any`、`as DbJson`、`as ExecutionStatus` 在后端 repo、前端 domain、跨层适配器中到处使用，TypeScript 编译器形同虚设。
2. **前后端契约无共享** — 字段名、类型定义、API 路径全凭手动对齐，已出现 8+ 处不匹配。
3. **测试覆盖严重不足** — 核心模块（WorkflowRunner, ExecutionDomainService, Repos, Adapter, 全部路由）无单元测试，集成测试因导入不存在函数而无法运行。
4. **配置管理分裂** — `.env` 被 `settings.ts` 前缀过滤屏蔽，MCP 工具直接 `process.env` 读取，两条路径彼此不知。
5. **错误处理不一致** — 后端 `FinAgentError.cause` 未传播到原生 `Error.cause`，前端无法根据 `code` 分类错误，DB 乐观锁冲突被静默吞掉。

---

## 📋 推荐修复路线

### 第 1 波 — 立即修复（运行时崩溃）
1. 修复 `settings.ts` 的 `FIN_AGENT_` 前缀过滤 → 使 `.env` 生效
2. 在 `db.ts` 初始化后加 `PRAGMA foreign_keys = ON`
3. 修复 `dataHub.ts` 的 `__dirname` → `fileURLToPath(import.meta.url)`
4. 在 `conversations.ts` 中用 `req.registry!.resolve()` 声明 `conversationRepo`
5. 修复集成测试的 import 路径和构造参数

### 第 2 波 — 核心逻辑修正
6. 修复 `dataHub.ts` 的 `support`/`resistance` 默认值和日期格式
7. 对齐前后端 API 路径、字段名、类型（特别是 execution_id vs executionId）
8. 修复 `.env` 中损坏的 API keys
9. 为 scheduleNode 添加 AbortController/cancel 机制

### 第 3 波 — 架构优化
10. `scheduleNode` 改为 options object 参数
11. 合并 3 个 Python MCP server 的 stdio 循环
12. `ExecutionRepo` 提取 `updateNodeStatus` 统一方法
13. 清理 `theme.css` 中 27 个无用类

### 第 4 波 — 长期治理
14. 为所有工具添加模拟数据警告标识
15. 引入前后端共享类型（monorepo package 或 codegen）
16. 为核心模块编写单元测试
17. 拆分 AppLayout 为单一职责组件

---

> **完整细则请阅读各子报告。** 每个报告均包含严重度标签、文件路径、行号和修复建议。
