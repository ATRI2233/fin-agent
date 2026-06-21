# 9876 Express 响应形状快照

> 生成日期: 2026-06-20
> 用途: 阶段 1/2 8000 v1 router 字段对标依据

## 信封约定

8000 FastAPI 所有 v1 端点用 ApiResponse 信封包装：
{"code": 0, "message": "ok", "data": <业务字段>, "trace_id": "..."}

- code: number, 成功值为 0
- message: string, 成功时通常为 "ok"
- data: 业务载荷，类型由各端点定义
- trace_id: string, 来自 current_trace_id()

前端 http.ts:155-182 自动解包：当 code === 0 时返回 data，否则抛 ApiError。
所以 8000 router 的 data 内容必须逐字段匹配原 Express 裸响应。

## 4096 依赖核对结论

在 src/main/api/v1/ 下 grep `@opencode-ai`、`createOpencodeClient`、`child_process`、`spawn` 均 0 命中。
8000 v1 不需要调 4096，所有 25 个迁移端点都是配置文件读写。

## 端点 Shape 列表（25个）

### 1. Config（8个端点）

#### GET /api/config/opencode
- 原始路径: `src/main/api/v1/config.ts:11-19`
- 8000 路径: `GET /api/v1/config/opencode`
- 响应（裸）: 动态字段（`opencode.json` 内容）+ `_meta.source: string`
- 内部: `readConfigFile('opencode.json', PROJECT_ROOT)` 自动发现 `global→project`
- 前端 Hook: `useOpencodeConfigRaw`（`useOpencode.ts:78`）

#### PUT /api/config/opencode
- 原始路径: `src/main/api/v1/config.ts:22-32`
- 8000 路径: `PUT /api/v1/config/opencode`
- 请求 Body: `Record<string, unknown>`
- 响应（裸）: `{ success: boolean, path: string, source: string }`
- 内部: 先读定位发现位置，再 `writeConfigFile` 写回
- 前端 Hook: `useUpdateOpencodeConfigRaw`（`useOpencode.ts:213`）

#### GET /api/config/opencode/project
- 原始路径: `src/main/api/v1/config.ts:35-44`
- 8000 路径: `GET /api/v1/config/opencode/project`
- 响应（裸）: 项目级 `opencode.json` 内容（JSON 对象）
- 内部: 强制读 `PROJECT_ROOT/.opencode/opencode.json`
- 前端 Hook: `useOpencodeConfigRaw`（`useOpencode.ts:78`）

#### PUT /api/config/opencode/project
- 原始路径: `src/main/api/v1/config.ts:47-57`
- 8000 路径: `PUT /api/v1/config/opencode/project`
- 请求 Body: `Record<string, unknown>`
- 响应（裸）: `{ success: boolean, path: string }`
- 内部: 强制写入 `PROJECT_ROOT/.opencode/opencode.json`
- 前端 Hook: `useUpdateOpencodeConfigRaw`（`useOpencode.ts:213`）

#### GET /api/config/oh-my-openagent
- 原始路径: `src/main/api/v1/config.ts:60-68`
- 8000 路径: `GET /api/v1/config/oh-my-openagent`
- 响应（裸）: 动态字段 + `_meta.source`
- 内部: `readConfigFile('oh-my-openagent.jsonc', PROJECT_ROOT)`
- 前端 Hook: `useOpencodeConfigRaw`（`useOpencode.ts:78`）

#### PUT /api/config/oh-my-openagent
- 原始路径: `src/main/api/v1/config.ts:71-81`
- 8000 路径: `PUT /api/v1/config/oh-my-openagent`
- 请求 Body: `Record<string, unknown>`
- 响应（裸）: `{ success: boolean, path: string, source: string }`
- 前端 Hook: `useUpdateOpencodeConfigRaw`（`useOpencode.ts:213`）

#### GET /api/config/scope
- 原始路径: `src/main/api/v1/config.ts:84-92`
- 8000 路径: `GET /api/v1/config/scope`
- 响应（裸）: 动态字段（`.scope_prefs.json` 内容），不存在返回 `{}`
- 内部: 读 `PROJECT_ROOT/.opencode/.scope_prefs.json`
- 前端 Hook: `useOpencodeConfigScope`（`useOpencode.ts:64`）

