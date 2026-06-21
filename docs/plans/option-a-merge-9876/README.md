# 选项 A 实施计划：合并 9876 Express 到 8000 FastAPI

> 创建日期：2026-06-20
> 预计工期：5-7 工作日（取决于团队规模和测试覆盖）
> 状态：**待审批**

## 背景

fin-agent 当前存在三个 HTTP 服务并存：

| 端口 | 服务 | 职责 |
|---|---|---|
| **8000** | FastAPI（Python） | 业务后端（workflows/executions/agents/mcp/conversations/config/skills） |
| **9876** | Express（TypeScript） | opencode JSON/skills/agents 的配置文件读写 + 静态托管 |
| **4096** | opencode CLI（独立进程） | opencode SDK 服务（`opencode serve --port 4096`） |

**问题**：9876 端 35 个端点与 8000 端重叠（仅配置文件读写，无 SDK 转发、无 CLI spawn），导致前端 baseURL 散落、CORS 链路复杂、启动脚本需管三套进程、v1 端点字段不一致——近两轮调试的根因都指向这个架构债。

**目标**：9876 仅保留其"opencode 配置读写"职责的**等价能力**迁移到 8000 v1 router；前端所有调用统一走 `OPENCODE_API_BASE = "/api/v1"` 单一来源；启动脚本移除 Express 段。最终 8000 一个后端承接所有 API（不含 opencode SDK 转发——它独立运行在 4096）。

## 关键事实（已确认）

- **9876 没有任何 opencode SDK 转发**：`grep '@opencode-ai' | createOpencodeClient | child_process | spawn` 在 `src/webui/server/*.ts` **0 命中**。opencode CLI 由 `start.ps1:79-86` 独立以 4096 端口启动。
- **8000 已有 4 个相关 v1 router**：`mcp.py`（只 tools/servers/allowed-tools）、`skills.py`（count/list）、`agents.py`（list/detail）、`config.py`（scope/file），4 个用 `ApiResponse` 信封包装。
- **前端 25 个 hook 路径走 9876**：见 `src/webui/src/hooks/useOpencode.ts`。
- **vite proxy** 当前是 `/api/v1 → 8000` + `/api → 9876` + bypass 隔离。
- **页面代码不动**：所有 5 个目标页面（`MCPServersPage.tsx` / `ProvidersPage.tsx` / `PermissionsPage.tsx` / `RulesEditor.tsx` / `SkillsPage.tsx`）已通过 `http.ts:155-182` 的 envelope unwrap 自动处理 `ApiResponse` 信封，字段名一致即可。

## 决策（用户已确认）

1. **响应包装**：8000 v1 router 继续用 `ApiResponse` 信封 `{code, data, trace_id}`，`http.ts` 现有解包逻辑直接复用，页面代码**零改动**。
2. **迁移策略**：并行运行 + 环境变量逐步切换（每个端点独立迁移、可逐个回退）。
3. **CLAUDE.md 同步**：迁移完成后修正路径不一致 + 增加 ADR。

## 阶段总览

| # | 阶段 | 工期 | 状态 |
|---|---|---|---|
| 0 | 现状冻结（只读取，生成 shape snapshot）| 0.5 天 | 📋 待执行 |
| 1 | 8000 端补齐 4 个新 v1 router（rules/providers/permissions/tools） | 1-2 天 | 📋 待执行 |
| 2 | 扩展 3 个现有 v1 router（mcp/skills/agents 补全 CRUD） | 1-2 天 | 📋 待执行 |
| 3 | 前端 hooks 路径逐步切换（25 个 hook） | 1-2 天 | 📋 待执行 |
| 4 | 关闭 9876（启动脚本 / vite proxy / 文件清理） | 0.5 天 | 📋 待执行 |
| 5 | 同步文档（CLAUDE.md + ADR-0001/0002） | 0.5 天 | 📋 待执行 |

## 各阶段详细计划

