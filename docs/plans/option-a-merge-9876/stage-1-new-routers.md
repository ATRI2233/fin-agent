# 阶段 1：8000 端补齐 4 个新 v1 router

## 目标

在 8000 FastAPI 端新建 4 个 v1 router（rules / providers / permissions / tools），提供与 9876 Express 对应端点**字段一致**的 API。此阶段**不**触碰前端 hooks，**不**关闭 9876——8000 / 9876 双源并行。

## Context

9876 Express 端有 4 类文件读写端点在 8000 完全没有对应 router（rules/providers/permissions/tools），其中：
- rules：读写 `AGENTS.md`
- providers：读写 `opencode.json` 的 `provider` 段
- permissions：读写 `opencode.json` 的 `permissions` 段
- tools：读写 `opencode.json` 的 `tools` 段

本阶段把这 4 个 router 从 TypeScript 移植到 Python，全部用项目统一 `ApiResponse` 信封包装。

## 必做事项

### 1.1 新建 `src/main/api/v1/rules.py`

```python
router = APIRouter(prefix="/api/v1/rules", tags=["rules"])

@router.get("")
async def get_rules() -> ApiResponse:
    """GET /api/v1/rules - 读 AGENTS.md"""

@router.put("")
async def update_rules(body: {content: str}) -> ApiResponse:
    """PUT /api/v1/rules - 写 AGENTS.md"""
```

- 内部逻辑从 `src/webui/server/rules.ts:12-40` 移植
- 响应 `data` shape 对齐 `RulesEditor.tsx:15` 访问的 `data.content`
- snapshot 阶段 0 给出精确字段

### 1.2 新建 `src/main/api/v1/providers.py`

```python
router = APIRouter(prefix="/api/v1/providers", tags=["providers"])

@router.get("")                # list providers
@router.put("/{key}")          # upsert
@router.put("/active")         # set active
@router.delete("/{name}")      # delete
@router.get("/active")         # get active
```

- 内部逻辑从 `src/webui/server/providers.ts:53-143` 移植
- 响应 `data.providers`、`data.active.provider/model` 对齐 `ProvidersPage.tsx:26, 47-48`
- 注意 `/active` 路径要在 `/{key}` 之前注册（FastAPI 路由匹配按声明顺序）

### 1.3 新建 `src/main/api/v1/permissions.py`

```python
router = APIRouter(prefix="/api/v1/permissions", tags=["permissions"])

@router.get("")
@router.put("")
```

- 内部逻辑从 `src/webui/server/permissions.ts:38-71` 移植
- 响应 `data.rules`、`data.defaultAction` 对齐 `PermissionsPage.tsx:42-43`

### 1.4 新建 `src/main/api/v1/tools.py`

```python
router = APIRouter(prefix="/api/v1/tools", tags=["tools"])

@router.get("")
@router.put("/{name}")
```

- 内部逻辑从 `src/webui/server/tools.ts:34-64` 移植
- 检查 `useOpencode.ts` 是否有 `useOpencodeTools` hook；如有则一并迁移

### 1.5 注册 router（`src/main/api/app.py`）

```python
from src.main.api.v1 import (
    # ... 现有 import
    rules,
    providers,
    permissions,
    tools,
)

app.include_router(rules.router)
app.include_router(providers.router)
app.include_router(permissions.router)
app.include_router(tools.router)
```

### 1.6 实现约定

- 所有响应**必须**用 `ApiResponse` 信封：`{code: 0, message: "ok", data: <业务字段>, trace_id: "..."}`
- 业务字段（`data`）**逐字段**对齐 9876 Express 响应（参考阶段 0 产出的 snapshot）
- 错误处理：失败时 `code != 0`，message 描述错误
- 配置路径解析：复用 `src/main/api/v1/config.py` 中 `_resolve_file_path` 的实现（项目根 → `.opencode/<filename>`，全局 → `~/.config/opencode/<filename>`）
- JSONC 注释剥离：复用 `config.py` 中 `_strip_jsonc_comments`（处理 `oh-my-openagent.jsonc`）

## 完成判定

### 自动化 curl 验证

每个新端点必须返回 200 且 `data` shape 与 9876 一致：

```bash
# Rules
curl -s http://localhost:8000/api/v1/rules | jq '.data.content'  # 期望非 null
curl -s http://localhost:9876/api/rules/ | jq '.content'         # 对比

# Providers
curl -s http://localhost:8000/api/v1/providers | jq '.data | keys'   # 期望 ["providers", "active"]
curl -s http://localhost:9876/api/providers/ | jq 'keys'             # 对比

# Permissions
curl -s http://localhost:8000/api/v1/permissions | jq '.data | keys'
curl -s http://localhost:9876/api/permissions/ | jq 'keys'

# Tools
curl -s http://localhost:8000/api/v1/tools | jq '.data | keys'
curl -s http://localhost:9876/api/tools/ | jq 'keys'
```

### 完成 checklist

- [ ] `src/main/api/v1/rules.py` 创建，`app.py` 注册
- [ ] `src/main/api/v1/providers.py` 创建，`app.py` 注册
- [ ] `src/main/api/v1/permissions.py` 创建，`app.py` 注册
- [ ] `src/main/api/v1/tools.py` 创建，`app.py` 注册
- [ ] 4 个 router 全部 8000 curl 200
- [ ] 4 个 router `data` 字段与 9876 端 curl 对比完全一致
- [ ] Python 端启动日志无 import error / router conflict 警告

## 风险与回退

| 风险 | 回退 |
|---|---|
| `data` shape 与 9876 不一致 | 对比 snapshot，修复 router 直至一致；此阶段前端未切，8000 / 9876 并行运行影响面为 0 |
| FastAPI 路由顺序冲突（`/{key}` 与 `/active`）| 调整 router 内装饰器声明顺序：`/active` 必须在 `/{key}` 之前 |
| Python 端配置文件路径解析与 TS 不一致 | 复用 `config.py` 的 `_resolve_file_path` 实现；如 TS 端有特殊回退逻辑（如 cwd 探测），核对后移植 |
| JSONC 解析失败 | 复用 `_strip_jsonc_comments`；TS 端用了正则，Python 端用相同的正则 |

## 关键文件清单

**新建**：
- `D:\github_place\fin-agent\project\src\main\api\v1\rules.py`
- `D:\github_place\fin-agent\project\src\main\api\v1\providers.py`
- `D:\github_place\fin-agent\project\src\main\api\v1\permissions.py`
- `D:\github_place\fin-agent\project\src\main\api\v1\tools.py`

**修改**：
- `D:\github_place\fin-agent\project\src\main\api\app.py`（include 新 router）

**参考**（移植逻辑来源）：
- `D:\github_place\fin-agent\project\src\webui\server\rules.ts`
- `D:\github_place\fin-agent\project\src\webui\server\providers.ts`
- `D:\github_place\fin-agent\project\src\webui\server\permissions.ts`
- `D:\github_place\fin-agent\project\src\webui\server\tools.ts`

**复用工具函数**：
- `D:\github_place\fin-agent\project\src\main\api\v1\config.py` 中 `_resolve_file_path`、`_strip_jsonc_comments`

## 关联阶段

- **前置**：阶段 0（snapshot 文档）
- **后续**：阶段 2（扩展 mcp/skills/agents router）
- **最终用户可见**：阶段 3（前端 hooks 切换路径）+ 阶段 4（关闭 9876）