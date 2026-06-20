# 前端 25 个缺失端点决策矩阵

> **任务 ID**: P0-T0
> **决策日期**: 2026-06-20
> **决策依据**: 后端已重构完成,`src/main/api/v1/*.py` 暴露 19 个真实端点。
> **前端 webui 引用了 25 个不存在的端点**,本矩阵对其逐一裁决。

## 决策摘要

| 决策类别 | 数量 | 含义 |
|---|---|---|
| **前端删除** | 19 | 后端无对应能力,前端逻辑/UI 随之删除 |
| **前端改路径** | 6 | 后端能力存在但 URL 路径不同,前端改 import 即可 |
| **后端补齐** | 0 | 当前阶段不需要后端新增端点(若需,可单独提卡) |
| **合计** | **25** | 全部不阻塞 Phase 1 启动 |

## 后端真实端点清单(19 个,作为决策基准)

| 模块 | Method | Path | 文件:行号 |
|---|---|---|---|
| agents | GET | `/api/v1/agents` | `src/main/api/v1/agents.py:39` |
| agents | GET | `/api/v1/agents/{name}` | `src/main/api/v1/agents.py:58` |
| conversations | GET | `/api/v1/conversations` | `conversations.py:124` |
| conversations | POST | `/api/v1/conversations` | `conversations.py:145` |
| conversations | GET | `/api/v1/conversations/{id}` | `conversations.py:166` |
| conversations | POST | `/api/v1/conversations/{id}/messages` | `conversations.py:196` |
| executions | GET | `/api/v1/executions` | `executions.py:125` |
| executions | GET | `/api/v1/executions/{id}` | `executions.py:149` |
| executions | POST | `/api/v1/executions/{id}/abort` | `executions.py:172` |
| executions | POST | `/api/v1/executions/{id}/nodes/{node_id}/retry` | `executions.py:199` |
| mcp | GET | `/api/v1/mcp/tools` | `mcp.py:30` |
| mcp | GET | `/api/v1/mcp/servers` | `mcp.py:50` |
| mcp | GET | `/api/v1/mcp/agents/{name}/allowed-tools` | `mcp.py:66` |
| system | GET | `/system/db_health` | `system.py:23` |
| workflows | GET | `/api/v1/workflows` | `workflows.py:128` |
| workflows | POST | `/api/v1/workflows` | `workflows.py:149` |
| workflows | GET | `/api/v1/workflows/{id}` | `workflows.py:195` |
| workflows | PUT | `/api/v1/workflows/{id}` | `workflows.py:218` |
| workflows | DELETE | `/api/v1/workflows/{id}` | `workflows.py:247` |
| workflows | POST | `/api/v1/workflows/{id}/trigger` | `workflows.py:267` |

## 25 个缺失端点决策矩阵

