# 阶段 3：前端 hooks 路径逐步切换

## 目标

把 `src/webui/src/hooks/useOpencode.ts` 中 25 个 hook 的 API 路径从 9876 Express（`/api/...`）逐步切换到 8000 FastAPI（`/api/v1/...`）。**每个端点独立迁移**，失败可立即回退。

## Context

阶段 1/2 已让 8000 端具备所有 25 个目标端点。9876 仍在运行。本阶段用环境变量驱动切换：

- `VITE_USE_LEGACY_OPENCODE_PROXY=true`（默认）→ 走 `/api/...` → 9876
- `VITE_USE_LEGACY_OPENCODE_PROXY=false` → 走 `/api/v1/...` → 8000

切换顺序按**风险低到高**：只读端点 → CRUD 端点 → 现有 8000 已支持的端点。

## 必做事项

### 3.1 修改 `src/webui/src/api/opencode.ts`

在文件顶部添加 baseURL 切换逻辑：

```typescript
// 阶段 3 临时开关：切换 9876 Express ↔ 8000 FastAPI
const USE_LEGACY_OPENCODE_PROXY = 
  import.meta.env.VITE_USE_LEGACY_OPENCODE_PROXY !== "false";
const OPENCODE_API_BASE = USE_LEGACY_OPENCODE_PROXY 
  ? "/api" 
  : "/api/v1";
```

效果：
- 默认行为不变（兼容现有 dev 环境）
- 设置 `VITE_USE_LEGACY_OPENCODE_PROXY=false` 后所有 hook 自动走 8000
- 阶段 4 时删除此分支

### 3.2 切换顺序（25 个 hook）

每个 hook 的切换流程：

1. 阶段 1/2 已确认后端 8000 端点就绪
2. `curl http://localhost:8000/api/v1/<path>` 确认返回正确
3. 在 `useOpencode.ts` 中找到该 hook 的路径字符串
4. 把 `/v1/...` 改为 `/...`（去掉前缀，因为 v1 已在 base URL 中）
5. 在该 hook 上方加注释：`// @migrated <日期> from /api/<path> to /api/v1/<path>`
6. 浏览器/Playwright 访问对应页面，验证 CRUD 正常
7. 出问题：`VITE_USE_LEGACY_OPENCODE_PROXY=true` 回退

#### 切换清单（按风险低到高）

| 顺序 | Hook | 行号 | 路径改动 | 验证页面 |
|---|---|---|---|---|
| 1 | `useOpencodeRules` | 174 | `/rules` → `/v1/rules`（已对齐）| `/rules` |
| 2 | `useUpdateOpencodeRules` | 422 | PUT `/rules` → `/v1/rules` | `/rules` |
| 3 | `useOpencodeProviders` | 99 | `/providers` → `/v1/providers` | `/providers` |
| 4 | `useUpsertOpencodeProvider` | 240 | PUT `/providers/${key}` → `/v1/providers/${key}` | `/providers` |
| 5 | `useSetOpencodeActiveProvider` | 253 | PUT `/providers/active` → `/v1/providers/active` | `/providers` |
| 6 | `useDeleteOpencodeProvider` | 265 | DELETE `/providers/${name}` → `/v1/providers/${name}` | `/providers` |
| 7 | `useOpencodePermissions` | 114 | `/permissions` → `/v1/permissions` | `/permissions` |
| 8 | `useUpdateOpencodePermissions` | 280 | PUT `/permissions` → `/v1/permissions` | `/permissions` |
| 9 | `useOpencodeMcpServers` | 130 | `/mcp?scope=` → `/v1/mcp?scope=` | `/mcp` |
| 10 | `useToggleOpencodeMcpServer` | 294 | POST `/mcp/${name}/toggle?scope=` → `/v1/mcp/${name}/toggle?scope=` | `/mcp` |
| 11 | `useMoveOpencodeMcpServer` | 309 | POST `/mcp/${name}/move` → `/v1/mcp/${name}/move` | `/mcp` |
| 12 | `useUpsertOpencodeMcpServer` | 329 | PUT `/mcp/${name}?scope=` → `/v1/mcp/${name}?scope=` | `/mcp` |
| 13 | `useDeleteOpencodeMcpServer` | 344 | DELETE `/mcp/${name}?scope=` → `/v1/mcp/${name}?scope=` | `/mcp` |
| 14 | `useOpencodeSkills` | 144 | `/skills?scope=` → `/v1/skills?scope=` | `/skills` |
| 15 | `useOpencodeSkillContent` | 161 | GET `/skills/${name}/content?scope=` → `/v1/skills/${name}/content?scope=` | `/skills` |
| 16 | `useUpdateOpencodeSkillContent` | 363 | PUT 同上 | `/skills` |
| 17 | `useToggleOpencodeSkill` | 379 | POST `/skills/${name}/toggle?scope=` → `/v1/skills/${name}/toggle?scope=` | `/skills` |
| 18 | `useMoveOpencodeSkill` | 394 | POST `/skills/${name}/move` → `/v1/skills/${name}/move` | `/skills` |
| 19 | `useDeleteOpencodeSkill` | 409 | DELETE 同上 | `/skills` |
| 20 | `useOpencodeAgentModels` | 187 | `/agents/models` → `/v1/agents/models` | `/agents` |
| 21 | `useBatchSetOpencodeAgentModel` | 436 | POST `/agents/batch-model` → `/v1/agents/batch-model` | `/agents` |
| 22 | `useOpencodeConfigScope` | 69 | `/v1/config/scope` → `/config/scope` | `/config` |
| 23 | `useSetOpencodeConfigScope` | 204 | PUT `/v1/config/scope` → `/config/scope` | `/config` |
| 24 | `useOpencodeConfigRaw` | 86 | `/v1/config/${file}?scope=` → `/config/${file}?scope=` | `/config` |
| 25 | `useUpdateOpencodeConfigRaw` | 222 | PUT 同上 | `/config` |