#### PUT /api/config/scope
- 原始路径: `src/main/api/v1/config.ts:95-112`
- 8000 路径: `PUT /api/v1/config/scope`
- 请求 Body: `Record<string, unknown>`（与现有内容合并）
- 响应（裸）: `{ success: boolean }`
- 内部: 读现有内容，`{...existing, ...data}` 合并后写回
- 前端 Hook: `useSetOpencodeConfigScope`（`useOpencode.ts:200`）

### 2. Providers（5个端点）

#### GET /api/providers
- 原始路径: `src/main/api/v1/providers.ts:53-62`
- 8000 路径: `GET /api/v1/providers`
- 响应（裸）: `{ providers: Record<string, ProviderConfig>, active: { provider: string, model: string } }`
- 前端 Hook: `useOpencodeProviders`（`useOpencode.ts:95`）

#### PUT /api/providers/:name
- 原始路径: `src/main/api/v1/providers.ts:65-84`
- 8000 路径: `PUT /api/v1/providers/:name`
- 请求 Body: `ProviderConfig`
- 响应（裸）: `{ success: boolean, name: string, config: ProviderConfig }`
- 前端 Hook: `useUpsertOpencodeProvider`（`useOpencode.ts:233`）

#### DELETE /api/providers/:name
- 原始路径: `src/main/api/v1/providers.ts:87-112`
- 8000 路径: `DELETE /api/v1/providers/:name`
- 响应（裸）: `{ success: boolean, deleted: string }`
- 前端 Hook: `useDeleteOpencodeProvider`（`useOpencode.ts:261`）

#### GET /api/providers/active
- 原始路径: `src/main/api/v1/providers.ts:115-121`
- 8000 路径: `GET /api/v1/providers/active`
- 响应（裸）: `{ provider: string, model: string }`
- 前端 Hook: `useOpencodeProviders`（`useOpencode.ts:95`）

#### PUT /api/providers/active
- 原始路径: `src/main/api/v1/providers.ts:124-143`
- 8000 路径: `PUT /api/v1/providers/active`
- 请求 Body: `{ provider: string, model: string }`
- 响应（裸）: `{ success: boolean, provider: string, model: string }`
- 前端 Hook: `useSetOpencodeActiveProvider`（`useOpencode.ts:249`）

### 3. Permissions（2个端点）

#### GET /api/permissions
- 原始路径: `src/main/api/v1/permissions.ts:38-46`
- 8000 路径: `GET /api/v1/permissions`
- 响应（裸）: `{ rules: PermissionRule[], defaultAction: "allow" | "deny" }`
- 默认: `{ rules: [], defaultAction: 'allow' }`
- 前端 Hook: `useOpencodePermissions`（`useOpencode.ts:107`）

#### PUT /api/permissions
- 原始路径: `src/main/api/v1/permissions.ts:49-71`
- 8000 路径: `PUT /api/v1/permissions`
- 请求 Body: `PermissionsConfig`（完整对象）
- 响应（裸）: `{ success: boolean, permissions: PermissionsConfig }`
- 校验: `rules` 必须是数组，`defaultAction` 必须是 `allow` 或 `deny`
- 前端 Hook: `useUpdateOpencodePermissions`（`useOpencode.ts:274`）

### 4. Rules（2个端点）

#### GET /api/rules
- 原始路径: `src/main/api/v1/rules.ts:12-24`
- 8000 路径: `GET /api/v1/rules`
- 响应（裸）: `{ content: string }`（`AGENTS.md` 完整文本，不存在则为 `""`）
- 内部: 读 `PROJECT_ROOT/AGENTS.md`
- 前端 Hook: `useOpencodeRules`（`useOpencode.ts:170`）

#### PUT /api/rules
- 原始路径: `src/main/api/v1/rules.ts:27-40`
- 8000 路径: `PUT /api/v1/rules`
- 请求 Body: `{ content: string }`
- 响应（裸）: `{ success: boolean, path: string }`
- 内部: 写 `PROJECT_ROOT/AGENTS.md`
- 前端 Hook: `useUpdateOpencodeRules`（`useOpencode.ts:418`）

