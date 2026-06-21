# 阶段 0：现状冻结 — 抓取 9876 shape snapshot

## 目标

把"已确认事实"落地为"实施前基线"，为阶段 1/2 的 8000 v1 router 实现提供**精确字段对标**。这是**只读取不写代码**的阶段。

## Context

fin-agent 当前 9876 Express 承担 35 个端点的 opencode 配置读写职责（已确认无 SDK 转发、无 CLI spawn）。要把这些端点等价迁移到 8000 FastAPI，**必须**精确知道每个端点的响应形状，否则迁移后字段不一致会导致前端 hook 取值错误。

本阶段产物：`docs/refactor-decisions/9876-shape-snapshot.md`，是阶段 1/2 的**单一可信源**。

## 必做事项

### 1. 抓取 9876 所有目标端点的响应形状

读取以下文件，记录**精确字段**：

**Config（8 个端点）**
- `D:\github_place\fin-agent\project\src\webui\server\config.ts`
  - `GET /api/config/opencode` → 读 `opencode.json`（global→project 合并）— 行 11-19
  - `PUT /api/config/opencode` → 写 `opencode.json` — 行 22-32
  - `GET /api/config/opencode/project` → 行 35-44
  - `PUT /api/config/opencode/project` → 行 47-57
  - `GET /api/config/oh-my-openagent` → 行 60-68
  - `PUT /api/config/oh-my-openagent` → 行 71-81
  - `GET /api/config/scope` → 行 84-92
  - `PUT /api/config/scope` → 行 95-112

**Providers（5 个端点）**
- `D:\github_place\fin-agent\project\src\webui\server\providers.ts`
  - `GET /api/providers/` → 行 53-62
  - `PUT /api/providers/:name` → 行 65-84
  - `DELETE /api/providers/:name` → 行 87-112
  - `GET /api/providers/active` → 行 115-121
  - `PUT /api/providers/active` → 行 124-143

**Permissions（2 个端点）**
- `D:\github_place\fin-agent\project\src\webui\server\permissions.ts`
  - `GET /api/permissions/` → 行 38-46
  - `PUT /api/permissions/` → 行 49-71

**Rules（2 个端点）**
- `D:\github_place\fin-agent\project\src\webui\server\rules.ts`
  - `GET /api/rules/` → 行 12-24
  - `PUT /api/rules/` → 行 27-40

**Tools（2 个端点）**
- `D:\github_place\fin-agent\project\src\webui\server\tools.ts`
  - `GET /api/tools/` → 行 34-42
  - `PUT /api/tools/:name` → 行 45-64

**MCP（4 个端点）**
- `D:\github_place\fin-agent\project\src\webui\server\mcp.ts`
  - `GET /api/mcp/` → 行 42-50
  - `PUT /api/mcp/:name` → 行 53-72
  - `DELETE /api/mcp/:name` → 行 75-100
  - `POST /api/mcp/:name/toggle` → 行 103-131

**Skills（6 个端点）**
- `D:\github_place\fin-agent\project\src\webui\server\skills.ts`
  - `GET /api/skills/` → 行 192-201
  - `GET /api/skills/:name/content` → 行 204-222
  - `PUT /api/skills/:name/content` → 行 225-275
  - `DELETE /api/skills/:name` → 行 278-317
  - `POST /api/skills/:name/toggle` → 行 320-367
  - `POST /api/skills/:name/move` → 行 370-457

**Agents（5 个端点，仅 `/models` 和 `/batch-model` 在迁移范围）**
- `D:\github_place\fin-agent\project\src\webui\server\agents.ts`
  - `GET /api/agents/models` → 行 164-186
  - `POST /api/agents/batch-model` → 行 189-223

### 2. 核对 8000 现有 ApiResponse 信封约定

读取：
- `D:\github_place\fin-agent\project\src\main\infra\errors.py` — ApiResponse 定义
- `D:\github_place\fin-agent\project\src\main\api\v1\config.py` — 信封使用样例

记录：
- 信封字段：`{code, message, data, trace_id}` 的类型与含义
- `code` 成功值（应为 0）
- `data` 是业务字段，TypeScript 解包后等价于原 Express 响应
- `trace_id` 来源

### 3. 核对 opencode serve 4096 与 8000 v1 的依赖关系

确认：**8000 v1 不需要调 4096**。所有 25 个迁移端点都是配置文件读写（读 `.opencode/`、`~/.config/opencode/`、写 `AGENTS.md` 等），不涉及 opencode SDK 调用。

证据：grep `@opencode-ai`、`createOpencodeClient`、`child_process`、`spawn` 在 `src/main/api/v1/` 下应 0 命中（除配置相关字符串如 `"opencode.json"`）。

## 产出文件

**`D:\github_place\fin-agent\project\docs\refactor-decisions\9876-shape-snapshot.md`**

文件结构（建议）：

```markdown
# 9876 Express 响应形状快照

> 生成日期: 2026-06-20
> 用途: 阶段 1/2 8000 v1 router 字段对标依据

## 信封约定

8000 FastAPI 所有 v1 端点用 ApiResponse 信封包装：
```json
{"code": 0, "message": "ok", "data": <业务字段>, "trace_id": "..."}
```

前端 http.ts:155-182 自动解包 `data`，所以 8000 router 的 `data` 内容必须**逐字段匹配**原 Express 裸响应。

## 端点 shape 列表

### GET /api/v1/rules
- Express: GET /api/rules → 行 12-24
- 业务字段:
  ```typescript
  { content: string, path: string }
  ```
- 前端访问: `RulesEditor.tsx:15` 取 `data.content`

### PUT /api/v1/rules
- Express: PUT /api/rules → 行 27-40
- 请求: `{ content: string }`
- 响应:
  ```typescript
  { success: true, path: string }
  ```

### GET /api/v1/providers
... （所有 25 个端点）
```

## 完成判定

- [ ] `docs/refactor-decisions/9876-shape-snapshot.md` 文件存在
- [ ] 25 个目标端点（config 4 个迁移范围 + providers 5 + permissions 2 + rules 2 + tools 2 + mcp 4 + skills 6 + agents 2）schema 条目齐全
- [ ] 每个 schema 条目包含：Express 源文件行号、HTTP 方法/路径、响应 TypeScript 类型、前端访问点（file:line）
- [ ] 信封约定段存在
- [ ] 4096 依赖关系核对结论写入文档

## 风险与回退

| 风险 | 回退 |
|---|---|
| 部分 9876 端点响应 shape 未读全 | 重读对应文件补全；如该端点本次不迁移，标记"skip" |
| 信封约定理解错误（code 不等于 0 等）| 重读 `infra/errors.py` 和 `config.py` 实现交叉验证 |
| 8000 真的需要调 4096 | 极少可能；若发现则在文档标红，阶段 1/2 实施时考虑异步调用 |

## 关联阶段

- **前置**：无（这是基线阶段）
- **后续**：阶段 1（用 snapshot 对齐 rules/providers/permissions/tools）、阶段 2（用 snapshot 对齐 mcp/skills/agents）