# 阶段 5：同步文档 — CLAUDE.md + ADR

## 目标

迁移完成后，同步文档，防止下个开发者再撞同款架构债。本阶段**只写文档不动代码**。

## Context

阶段 4 已完成代码层面的合并。本阶段：
1. 修正 CLAUDE.md 中与实际状态不符的描述
2. 新增两个 ADR（Architecture Decision Record），把架构决策沉淀为可追溯的文档
3. 给后人和未来的自己留一份"为什么这样做"的说明

## 必做事项

### 5.1 修正 CLAUDE.md 路径不一致

**`D:\github_place\fin-agent\project\CLAUDE.md`**

#### 修正 1：测试目录路径

CLAUDE.md 当前描述：
```
tests/                       # 测试套件(项目根目录)
├── e2e/                     #   Playwright E2E(.spec.ts)
├── infra/                   #   基础设施测试(test_db_health)
└── modules/                 #   业务模块测试(agent/conversation/execution/workflow)
```

实际状态：
- `tests/` 在项目根**不存在**
- `src/tests/e2e/`（实际位置）有 3 个 spec：`create-conversation.spec.ts`、`monitor-execution.spec.ts`、`trigger-workflow.spec.ts`
- `tests/infra/`、`tests/modules/` **未实施**

**修正**：改为：
```
src/tests/                   # 测试套件
└── e2e/                     #   Playwright E2E(.spec.ts)
                              #   (tests/infra/ 和 tests/modules/ 是规划目标但未实施)
```

#### 修正 2：端口与进程说明

CLAUDE.md 当前描述（基于阶段 0 调研）：
- 8000 FastAPI（Python）
- 9876 Express（TypeScript） — **已下线**

**修正**：

```
进程分工（迁移后）：
- 8000 FastAPI（Python）— 业务后端 + opencode 配置读写（25+ v1 router）
- 4096 opencode CLI（独立进程）— opencode SDK 服务（`opencode serve --port 4096`）
- 5173 Vite dev server — 前端 dev 模式

9876 Express 已下线（2026-XX-XX），迁移详见 docs/adr/0001-single-backend.md
```

#### 修正 3：8000 v1 router 清单

CLAUDE.md 当前 `main/api/v1/` 描述：
```
mcp, conversations, executions, workflow, agent
```

**修正为**（阶段 1/2 后）：
```
main/api/v1/                 # v1 router（业务 + opencode 配置）
├── agents/                  #   agent 调度 + opencode agents 配置
├── conversation/            #   对话管理
├── execution/               #   执行追踪(state_machine)
├── mcp/                     #   MCP 工具目录 + opencode mcp 配置
├── config/                  #   opencode config 读写（新增于阶段 1）
├── skills/                  #   opencode skills 读写（扩展于阶段 2）
├── providers/               #   opencode providers 读写（新增于阶段 1）
├── permissions/             #   opencode permissions 读写（新增于阶段 1）
├── rules/                   #   opencode AGENTS.md 读写（新增于阶段 1）
└── tools/                   #   opencode tools 读写（新增于阶段 1）
```

### 5.2 新增 ADR-0001：单后端架构

**`D:\github_place\fin-agent\project\docs\adr\0001-single-backend.md`**

#### 完整内容（建议）