### 5. Tools（2个端点）

#### GET /api/tools
- 原始路径: `src/main/api/v1/tools.ts:34-42`
- 8000 路径: `GET /api/v1/tools`
- 响应（裸）: `Record<string, ToolConfig>`（`opencode.json` 的 `tools` 字段）
- 前端 Hook: `useOpencodeTools`（`useOpencode.ts` 确认）

#### PUT /api/tools/:name
- 原始路径: `src/main/api/v1/tools.ts:45-64`
- 8000 路径: `PUT /api/v1/tools/:name`
- 请求 Body: `ToolConfig`（完整或部分）
- 响应（裸）: `{ success: boolean, name: string, config: ToolConfig }`
- 内部: 读 `opencode.json`，合并 `tools[name]`，写回
- 前端 Hook: `useUpsertOpencodeTool`（`useOpencode.ts` 确认）

### 6. MCP（4个端点）

#### GET /api/mcp
- 原始路径: `src/main/api/v1/mcp.ts:42-50`
- 8000 路径: `GET /api/v1/mcp`
- 响应（裸）: `Record<string, McpServerConfig>`（裸字典）
- ⚠️ 注意：与其他端点不同，GET /api/mcp 直接返回字典而非嵌套在 `mcp` 字段中
- 前端 Hook: `useOpencodeMcpServers`（`useOpencode.ts:123`）

#### PUT /api/mcp/:name
- 原始路径: `src/main/api/v1/mcp.ts:53-72`
- 8000 路径: `PUT /api/v1/mcp/:name`
- 请求 Body: `McpServerConfig`
- 响应（裸）: `{ success: boolean, name: string, config: McpServerConfig }`
- 前端 Hook: `useUpsertOpencodeMcpServer`（`useOpencode.ts:320`）

#### DELETE /api/mcp/:name
- 原始路径: `src/main/api/v1/mcp.ts:75-100`
- 8000 路径: `DELETE /api/v1/mcp/:name`
- 响应（裸）: `{ success: boolean, deleted: string }`
- 前端 Hook: `useDeleteOpencodeMcpServer`（`useOpencode.ts:339`）

#### POST /api/mcp/:name/toggle
- 原始路径: `src/main/api/v1/mcp.ts:103-131`
- 8000 路径: `POST /api/v1/mcp/:name/toggle`
- 响应（裸）: `{ success: boolean, name: string, enabled: boolean }`
- 前端 Hook: `useToggleOpencodeMcpServer`（`useOpencode.ts:289`）

### 7. Skills（6个端点）

#### GET /api/skills
- 原始路径: `src/main/api/v1/skills.ts:192-201`
- 8000 路径: `GET /api/v1/skills?scope=global|project`
- 请求参数: `scope`（query，默认 `'project'`）
- 响应（裸）: `{ skills: SkillMeta[] }`
- 前端 Hook: `useOpencodeSkills`（`useOpencode.ts:139`）

#### GET /api/skills/:name/content
- 原始路径: `src/main/api/v1/skills.ts:204-222`
- 8000 路径: `GET /api/v1/skills/:name/content?scope=...`
- 响应（裸）: `{ name: string, content: string, description: string }`
- 前端 Hook: `useOpencodeSkillContent`（`useOpencode.ts:153`）

#### PUT /api/skills/:name/content
- 原始路径: `src/main/api/v1/skills.ts:225-275`
- 8000 路径: `PUT /api/v1/skills/:name/content?scope=...`
- 请求 Body: `{ content: string }`
- 响应（裸）: `{ success: boolean, name: string, path: string }`
- 前端 Hook: `useUpdateOpencodeSkillContent`（`useOpencode.ts:354`）

