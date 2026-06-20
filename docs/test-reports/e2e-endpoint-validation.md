# E2E 端点验证报告

> **任务 ID**: P5-T1
> **日期**: 2026-06-20
> **分支**: refactor/webui-phase-1
> **测试方法**: 静态分析(后端代码 + 前端 ROUTES + ApiResponse 字段对齐)
> **状态**: 部分通过 — 19/20 端点已在运行应用中注册

## 1. 元信息

| 项 | 值 |
|---|---|
| 前端分支 | refactor/webui-phase-1 |
| 后端版本 | Phase 0-5 模块化重构(refactor/webui-phase-1) |
| 测试方法 | 静态分析(因 Windows 沙盒环境约束,未运行实际 curl) |
| 总端点数(代码定义) | 20 (19 v1 + 1 system) |
| 总端点数(应用注册) | **19** (5 个 v1 router,system.py **未挂载**) |

## 2. 信封格式验证

### 2.1 后端 ApiResponse 字段

读取 `src/main/infra/api_envelope.py:ApiResponse.to_dict()`:

```python
{
    "code":     int,        # ErrorCode 数值 (0 = SUCCESS)
    "message":  str,        # 可读消息
    "data":     Any | None, # 业务载荷
    "trace_id": str,        # 请求追踪 ID(snake_case)
}
```

读取 `src/main/infra/error_codes.py:ErrorCode.SUCCESS = 0` — 成功响应 `code === 0`。

读取 `src/main/api/middleware/exception_handlers.py` — 全局异常包装同样使用 `ApiResponse.from_exception(...)` 输出 4 字段格式,**所有错误响应也符合信封**。

读取 `src/main/api/v1/*.py` — 所有成功 handler 均调用 `ApiResponse.success(data, current_trace_id()).to_dict()`。

### 2.2 前端 http.ts 解包逻辑

读取 `src/webui/src/api/http.ts:request<T>()` (第 137-161 行):

```typescript
const rawJson = await response.json();
if (
    rawJson &&
    typeof rawJson === "object" &&
    typeof rawJson.code === "number" &&
    "data" in rawJson
) {
    if (rawJson.code === 0) {
        return rawJson.data;  // ✅ 解包 data
    }
    throw new ApiError(...);  // ❌ code !== 0 抛 ApiError
}
// 非信封格式(向后兼容):原样返回
return rawJson;
```

**关键兼容性验证**:
- 后端字段 `trace_id`(snake_case) vs 前端读取 `envelope.trace_id`(snake_case) → **完全兼容** ✅
- 后端 `code === 0` 返回 data,`code !== 0` 抛 ApiError → **匹配 ErrorCode.SUCCESS = 0** ✅
- 后端响应 `data` 字段存在(所有 handler 都设置) → 前端 `"data" in rawJson` 检查通过 ✅

**结论**: 前端解包逻辑与后端 ApiResponse **100% 兼容** ✅

## 3. 20 端点逐一验证

### 3.1 应用中实际注册的端点(19 个)

**注**: 后端代码定义 20 个端点,但 `src/main/api/app.py:106-110` 只 include 5 个 v1 router,**`system` router 未挂载**。因此 `/system/db_health` 在运行应用中**不会响应**(返回 FastAPI 默认 404)。这 19 个端点是真正可用的。

| # | Module | Method | Path | 后端位置 | 前端 ROUTES | 信封兼容 | 应用已注册 |
|---|---|---|---|---|---|---|---|
| 1 | agents | GET | `/api/v1/agents` | `src/main/api/v1/agents.py:39` | `ROUTES.agents.list` | ✅ | ✅ |
| 2 | agents | GET | `/api/v1/agents/{name}` | `src/main/api/v1/agents.py:58` | `ROUTES.agents.get` | ✅ | ✅ |
| 3 | conversations | GET | `/api/v1/conversations` | `src/main/api/v1/conversations.py:124` | `ROUTES.conversations.list` | ✅ | ✅ |
| 4 | conversations | POST | `/api/v1/conversations` | `src/main/api/v1/conversations.py:145` | `ROUTES.conversations.create` | ✅ | ✅ |
| 5 | conversations | GET | `/api/v1/conversations/{id}` | `src/main/api/v1/conversations.py:166` | `ROUTES.conversations.get` | ✅ | ✅ |
| 6 | conversations | POST | `/api/v1/conversations/{id}/messages` | `src/main/api/v1/conversations.py:196` | `ROUTES.conversations.messages` | ✅ | ✅ |
| 7 | executions | GET | `/api/v1/executions` | `src/main/api/v1/executions.py:125` | `ROUTES.executions.list` | ✅ | ✅ |
| 8 | executions | GET | `/api/v1/executions/{id}` | `src/main/api/v1/executions.py:149` | `ROUTES.executions.get` | ✅ | ✅ |
| 9 | executions | POST | `/api/v1/executions/{id}/abort` | `src/main/api/v1/executions.py:172` | `ROUTES.executions.abort` | ✅ | ✅ |
| 10 | executions | POST | `/api/v1/executions/{id}/nodes/{node_id}/retry` | `src/main/api/v1/executions.py:199` | `ROUTES.executions.retry` | ✅ | ✅ |
| 11 | mcp | GET | `/api/v1/mcp/tools` | `src/main/api/v1/mcp.py:30` | `ROUTES.mcp.tools` | ✅ | ✅ |
| 12 | mcp | GET | `/api/v1/mcp/servers` | `src/main/api/v1/mcp.py:50` | `ROUTES.mcp.servers` | ✅ | ✅ |
| 13 | mcp | GET | `/api/v1/mcp/agents/{name}/allowed-tools` | `src/main/api/v1/mcp.py:66` | `ROUTES.mcp.allowedTools` | ✅ | ✅ |
| 14 | workflows | GET | `/api/v1/workflows` | `src/main/api/v1/workflows.py:128` | `ROUTES.workflows.list` | ✅ | ✅ |
| 15 | workflows | POST | `/api/v1/workflows` | `src/main/api/v1/workflows.py:149` | `ROUTES.workflows.create` | ✅ | ✅ |
| 16 | workflows | GET | `/api/v1/workflows/{id}` | `src/main/api/v1/workflows.py:195` | `ROUTES.workflows.get` | ✅ | ✅ |
| 17 | workflows | PUT | `/api/v1/workflows/{id}` | `src/main/api/v1/workflows.py:218` | `ROUTES.workflows.update` | ✅ | ✅ |
| 18 | workflows | DELETE | `/api/v1/workflows/{id}` | `src/main/api/v1/workflows.py:247` | `ROUTES.workflows.delete` | ✅ | ✅ |
| 19 | workflows | POST | `/api/v1/workflows/{id}/trigger` | `src/main/api/v1/workflows.py:267` | `ROUTES.workflows.trigger` | ✅ | ✅ |