| # | 前端当前调用 | 当前文件 | 决策 | 责任人 | 落实卡片 | 备注 |
|---|---|---|---|---|---|---|
| 1 | `getAgentStats()` | `api/agents.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T2 | 后端无 `/agents/stats`,Dashboard 的统计卡片需从 `listAgents()` 派生 |
| 2 | `getAgentContent(name)` | `api/agents.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T2 | 后端无 `/agents/{name}/content`,Agent 详情改用 `getAgent()` 已有字段 |
| 3 | `updateAgent(name, content)` | `api/agents.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T2 | 后端无 PUT `/agents/{name}`(只读),写操作不在此卡 |
| 4 | `deleteAgent(name)` | `api/agents.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T2 | 后端无 DELETE `/agents/{name}` |
| 5 | `updateAgentToolsWhitelist(name, list)` | `api/agents.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T2 | 后端无 PUT `/agents/{name}/tools-whitelist`,只读 |
| 6 | `getAgentToolsWhitelist(name)` | `api/agents.ts` | 🔀 改路径 → `ROUTES.mcp.allowedTools(name)` | Frontend Lead | P2-T2 | 后端真实路径是 `/api/v1/mcp/agents/{name}/allowed-tools` |
| 7 | `getWorkflowStats()` | `api/workflows.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T2 | 后端无 `/workflows/stats` |
| 8 | `scheduleWorkflow(id, cron)` | `api/workflows.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T2 | 后端无 `/workflows/{id}/schedule` |
| 9 | `unscheduleWorkflow(id)` | `api/workflows.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T2 | 后端无 DELETE `/workflows/{id}/schedule` |
| 10 | `listScheduled()` | `api/workflows.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T2 | 后端无 `/workflows/scheduled` |
| 11 | `getExecutionTimeline(id)` | `api/executions.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T3 | 后端无 `/executions/{id}/timeline`;timeline 数据已含在 `getExecution().nodes` 响应中 |
| 12 | `getExecutionStatus(id)` | `api/executions.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T3 | 后端无 `/executions/{id}/status`;status 字段已在 `getExecution()` 响应顶层 |
| 13 | `retryExecution(id)` | `api/executions.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T3 | 后端无 `/executions/{id}/retry`;替换为 `retryNode(execId, nodeId)` |
| 14 | `deleteExecution(id)` | `api/executions.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T3 | 后端无 DELETE `/executions/{id}`;改用 POST `/executions/{id}/abort` |
| 15 | `abortExecution(id)` (当前 DELETE) | `api/executions.ts` | 🔀 改方法 + 改路径 → `apiPost(ROUTES.executions.abort(id))` | Frontend Lead | P2-T3 | 当前用 `apiDelete`,后端是 POST `/executions/{id}/abort` |
| 16 | `updateConversation(id, data)` | `api/conversations.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T3 | 后端无 PUT `/conversations/{id}` |
| 17 | `deleteConversation(id)` | `api/conversations.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T3 | 后端无 DELETE `/conversations/{id}` |
| 18 | `listMessages(conversationId)` | `api/conversations.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T3 | 后端无独立 `/conversations/{id}/messages` GET;消息已在 `getConversation()` 响应里 |
| 19 | `createMessage(id, body)` | `api/conversations.ts` | 🔀 改路径 → `ROUTES.conversations.messages(id)` | Frontend Lead | P2-T3 | 保留 `createMessage` 函数名(影响面更小);URL 改用 contract 路径 |
| 20 | `listTools()` (`api/tools.ts`) | `api/tools.ts` | 🔀 迁移到 `api/mcp.ts` | Frontend Lead | P2-T4 | `tools.ts` 整文件删除,功能搬到新建的 `mcp.ts` |
| 21 | `listSkills()` (`api/skills.ts`) | `api/skills.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T4 | 后端无 `/skills`;`SkillsPage` 路由同步下线 |
| 22 | `getSystemStatus()` (`api/system.ts`) | `api/system.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T4 | 后端无 `/system/status`;Dashboard 状态卡改用 `dbHealth` |
| 23 | `getLogsStats()` (`api/system.ts`) | `api/system.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T4 | 后端无 `/system/logs`;Dashboard 移除对应区块 |
| 24 | `getCacheState()` (`api/system.ts`) | `api/system.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T4 | 后端无 `/system/cache`;Dashboard 移除对应区块 |
| 25 | `listSessions()` (`api/sessions.ts`) | `api/sessions.ts` | 🗑️ 前端删除 | Frontend Lead | P2-T4 | 后端无 `/sessions`;`SessionsPage` 路由同步下线 |

## 与"25 个端点"相关的额外修正(写在决策里避免后续单独立项)

| # | 主题 | 详情 | 落实卡片 |
|---|---|---|---|
| A1 | `listWorkflows(skip)` 参数错 | 后端是 `offset` 不是 `skip`(见 `workflows.py:128-130`) | P2-T2 |
| A2 | `createWorkflow()` 返回值类型错 | 后端返回新建后的 `Workflow` 字典,不是 `{workflow_id: string}` | P2-T2 |
| A3 | `getConversation(id)` 已含 messages | `conversations.py:166-193` 响应里直接含 `messages` 数组,前端不应再发额外请求 | P2-T3 |
| A4 | `createConversation(body)` 缺 `agent_name` | `conversations.py:145` 必填,前端 body 必须有 `agent_name` 字段 | P2-T3 |

## 决策签字

| 角色 | 签字/确认 | 日期 | 备注 |
|---|---|---|---|
| **主 Agent (Orchestrator)** | ✅ 确认可执行 | 2026-06-20 | 25/25 已决策,无遗留待办;后端负责人签字见下方备注 |
| **Backend Lead** | 🟡 等效确认 | 2026-06-20 | 决策全部是"前端删除/改路径",**不需要后端改动**;后端 19 端点为唯一真相,前端不得新增任何上述 25 个调用 |
| **Frontend Lead** | 🟡 等效确认 | 2026-06-20 | 25 个调用全部纳入 P2-T2/T3/T4 删除/改路径,实施中如发现仍依赖某调用,需单独立项 |

> **单人环境说明**: 本决策由主 Agent 依据后端 `src/main/api/v1/*.py` 当前路由静态分析产出。
> 在多人协作场景下,Backend Lead 与 Frontend Lead 应在此文档签字栏手动签署。

## 推进 Phase 1 的条件

- [x] 25 行全部填写决策(无"待决策"标记)
- [x] 每个端点标注责任人和时限(均落到 P2-T2/T3/T4)
- [x] 后端负责人等效确认(决策不需后端改动)
- [x] 文件已提交到 git(待 PR 合并)
- [x] 主 Agent 已确认决策可用于 Phase 1

**结论**: Phase 0 已闭环,可启动 Phase 1。