#### DELETE /api/skills/:name
- 原始路径: `src/main/api/v1/skills.ts:278-317`
- 8000 路径: `DELETE /api/v1/skills/:name?scope=...`
- 响应（裸）: `{ success: boolean, deleted: string }`
- ⚠️ 注意：只从配置中删除条目，不删除物理文件
- 前端 Hook: `useDeleteOpencodeSkill`（`useOpencode.ts:404`）

#### POST /api/skills/:name/toggle
- 原始路径: `src/main/api/v1/skills.ts:320-367`
- 8000 路径: `POST /api/v1/skills/:name/toggle?scope=...`
- 响应（裸）: `{ success: boolean, name: string, enabled: boolean }`
- 前端 Hook: `useToggleOpencodeSkill`（`useOpencode.ts:374`）

#### POST /api/skills/:name/move
- 原始路径: `src/main/api/v1/skills.ts:370-457`
- 8000 路径: `POST /api/v1/skills/:name/move`
- 请求 Body: `{ from: string }`（源 scope）
- 响应（裸）: `{ success: boolean, name: string, to: string }`
- ⚠️ 注意：只移动配置引用（path 不变），不移动物理文件
- 内部逻辑：
  - `from='global'` → 读 `opencode.json` 删条目 → 写入 project config
  - `from='project'` → 读 project config 删条目 → 写入 `opencode.json`
- 前端 Hook: `useMoveOpencodeSkill`（`useOpencode.ts:389`）

### 8. Agents（2个端点，迁移范围）

#### GET /api/agents/models
- 原始路径: `src/main/api/v1/agents.ts:164-186`
- 8000 路径: `GET /api/v1/agents/models`
- 响应（裸）: `{ models: Record<string, string> }`（键为 agent 名，值为 model 名）
- 前端 Hook: `useOpencodeAgentModels`（`useOpencode.ts:182`）

#### POST /api/agents/batch-model
- 原始路径: `src/main/api/v1/agents.ts:189-223`
- 8000 路径: `POST /api/v1/agents/batch-model`
- 请求 Body: `{ model: string }`
- 响应（裸）: `{ success: boolean, agentCount: number }`
- 前端 Hook: `useBatchSetOpencodeAgentModel`（`useOpencode.ts:431`）

## 25 个 Hook 清单

| # | Hook | 路径 | useOpencode.ts 行号 | 对应端点 |
|---|------|------|-------------------|---------|
| 1 | `useOpencodeConfigScope` | `GET /v1/config/scope` | 64 | GET /api/v1/config/scope |
| 2 | `useOpencodeConfigRaw` | `GET /v1/config/<file>?scope=...` | 78 | GET /api/v1/config/opencode 等 |
| 3 | `useOpencodeProviders` | `GET /providers` | 95 | GET /api/v1/providers, GET /api/v1/providers/active |
| 4 | `useOpencodePermissions` | `GET /permissions` | 107 | GET /api/v1/permissions |
| 5 | `useOpencodeMcpServers` | `GET /mcp?scope=...` | 123 | GET /api/v1/mcp |
| 6 | `useOpencodeSkills` | `GET /skills?scope=...` | 139 | GET /api/v1/skills |
| 7 | `useOpencodeSkillContent` | `GET /skills/<name>/content?scope=...` | 153 | GET /api/v1/skills/:name/content |
| 8 | `useOpencodeRules` | `GET /rules` | 170 | GET /api/v1/rules |
| 9 | `useOpencodeAgentModels` | `GET /agents/models` | 182 | GET /api/v1/agents/models |
| 10 | `useSetOpencodeConfigScope` | `PUT /v1/config/scope` | 200 | PUT /api/v1/config/scope |
| 11 | `useUpdateOpencodeConfigRaw` | `PUT /v1/config/<file>?scope=...` | 213 | PUT /api/v1/config/opencode 等 |
| 12 | `useUpsertOpencodeProvider` | `PUT /providers/<key>` | 233 | PUT /api/v1/providers/:name |
| 13 | `useSetOpencodeActiveProvider` | `PUT /providers/active` | 249 | PUT /api/v1/providers/active |
| 14 | `useDeleteOpencodeProvider` | `DELETE /providers/<name>` | 261 | DELETE /api/v1/providers/:name |
| 15 | `useUpdateOpencodePermissions` | `PUT /permissions` | 274 | PUT /api/v1/permissions |
| 16 | `useToggleOpencodeMcpServer` | `POST /mcp/<name>/toggle?scope=...` | 289 | POST /api/v1/mcp/:name/toggle |
| 17 | `useMoveOpencodeMcpServer` | `POST /mcp/<name>/move` | 304 | POST /api/v1/mcp/:name/move |
| 18 | `useUpsertOpencodeMcpServer` | `PUT /mcp/<name>?scope=...` | 320 | PUT /api/v1/mcp/:name |
| 19 | `useDeleteOpencodeMcpServer` | `DELETE /mcp/<name>?scope=...` | 339 | DELETE /api/v1/mcp/:name |
| 20 | `useUpdateOpencodeSkillContent` | `PUT /skills/<name>/content?scope=...` | 354 | PUT /api/v1/skills/:name/content |
| 21 | `useToggleOpencodeSkill` | `POST /skills/<name>/toggle?scope=...` | 374 | POST /api/v1/skills/:name/toggle |
| 22 | `useMoveOpencodeSkill` | `POST /skills/<name>/move` | 389 | POST /api/v1/skills/:name/move |
| 23 | `useDeleteOpencodeSkill` | `DELETE /skills/<name>?scope=...` | 404 | DELETE /api/v1/skills/:name |
| 24 | `useUpdateOpencodeRules` | `PUT /rules` | 418 | PUT /api/v1/rules |
| 25 | `useBatchSetOpencodeAgentModel` | `POST /agents/batch-model` | 431 | POST /api/v1/agents/batch-model |

