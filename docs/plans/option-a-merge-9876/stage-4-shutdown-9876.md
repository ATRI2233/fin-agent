# 阶段 4：关闭 9876 — 收尾期

## 目标

在前端全部切到 8000 后，关闭 9876 Express 服务，清理所有相关配置、代码、文件、依赖。最终只剩：
- 8000 FastAPI（业务后端 + opencode 配置读写）
- 4096 opencode CLI（独立进程，opencode SDK 服务）
- 5173 Vite dev server（前端 dev 模式）

## Context

阶段 3 已让前端所有 25 个 hook 通过 8000 工作。本阶段是收尾：移除 9876 进程编排、清理 vite proxy、删除 9876 文件、统一 baseURL。

**不可移除**：
- 4096 opencode CLI（独立进程，由 `start.ps1:72-86` 启动）
- 8000 v1 router（业务后端 + opencode 配置读写）
- 5 个目标页面文件（依赖 envelope 自动解包，零改动）

## 必做事项

### 4.1 启动脚本清理

#### `config/start.bat`（5 处删除）

| 行号 | 当前内容 | 改动 |
|---|---|---|
| 28 | `Write-Host ' Freeing ports 8000 / 9876 / 5173...'` | 改为 `Write-Host ' Freeing ports 8000 / 5173...'` |
| 30 | `call :kill_port 9876` | 删除整行 |
| 41 | `Write-Host ' Express Server (port 9876)...'` | 删除整行 |
| 47 | `call :wait_tcp 127.0.0.1 9876 30` | 删除整行 |
| 58 | `echo   Express Server: http://localhost:9876` | 删除整行 |

修改后 `start.bat` 启动序列应为 2 段（FastAPI + Vite），不再是 3 段。

#### `config/start.ps1`（3 处删除）

| 行号 | 当前内容 | 改动 |
|---|---|---|
| 100-106 | 整个 `[3/4] WebUI Server` 启动段（含 `Start-Process -FilePath "node"` 等）| 删除整块 |
| 123 | `Write-Host "  WebUI Server:       http://localhost:9876/api/health"` | 删除整行 |
| 138 | `@{ Name = "WebUI"; Url = "http://localhost:9876/api/health" }` | 删除整行 |

修改后 `start.ps1` 启动序列应为 3 段（FastAPI + opencode CLI + Vite），不再是 4 段。

**保留**：`start.ps1:72-86` 的 opencode CLI 启动（端口 4096）+ `start.ps1:121, 136` 的 opencode 健康检查。

#### `config/stop.bat`（1 处删除）

| 行号 | 当前内容 | 改动 |
|---|---|---|
| 13 | `for %%P in (8000 9876 5173) do (` | 改为 `for %%P in (8000 5173) do (` |

### 4.2 vite.config.ts 清理

**`D:\github_place\fin-agent\project\src\webui\vite.config.ts`**

- 删除整个 `/api → 9876` proxy 规则（含 `bypass` 函数，行 22-31）
- 保留 `/api/v1 → 8000`（行 16-19）

修改后 vite.config.ts proxy 配置：

```typescript
server: {
  port: 5173,
  proxy: {
    '/api/v1': {
      target: 'http://localhost:8000',
      changeOrigin: true,
    },
    // 移除: '/api' → 9876 整块 + bypass
  },
},
```

### 4.3 9876 文件清理

**删除 `D:\github_place\fin-agent\project\src\webui\server\`** 全部文件：

- `index.ts`
- `config.ts`
- `agents.ts`
- `skills.ts`
- `mcp.ts`
- `providers.ts`
- `tools.ts`
- `permissions.ts`
- `rules.ts`
- `utils.ts`（如有）
- `package.json`
- `package-lock.json`（如有）
- `node_modules/`（整个目录）

**修改 `D:\github_place\fin-agent\project\src\webui\package.json`**：
- 移除 9876 相关脚本（如 `"dev:server"`）
- 移除 9876 相关依赖（如 `@opencode-ai/sdk` 等，如果 webui 前端不再需要）

### 4.4 OPENCODE_API_BASE 单一化

**`D:\github_place\fin-agent\project\src\webui\src\config\env.ts`**

```typescript
// 行 23
// 删除 OPENCODE_API_BASE 散落
// 改为统一引用 API_V1_BASE（已在行 21 定义）
```

**`D:\github_place\fin-agent\project\src\webui\src\api\opencode.ts`**

- 删除 `USE_LEGACY_OPENCODE_PROXY` 分支
- 删除 `VITE_USE_LEGACY_OPENCODE_PROXY` 环境变量引用
- 把 `OPENCODE_API_BASE` 改为统一 `/api/v1`

**`D:\github_place\fin-agent\project\src\webui\src\hooks\useOpencode.ts`**

- 删除所有 `@migrated <日期>` 注释（已迁移完成，注释过时）
- 确认 25 个 hook 的 baseURL 引用统一（无 `/api/...` 残留）

### 4.5 文档占位更新

**`D:\github_place\fin-agent\project\CLAUDE.md`**（阶段 5 详细做，本阶段先标记）：
- 删除 9876 端口描述
- 标记 opencode CLI 端口 4096 独立运行说明

**`D:\github_place\fin-agent\project\README.md`**（如有）：
- 同步更新端口说明

## 完成判定

### 自动化验证

```bash
# 1. 端口检查：9876 不应被占用
lsof -i :9876  # 期望无输出