```markdown
# ADR-0001: 单后端架构（合并 9876 Express 到 8000 FastAPI）

**状态**：Accepted

**日期**：2026-06-20

**作者**：（用户填写）

## 背景

项目早期 8000 FastAPI 与 9876 Express 并存：
- 8000 承担业务后端（workflows/executions/agents/mcp/conversations）
- 9876 承担 opencode 配置文件读写（config/skills/agents/mcp/providers/tools/permissions/rules）

前端通过 vite proxy 跨两个后端（`/api/v1 → 8000`、`/api → 9876`），导致：
- baseURL 散落（`OPENCODE_API_BASE = '/api'` + `API_V1_BASE = '/api/v1'`）
- CORS 双源（两个后端都要配 CORS）
- 启动脚本双段编排（start.bat 三段、start.ps1 四段）
- 字段不一致（9876 返回裸 JSON，8000 用 `ApiResponse` 信封）
- e2e 测试易踩边界

2026-06-20 调研确认：9876 Express **没有任何 opencode SDK 转发**（`@opencode-ai/sdk` 是 `package.json` 依赖但 `src/webui/server/*.ts` 中 0 import、0 调用）。opencode CLI 由 `start.ps1:72-86` 独立以 4096 端口启动。所以 9876 的全部 35 个端点都只是 opencode 配置文件读写，可等价移植到 8000。

## 决策

1. **所有 opencode 配置读写端点统一迁移至 8000 v1 router**（providers / permissions / rules / tools / agents 部分 / mcp 部分 / skills 部分 / config 已对齐），使用项目统一 `ApiResponse` 信封
2. **9876 Express 下线**，仅保留其静态托管职责（生产环境由 nginx/CDN 替代；dev 模式由 vite 替代）
3. **前端 baseURL 统一为 `/api/v1`**，删除 `OPENCODE_API_BASE` 散落
4. **opencode CLI 独立进程保留**（端口 4096），与 8000 无进程间通信依赖
5. **逐步迁移 + 环境变量回退**：每个端点独立迁移，失败可一键回退 9876

## 后果

### 收益

- ✅ 单一后端入口，单一 CORS 配置，单一启动编排
- ✅ 前端 baseURL 单一来源（消除散落）
- ✅ e2e 测试不需改（3 个 spec 不直接调 9876）
- ✅ 消除 vite proxy 顺序耦合（不再需要 bypass 函数）
- ✅ 字段一致性由 `ApiResponse` 信封统一保证

### 成本

- ⚠️ 8000 端点增加 25+ 个，需保证响应 `data` shape 严格对齐原 Express 响应
- ⚠️ Python 端接管 TypeScript 端的配置读写逻辑，TypeScript 代码（10 个 .ts 文件）可删除
- ⚠️ 迁移期需并行运行 8000 / 9876，curl 双源对比字段（已通过 `docs/refactor-decisions/9876-shape-snapshot.md` 解决）

## 回退方案

所有切换通过 `VITE_USE_LEGACY_OPENCODE_PROXY` 环境变量驱动，未全部迁移期间可随时回退 9876。阶段 4 收尾后该环境变量和分支代码已删除，无法回退——如需重新启用 9876，需 git revert 阶段 1-4 全部改动。

## 实施

详见：
- `docs/plans/option-a-merge-9876/stage-0-snapshot.md`（基线抓取）
- `docs/plans/option-a-merge-9876/stage-1-new-routers.md`（4 个新 router）
- `docs/plans/option-a-merge-9876/stage-2-extend-routers.md`（扩展 3 个 router）
- `docs/plans/option-a-merge-9876/stage-3-frontend-migration.md`（前端 25 个 hook 切换）
- `docs/plans/option-a-merge-9876/stage-4-shutdown-9876.md`（关闭 9876）
- `docs/plans/option-a-merge-9876/stage-5-docs.md`（本文档）

## 参考

- 子代理调研报告：架构盘点（2026-06-20）
- 子代理调研报告：实施前事实核对（2026-06-20）
```

### 5.3 新增 ADR-0002：ApiResponse 统一信封

**`D:\github_place\fin-agent\project\docs\adr\0002-response-envelope.md`**

#### 完整内容（建议）

```markdown
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

但合并 9876 Express 后发现一个潜在风险：Python 端新增 25+ 个端点，每个端点都需要正确使用信封。如果个别端点忘了包装或包装不规范，前端 `http.ts:155-182` 的解包逻辑可能出错。

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

- ✅ 字段一致性由信封强制保证（不会出现"某些端点返回裸数据"的不一致）
- ✅ trace_id 全链路追踪（前端可记录到日志 / Sentry）
- ✅ 业务错误码统一管理（`code` 语义化）

### 成本

- ⚠️ 新增 endpoint 时必须显式包装（不可漏掉）
- ⚠️ 前端新增 endpoint 调用时必须用 `request<T>()` 包装（不可直接 fetch）

## 验证

每次新增 v1 router 时，必须：
1. 用 curl 验证返回 `{code: 0, message: "ok", data: {...}, trace_id: "..."}` 完整信封
2. 用前端调用验证 `code === 0` 时解包 `data` 后字段名/类型正确
3. 错误路径验证：业务错误返回 `code != 0` + 描述性 message

## 参考

- 信封定义：`src/main/infra/errors.py`
- 信封使用样例：`src/main/api/v1/config.py`
- 前端解包：`src/webui/src/api/http.ts:155-182`
```

### 5.4 更新 README.md（如有）

**`D:\github_place\fin-agent\project\README.md`**（如有）

如果有"端口说明"段落，同步更新：
- 删除 9876 端口描述
- 标注 opencode CLI 端口 4096 独立运行
- 链接到 ADR-0001 说明合并背景

### 5.5 验证

完成后：

```bash
# 文档占位符已全部替换
grep -E "(<用户填写>|TODO|XXX)" D:\github_place\fin-agent\project\docs\adr\0001-single-backend.md
grep -E "(<用户填写>|TODO|XXX)" D:\github_place\fin-agent\project\docs\adr\0002-response-envelope.md
# 期望：无输出
```

## 完成判定

### 文档完整性 checklist

- [ ] `CLAUDE.md` 测试目录路径修正（`src/tests/e2e/`）
- [ ] `CLAUDE.md` 端口说明更新（删除 9876、保留 4096）
- [ ] `CLAUDE.md` v1 router 清单更新（新增 4 个 router）
- [ ] `docs/adr/0001-single-backend.md` 存在且内容完整
- [ ] `docs/adr/0002-response-envelope.md` 存在且内容完整
- [ ] `README.md`（如有）端口说明同步
- [ ] 两个 ADR 文档无 `<用户填写>` / `TODO` / `XXX` 占位符

### 链接正确性 checklist

- [ ] `CLAUDE.md` 引用 `docs/adr/0001-single-backend.md` 链接可点
- [ ] `0001-single-backend.md` 引用 `docs/plans/option-a-merge-9876/stage-*.md` 链接齐全
- [ ] `0002-response-envelope.md` 引用 `infra/errors.py`、`api/v1/config.py`、`api/http.ts` 文件路径正确

## 风险与回退

| 风险 | 回退 |
|---|---|
| CLAUDE.md 修改破坏项目结构（路径不一致） | diff review 后回滚；CLAUDE.md 是项目主文档，谨慎 |
| ADR 内容错误导致未来误决策 | 让未参与实施的同事过一遍；ADR 是历史决策的快照，错了就再开一个 ADR-0003 修正 |
| 文档未覆盖未来场景（如 4096 与 8000 真有依赖） | 后续如有依赖变化，开新 ADR 描述 |

## 关键文件清单

**修改**：
- `D:\github_place\fin-agent\project\CLAUDE.md`（3 处修正）
- `D:\github_place\fin-agent\project\README.md`（端口说明）

**新建**：
- `D:\github_place\fin-agent\project\docs\adr\0001-single-backend.md`
- `D:\github_place\fin-agent\project\docs\adr\0002-response-envelope.md`

## 关联阶段

- **前置**：阶段 0-4 全部完成
- **后续**：无（这是收尾阶段）

## 最终全流程索引

整个选项 A 实施完毕后的产物清单：

```
project/
├── docs/
│   ├── adr/
│   │   ├── 0001-single-backend.md        # 单后端架构决策
│   │   └── 0002-response-envelope.md     # ApiResponse 信封决策
│   ├── plans/
│   │   └── option-a-merge-9876/
│   │       ├── stage-0-snapshot.md       # 阶段 0: 现状冻结
│   │       ├── stage-1-new-routers.md    # 阶段 1: 4 个新 router
│   │       ├── stage-2-extend-routers.md # 阶段 2: 扩展 3 个 router
│   │       ├── stage-3-frontend-migration.md  # 阶段 3: 前端 25 个 hook
│   │       ├── stage-4-shutdown-9876.md  # 阶段 4: 关闭 9876
│   │       └── stage-5-docs.md           # 阶段 5: 文档同步（本文件）
│   └── refactor-decisions/
│       └── 9876-shape-snapshot.md        # 25 个端点字段快照
└── CLAUDE.md                              # 同步更新
```