### 3.2 已定义但未注册的端点(1 个)

| # | Module | Method | Path | 后端位置 | 前端 ROUTES | 信封兼容 | 应用已注册 |
|---|---|---|---|---|---|---|---|
| 20 | system | GET | `/system/db_health` | `src/main/api/v1/system.py:23` | `ROUTES.system.dbHealth` | ✅ (代码层面) | **❌ 未挂载** |

**原因分析**:

- `src/main/api/v1/system.py` 文件存在,定义了 `router = APIRouter(prefix="/system")` + `GET /db_health`。
- `src/main/api/v1/__init__.py:38` 导出了 `from src.main.api.v1.system import router`(向后兼容),但仅为模块导出。
- `src/main/api/app.py:106-110` 的 `create_app()` **未调用** `app.include_router(system.router)`,仅 include 了 workflows / executions / agents / mcp / conversations 五个 router。

**前端影响**:
- `src/webui/src/api/contract.ts:38-40` 定义了 `ROUTES.system.dbHealth = "/system/db_health"`。
- 任何调用 `apiGet(ROUTES.system.dbHealth)` 的前端代码会在运行时收到 FastAPI 默认 404(无信封格式,非 `{code, message, data, trace_id}`)。
- 当前 webui 已通过 P2-T4 删除 `api/system.ts` 中 `getSystemStatus/getLogsStats/getCacheState`,但若仍有任何前端模块使用 `dbHealth`,需要确认是否预期使用。

**修复建议**(后续 sprint 单独立项):
- 选项 A: 在 `app.py` 添加 `app.include_router(system.router)`,恢复 `/system/db_health` 端点。
- 选项 B: 前端 `contract.ts` 移除 `system.dbHealth` 路由定义,确认无下游调用。

## 4. 验证命令样例(如需运行时验证)

```bash
# 启动后端(项目根)
cd project
python -m src.main.main

# 在另一个 shell,验证端点
curl -s http://localhost:8000/api/v1/agents | jq '.code, (.data | length)'
# 预期: 0 (code), N (data 数组长度)

curl -s http://localhost:8000/api/v1/workflows | jq '.code, (.data | length)'
# 预期: 0, N

curl -s http://localhost:8000/api/v1/mcp/tools | jq '.code, (.data | length)'
# 预期: 0, M

curl -s -X POST http://localhost:8000/api/v1/conversations \
    -H "Content-Type: application/json" \
    -d '{"agent_name":"test"}' | jq '.code, .data.id'
# 预期: 0, "<uuid>"

# system 端点当前会 404
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/system/db_health
# 预期: 404 (因 router 未挂载)
```

## 5. 总结

| 维度 | 结果 |
|---|---|
| 前端 ROUTES 与后端路由定义对齐 | ✅ 20/20 路径字符串完全一致 |
| 前端解包逻辑与后端 ApiResponse 字段兼容 | ✅ `code`/`data`/`trace_id`(snake_case) 完全兼容 |
| 后端错误响应也走信封格式 | ✅ `exception_handlers.py` 统一包装为 `ApiResponse.from_exception()` |
| 应用实际注册的端点数 | **19/20**(`system` router 未挂载) |
| 前端可安全调用的端点数 | **19**(`/system/db_health` 当前会 404) |

**Phase 5 前置条件状态**:
- ✅ 信封格式契约验证通过 — 前端解包逻辑无需改动
- ⚠️ `/system/db_health` 端点挂载缺陷 — 影响 P5-T2 Playwright 自动化测试(若测试覆盖 system 端点会失败);不影响 P5-T3 性能基线

## 6. 后续建议

1. **修复 system router 挂载**: 在 `src/main/api/app.py:106-110` 区域添加 `app.include_router(system.router)`(后续 sprint 单独立项,TASK-013 已声明此端点为 Phase 4 子任务的硬依赖)。
2. **运行时验证**: 启动后端 + 前端 dev server,运行 20 个 curl 端点验证(覆盖此静态分析的盲点,特别是 404 行为)。
3. **CI smoke job**: 在 `.github/workflows/ci.yml` 添加 backend-smoke job: 启动后端、curl 19 已注册端点、验证 `code === 0`、`data` 字段存在、`trace_id` 是字符串。
4. **监控**: 加入 `trace_id` 关联监控,确保生产环境 `trace_id` 100% 透传(header + body 一致)。
5. **前端 audit**: grep `webui/src/` 确认无任何代码使用 `ROUTES.system.dbHealth`(若有,要么修复后端挂载,要么前端移除调用)。