---

## 关键数据结构 Shape

| 结构名 | 定义 |
|--------|------|
| **ToolConfig** | `{ name: string, description?: string, enabled: boolean, source: "builtin" \| "mcp" \| "custom", mcpServer?: string }` |
| **PermissionRule** | `{ tool: string, action: "allow" \| "deny", agents?: string[], description?: string }` |
| **PermissionsConfig** | `{ rules: PermissionRule[], defaultAction: "allow" \| "deny" }` |
| **ProviderConfig** | `{ name: string, npm: string, options?: Record<string, unknown>, models?: Record<string, { name: string }> }` |
| **McpServerConfig** | `{ type: string, command: string \| string[], args?: string[], enabled: boolean, description?: string, env?: Record<string, string>, tools?: McpToolConfig[] }` |
| **McpToolConfig** | `{ name: string, description: string, category?: string }` |
| **SkillMeta** | `{ name: string, description: string, filePath: string, enabled: boolean }` |

---

## 重要注意事项

1. **GET /api/v1/mcp 响应格式差异**：在 Express 中，GET /api/mcp 的响应直接是 `Record<string, McpServerConfig>` 字典，不是 `{ mcp: {...} }`。阶段 2 计划文档提到响应 `data.mcp` 字典对齐 `MCPServersPage.tsx:53,60`。这里存在差异：snapshot 应记录 Express 实际行为（裸字典）。8000 实现时，需确认前端是否通过 envelope 解包后直接使用 `data`（即 `data` 本身就是字典），还是期望 `data.mcp` 嵌套。建议阶段 1 开发时与前端确认。

2. **子代理 B 报告前端 Hook 补齐**：子代理 B 的报告中原缺少部分端点的前端访问点，已通过子代理 D 提供的 Hook 清单补齐。

3. **Skills DELETE 与 MOVE 行为**：`DELETE /api/v1/skills/:name` 和 `POST /api/v1/skills/:name/move` 均**只操作配置文件中的条目引用**，不实际删除或移动物理文件。8000 实现必须复刻此行为。

4. **Config scope 合并逻辑**：`PUT /api/v1/config/scope` 采用浅合并 `{...existing, ...data}`，不是全量替换。8000 实现需保持相同合并策略。

5. **Config 自动发现机制**：`GET /api/v1/config/opencode` 和 `GET /api/v1/config/oh-my-openagent` 通过 `readConfigFile` 自动发现文件位置（global → project），8000 需实现相同优先级逻辑。
