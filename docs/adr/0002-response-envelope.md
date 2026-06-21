# ADR-0002: ApiResponse 统一信封

**状态**：Accepted

**日期**：2026-06-20

## 背景

fin-agent 8000 FastAPI 所有 v1 端点用统一 `ApiResponse` 信封返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": { /* 业务字段 */ },
  "trace_id": "tr-xxxxx"
}
```

但合并 9876 Express 后发现一个潜在风险：Python 端新增 25+ 个端点，每个端点都需要正确使用信封。如果个别端点忘了包装或包装不规范，前端 `http.ts` 的解包逻辑可能出错——历史经验：9876 返回裸 JSON 时，前端调用需手动 `.json()` 拿 `data`，与 8000 调用方式不一致，是前端开发反复踩的坑。

## 决策

1. **所有 8000 v1 router 必须用 `ApiResponse` 信封**包装返回
2. **`code === 0` 表示成功**，`code != 0` 表示业务失败（非 HTTP 错误）
3. **HTTP 状态码仍用标准语义**：200 业务成功、4xx 客户端错误、5xx 服务端错误
4. **`data` 字段是业务字段**，类型由 router 的 response_model Pydantic schema 定义
5. **`trace_id` 自动从 request context 注入**（由 `infra/tracing.py` 提供）
6. **前端 `http.ts` 自动解包**：当 `code === 0` 时返回 `envelope.data`，否则抛 `ApiError`

## 实施约束

### 后端

- 所有 router 函数返回类型为 `ApiResponse[T]`（T 是 Pydantic BaseModel）
- 不允许直接返回 dict 或 ORM 对象
- 错误处理：用 FastAPI 的 `HTTPException` 抛业务错误，由全局 exception handler 包装为 `ApiResponse{code: -1, message: <error>}`

### 前端

- 所有 API 调用**必须**通过 `request<T>()`（在 `api/http.ts`）包装
- 禁止直接 `fetch` 后 `.json()` 拿 envelope.data
- 类型推导：`apiGet<ResponseType>(path)` 让 TS 推断 `T = ResponseType`

## 后果

### 收益

- 字段一致性由信封强制保证（不会出现"某些端点返回裸数据"的不一致）
- trace_id 全链路追踪（前端可记录到日志 / Sentry）
- 业务错误码统一管理（`code` 语义化）

### 成本

- 新增 endpoint 时必须显式包装（不可漏掉）
- 前端新增 endpoint 调用时必须用 `request<T>()` 包装（不可直接 fetch）

## 验证

每次新增 v1 router 时，必须：

1. 用 curl 验证返回 `{code: 0, message: "ok", data: {...}, trace_id: "..."}` 完整信封
2. 用前端调用验证 `code === 0` 时解包 `data` 后字段名/类型正确
3. 错误路径验证：业务错误返回 `code != 0` + 描述性 message

## 参考

- 信封定义：`src/main/infra/errors.py`
- 信封使用样例：`src/main/api/v1/config.py`
- 前端解包：`src/webui/src/api/http.ts`