# 2. 进程检查：tsx watch 不应运行
ps aux | grep tsx  # 期望无 watch 进程

# 3. 启动脚本检查
# start.bat: 只有 [1/3] FastAPI + [3/3] Vite（不再有 Express 段）
# start.ps1: 只有 [1/4] FastAPI + [2/4] opencode + [4/4] Vite

# 4. 启动验证
cd D:\github_place\fin-agent\project
./config/start.bat
# 期望输出只有 FastAPI 和 Vite 两段横幅，无 Express Server 行
```

### curl 验证

```bash
# 所有 25 个端点 8000 端 200
for path in rules providers/active providers permissions tools \
            config/scope config/opencode \
            mcp mcp/foo/toggle \
            skills/count skills \
            agents/models; do
  curl -sf "http://localhost:8000/api/v1/$path" > /dev/null \
    && echo "[OK] /api/v1/$path" \
    || echo "[FAIL] /api/v1/$path"
done

# 9876 端不应再响应
curl -sf http://localhost:9876/api/health  # 期望 ECONNREFUSED
```

### 文件清理验证

```bash
# 9876 目录不应存在
ls "D:\github_place\fin-agent\project\src\webui\server\" 2>&1
# 期望: No such file or directory

# package.json 不应有 9876 脚本
grep -E "(dev:server|tsx watch)" "D:\github_place\fin-agent\project\src\webui\package.json"
# 期望: 无输出
```

### 完成 checklist

- [ ] `start.bat` 启动后只有 FastAPI + Vite 两段横幅
- [ ] `start.ps1` 启动后只有 FastAPI + opencode + Vite 三段
- [ ] `stop.bat` 端口列表无 9876
- [ ] `vite.config.ts` proxy 只剩 `/api/v1 → 8000`
- [ ] `src/webui/server/` 目录已删除
- [ ] `package.json` 移除 9876 脚本和依赖
- [ ] `env.ts` 删除 `OPENCODE_API_BASE` 散落
- [ ] `opencode.ts` 删除 `USE_LEGACY` 分支
- [ ] `useOpencode.ts` 所有 `@migrated` 注释已删除
- [ ] `lsof -i :9876` 无输出
- [ ] `ps aux | grep tsx` 无 watch 进程
- [ ] 8000 端 25 个端点全部 200
- [ ] e2e 测试全绿

## 风险与回退

| 风险 | 回退 |
|---|---|
| 删除 `src/webui/server/` 后某些脚本找不到 | git revert 本阶段；或保留 server 目录但禁用 npm script |
| start.bat 误删 opencode CLI 启动 | opencode CLI 在 start.ps1 而非 start.bat；本阶段不动 start.ps1 中 opencode 段 |
| `vite.config.ts` 删除 bypass 后未来 `/api` 路径报错 | 本阶段所有 hook 已切到 `/api/v1`，`/api` 路径不应再被访问；如出现，说明某 hook 漏改 |
| `OPENCODE_API_BASE` 删除后某处仍引用 | grep 兜底：`grep -rn "OPENCODE_API_BASE" D:\github_place\fin-agent\project\src\webui\src\` 应只剩 `api/opencode.ts` 一处（定义 + 使用）|

## 关键文件清单

**修改**：
- `D:\github_place\fin-agent\project\config\start.bat`（5 处删除）
- `D:\github_place\fin-agent\project\config\start.ps1`（3 处删除）
- `D:\github_place\fin-agent\project\config\stop.bat`（1 处删除）
- `D:\github_place\fin-agent\project\src\webui\vite.config.ts`（删除 `/api` proxy）
- `D:\github_place\fin-agent\project\src\webui\package.json`（移除 9876 脚本/依赖）
- `D:\github_place\fin-agent\project\src\webui\src\config\env.ts`（删除 `OPENCODE_API_BASE` 散落）
- `D:\github_place\fin-agent\project\src\webui\src\api\opencode.ts`（删除 `USE_LEGACY` 分支）
- `D:\github_place\fin-agent\project\src\webui\src\hooks\useOpencode.ts`（删除 `@migrated` 注释）

**删除**：
- `D:\github_place\fin-agent\project\src\webui\server\`（整个目录）
  - `index.ts`、`config.ts`、`agents.ts`、`skills.ts`、`mcp.ts`、`providers.ts`、`tools.ts`、`permissions.ts`、`rules.ts`、`utils.ts`
  - `package.json`、`package-lock.json`（如有）
  - `node_modules/`（如有）

**保留（不动）**：
- `start.ps1:72-86, 121, 136`（opencode CLI 启动 + 健康检查）
- 5 个目标页面文件
- 3 个 e2e spec
- `src/webui/src/api/http.ts`（envelope 解包逻辑）

## 关联阶段

- **前置**：阶段 3（前端 hooks 全部切换完成）
- **后续**：阶段 5（CLAUDE.md 同步 + ADR 文档）