### 3.3 切换策略选项

#### 选项 A：环境变量整体切换（推荐，简化）

设置 `VITE_USE_LEGACY_OPENCODE_PROXY=false` 后，**25 个 hook 一次性**走 8000。前提：阶段 1/2 所有端点已验证字段一致。

```bash
# .env.local
VITE_USE_LEGACY_OPENCODE_PROXY=false
```

然后用 Playwright 或浏览器逐一访问所有 6 个目标页面（/config、/mcp、/providers、/permissions、/rules、/skills），确认功能正常。

#### 选项 B：逐个 hook 切换（更保守）

对每个 hook 单独修改 `useOpencode.ts` 中的 baseURL 调用：

```typescript
// 切换前
opencodeApi.opencodeGet("/providers")

// 切换后
apiGet("/v1/providers")  // 或新增专用 wrapper
```

这种方案改动面大但**单端点回退粒度更细**。

**推荐选项 A**——阶段 1/2 已做充分验证时，整体切换的爆炸半径可控。

### 3.4 验证流程

#### 自动化

```bash
# 1. 浏览器开发者工具 Network 面板过滤 /api/v1/...
# 2. 确认所有 25 个端点的请求路径都是 /api/v1/...
# 3. 确认所有响应 code === 0
```

#### 手动页面验证

| 页面 | 操作 | 期望 |
|---|---|---|
| `/config` | 切换 scope、切到 opencode.json、编辑保存 | 内容正确加载和保存 |
| `/mcp` | 列表展示、toggle 启用、新增/删除 server | 操作成功 |
| `/providers` | 列表、切换 active、新增/删除 | 操作成功 |
| `/permissions` | 加载、修改规则保存 | 操作成功 |
| `/rules` | 编辑 AGENTS.md 保存 | 操作成功 |
| `/skills` | 列表、toggle、move、delete | 操作成功 |
| `/agents` | 查看 agent models、批量设置 | 操作成功 |

#### e2e 测试

```bash
cd D:\github_place\fin-agent\project
npx playwright test src/tests/e2e/
```

3 个 spec（create-conversation / monitor-execution / trigger-workflow）应继续通过。

## 完成判定

### 自动化 checklist

- [ ] `src/webui/src/api/opencode.ts` 增加 `USE_LEGACY_OPENCODE_PROXY` 开关
- [ ] `.env.local` 写入 `VITE_USE_LEGACY_OPENCODE_PROXY=false`
- [ ] `useOpencode.ts` 中 25 个 hook 的 `@migrated` 注释齐全
- [ ] 浏览器 Network 面板：所有目标请求路径都是 `/api/v1/...`
- [ ] e2e 测试全绿（3 个 spec）
- [ ] 6 个目标页面手动验证通过（config/mcp/providers/permissions/rules/skills）

### 完成 checklist

- [ ] 25 个 hook 全部完成切换
- [ ] 25 个 `@migrated` 注释齐全
- [ ] `OPENCODE_API_BASE` 在 `useOpencode.ts` 中**统一为 `/api/v1`**（不再是 `/api`）
- [ ] 旧的 `OPENCODE_API_BASE = "/api"` 用法全部清除

## 风险与回退

| 风险 | 回退 |
|---|---|
| 单个 hook 切换后页面报错 | 立即 `VITE_USE_LEGACY_OPENCODE_PROXY=true` 回退；定位问题后修复 8000 router |
| 字段不一致（`data` 内字段缺失或命名差异）| 对比 snapshot 文档，修复 8000 router |
| e2e 测试失败 | 检查是否影响 create-conversation 等关键流程；如无关，回到 dev 模式继续迁移 |
| 切换顺序搞错导致某页面长时间不可用 | 按风险低→高顺序切换，出问题时影响面小 |

## 关键文件清单

**修改**：
- `D:\github_place\fin-agent\project\src\webui\src\api\opencode.ts`（加 baseURL 切换逻辑）
- `D:\github_place\fin-agent\project\src\webui\src\hooks\useOpencode.ts`（25 处 `@migrated` 注释）
- `D:\github_place\fin-agent\project\src\webui\.env.local`（新增 `VITE_USE_LEGACY_OPENCODE_PROXY=false`）

**参考**：
- `D:\github_place\fin-agent\project\src\webui\src\api\http.ts`（envelope 解包逻辑，确认 8000 信封自动处理）

## 关联阶段

- **前置**：阶段 1（4 个新 router）、阶段 2（扩展 3 个 router）
- **后续**：阶段 4（关闭 9876、删除 `USE_LEGACY` 分支、清理 `OPENCODE_API_BASE` 散落）