- **[阶段 0：现状冻结](./stage-0-snapshot.md)** — 抓取 25 个端点的精确字段对标
- **[阶段 1：4 个新 v1 router](./stage-1-new-routers.md)** — rules / providers / permissions / tools
- **[阶段 2：扩展 3 个 v1 router](./stage-2-extend-routers.md)** — mcp / skills / agents
- **[阶段 3：前端 25 个 hook 切换](./stage-3-frontend-migration.md)** — 环境变量驱动逐步切换
- **[阶段 4：关闭 9876](./stage-4-shutdown-9876.md)** — 启动脚本 / proxy / 文件清理
- **[阶段 5：同步文档](./stage-5-docs.md)** — CLAUDE.md + ADR-0001/0002

## 风险与回退（总览）

| 阶段 | 主要风险 | 回退方案 |
|---|---|---|
| 1 | 8000 router 响应 shape 与 9876 不一致 | 双源 curl 对比，shape 不一致则修复 8000 router 直至一致 |
| 2 | 路径冲突（mcp/skills/agents 已有端点扩展时命名冲突）| 阶段 2 实施前先 grep 现有端点清单，确认无冲突后再添加 |
| 3 | 单端点切换出问题 | `VITE_USE_LEGACY_OPENCODE_PROXY=true` 一键回退 9876 |
| 4 | 关闭 9876 后遗漏调用 | 阶段 3 切换时记录 `@migrated` 注释清单，阶段 4 前 grep 兜底无遗漏 |
| 5 | 文档遗漏 ADR 引用 | 阶段 5 完成后让一个未参与实施的同事过一遍 CLAUDE.md |

## 预期收益

- 单一后端入口，单一 CORS 配置，单一启动编排
- 前端 baseURL 单一来源（消除散落）
- e2e 测试不需改（3 个 spec 不直接调 9876）
- 消除 vite proxy 顺序耦合（不再需要 bypass 函数）
- 字段一致性由 `ApiResponse` 信封统一保证
- 减少约 10 个 TypeScript 文件维护成本（`src/webui/server/`）
- CLAUDE.md + ADR 给下个开发者清晰的架构上下文

## 关键文件总览

**新建**：
- `src/main/api/v1/rules.py`
- `src/main/api/v1/providers.py`
- `src/main/api/v1/permissions.py`
- `src/main/api/v1/tools.py`
- `docs/refactor-decisions/9876-shape-snapshot.md`
- `docs/adr/0001-single-backend.md`
- `docs/adr/0002-response-envelope.md`

**修改**：
- `src/main/api/v1/mcp.py`（扩展 5 个端点）
- `src/main/api/v1/skills.py`（扩展 5 个端点）
- `src/main/api/v1/agents.py`（扩展 2 个端点）
- `src/main/api/app.py`（include 新 router）
- `src/webui/src/hooks/useOpencode.ts`（25 处路径切换 + 阶段 4 删除注释）
- `src/webui/src/api/opencode.ts`（baseURL 切换逻辑 + 阶段 4 删除分支）
- `src/webui/src/config/env.ts`（阶段 4 单一化）
- `src/webui/vite.config.ts`（阶段 4 删除 `/api` 规则）
- `config/start.bat`、`config/start.ps1`、`config/stop.bat`（删除 9876 引用）
- `CLAUDE.md`（路径修正 + 端口说明）

**删除**（阶段 4）：
- `src/webui/server/*.ts`（10 个文件）
- `src/webui/server/package.json`
- `src/webui/server/node_modules/`

## 如何使用本计划

1. **逐个阶段 review**：每个阶段是独立 md 文件，可单独 review/批准/执行
2. **按顺序执行**：阶段 0 → 1 → 2 → 3 → 4 → 5
3. **阶段间检查点**：每个阶段完成后做"完成判定"，确保下游阶段有稳定输入
4. **紧急回退**：阶段 3 内任何 hook 切换出问题，用 `VITE_USE_LEGACY_OPENCODE_PROXY=true` 回退 9876

## 参考

- 完整计划书（旧版）：`C:\Users\16957\.claude\plans\staged-purring-tower.md`（已批准）
- 实施前事实核对（2026-06-20）：见子代理调研报告（已归档）
- 子代理架构盘点报告（2026-06-20）：见子代理调研报告（已归档）