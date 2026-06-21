# 阶段 2：8000 端扩展 3 个现有 v1 router

## 目标

在 8000 FastAPI 端扩展 `mcp.py` / `skills.py` / `agents.py` 三个现有 v1 router，补全 CRUD 端点，与 9876 Express 字段对齐。此阶段**不**触碰前端 hooks，**不**关闭 9876。

## Context

8000 现有 3 个 v1 router 已实现了 list/查询端点（mcp 的 tools/servers/allowed-tools、skills 的 count/list、agents 的 list/detail），但缺 CRUD（PUT/DELETE/toggle/move/batch-model）。本阶段把这些 CRUD 端点补齐，让前端 hook 可以从 9876 切到 8000 而不丢功能。

## 必做事项

### 2.1 扩展 `src/main/api/v1/mcp.py`

新增 5 个端点：

```python
@router.get("")                      # list mcp servers (dict)
@router.put("/{name}")               # upsert mcp server
@router.delete("/{name}")            # delete
@router.post("/{name}/toggle")       # toggle enabled
@router.post("/{name}/move")         # move between global/project
```

注意：
- **路径冲突检查**：现有端点 `GET /tools`、`GET /servers`、`GET /agents/{name}/allowed-tools`（已在 `mcp.py` 中）。新端点 `GET ""`、`PUT /{name}` 等不冲突——前缀都是 `/api/v1/mcp` 但子路径不同
- 内部逻辑从 `src/webui/server/mcp.ts:42-131` 移植
- 响应 `data.mcp` 字典对齐 `MCPServersPage.tsx:53, 60`
- snapshot 阶段 0 给出精确字段

### 2.2 扩展 `src/main/api/v1/skills.py`

新增 5 个端点（GET `""` 和 GET `/count` 已存在）：

```python
# 已存在（校验 shape 对齐 Express）：
# @router.get("/count") → 返回 {count, scope} envelope
# @router.get("")       → 返回 {skills: [...]} envelope，data.skills 字段必须存在

# 新增：
@router.get("/{name}/content")       # 读 skill SKILL.md
@router.put("/{name}/content")       # 写 skill SKILL.md
@router.post("/{name}/toggle")       # toggle disabled
@router.post("/{name}/move")         # move between global/project
@router.delete("/{name}")            # delete
```

- 内部逻辑从 `src/webui/server/skills.ts:192-457` 移植
- 响应 `data.skills` 数组对齐 `SkillsPage.tsx:73, 86`
- 注意：`useOpencodeSkills` 调用 `/skills?scope=...` 时 `data.skills` 字段必须存在
- scope 参数处理：参考 `webui/server/skills.ts` 的 query string `?scope=global|project`

### 2.3 扩展 `src/main/api/v1/agents.py`

新增端点（GET `""` 和 GET `/{name}` 已存在，是 agent definition 管理）：

```python
# 已存在（业务端点，agent definition 管理，保留）：
# @router.get("")       → list agents
# @router.get("/{name}") → get agent definition

# 新增（opencode 配置相关，与上面语义独立）：
@router.get("/models")               # useOpencodeAgentModels
@router.post("/batch-model")         # useBatchSetOpencodeAgentModel
```

**重要：路径顺序**
- `GET /models` 必须在 `GET /{name}` **之前**注册——否则 `models` 会被 `/{name}` 路径参数吞掉
- `POST /batch-model` 在 `POST /{name}/...` 之前（如有）

- 内部逻辑从 `src/webui/server/agents.ts:82-287` 移植
- 注意：`/models` 和 `/batch-model` 是 opencode 配置相关（与 `/{name}` 的 agent definition 业务不同），前缀一致但语义独立

### 2.4 路由器内端点声明顺序原则

FastAPI 按装饰器声明顺序匹配路径。**更具体的路径必须先于通配路径**：

```python
# ✅ 正确
@router.get("/models")               # 静态
@router.get("/{name}")               # 通配

# ❌ 错误：/{name} 会吞掉 /models
@router.get("/{name}")
@router.get("/models")
```

## 完成判定

### 自动化 curl 验证

每个新端点必须返回 200 且 `data` shape 与 9876 一致：

```bash
# MCP
curl -s http://localhost:8000/api/v1/mcp | jq '.data | keys'  # 期望 ["mcp"]
curl -s http://localhost:9876/api/mcp/ | jq 'keys'

# Skills list（已有，校验 shape）
curl -s "http://localhost:8000/api/v1/skills?scope=project" | jq '.data | keys'
curl -s "http://localhost:9876/api/skills/?scope=project" | jq 'keys'

# Agent models
curl -s http://localhost:8000/api/v1/agents/models | jq '.data | keys'
curl -s http://localhost:9876/api/agents/models | jq 'keys'
```

### 完成 checklist

- [ ] `mcp.py` 扩展 5 个端点全部 200
- [ ] `skills.py` 扩展 5 个端点全部 200（含 GET `""` shape 校验）
- [ ] `agents.py` 扩展 2 个端点全部 200
- [ ] 路由顺序：`/models` 在 `/{name}` 前
- [ ] `data` 字段与 9876 端 curl 对比完全一致
- [ ] Python 端启动日志无路由冲突警告
- [ ] 现有业务端点（mcp/tools/servers、agents/list/detail、skills/count）未被破坏

## 风险与回退

| 风险 | 回退 |
|---|---|
| 路由顺序冲突（`/models` 被 `/{name}` 吞掉） | 调整装饰器顺序；先 grep 现有 router 内 `@router.` 声明顺序 |
| 现有业务端点被破坏（mcp/tools、agents/list） | 实施前 Read 现有 router 全文记录基线端点清单；扩展后逐个 curl 现有端点回归 |
| `data.skills` 字段缺失导致前端 hook 报错 | snapshot 校验；如 TS 端是 `{skills: []}` 形状，Python 端必须返回相同形状 |
| skill move / mcp move 跨 scope 逻辑复杂 | 直接移植 TS 端实现；如 Python 端没有对应工具函数，新建私有 helper |

## 关键文件清单

**修改**：
- `D:\github_place\fin-agent\project\src\main\api\v1\mcp.py`（扩展 5 个端点）
- `D:\github_place\fin-agent\project\src\main\api\v1\skills.py`（扩展 5 个端点）
- `D:\github_place\fin-agent\project\src\main\api\v1\agents.py`（扩展 2 个端点）

**参考**（移植逻辑来源）：
- `D:\github_place\fin-agent\project\src\webui\server\mcp.ts`
- `D:\github_place\fin-agent\project\src\webui\server\skills.ts`
- `D:\github_place\fin-agent\project\src\webui\server\agents.ts`（仅 `/models` 和 `/batch-model` 部分，行 164-223）

**保留不动**：
- `mcp.py` 的 `/tools`、`/servers`、`/agents/{name}/allowed-tools` 端点
- `agents.py` 的 list 和 `/{name}` detail 端点
- `skills.py` 的 `/count` 端点

## 关联阶段

- **前置**：阶段 0（snapshot）、阶段 1（4 个新 router）
- **后续**：阶段 3（前端 hooks 切换路径）—— 此时 8000 端所有 25 个端点可用，前端可逐步迁移
- **最终用户可见**：阶段 3 + 阶段 4（关闭 9876）