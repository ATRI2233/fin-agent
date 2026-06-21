# ADR-0001: 单后端架构（合并 9876 Express 到 8000 FastAPI）

**状态**：Accepted

**日期**：2026-06-20

## 背景

项目早期 8000 FastAPI 与 9876 Express 并存：

- **8000** 承担业务后端（workflows/executions/agents/mcp/conversations/config/skills）
- **9876** 承担 opencode 配置文件读写（config/skills/agents/mcp/providers/tools/permissions/rules）+ 静态托管

前端通过 vite proxy 跨两个后端（`/api/v1 → 8000`、`/api → 9876`），导致：

- baseURL 散落（`OPENCODE_API_BASE = '/api'` + `API_V1_BASE = '/api/v1'` 两套并存）
- CORS 双源（两个后端都要配 CORS，调试链路多一跳）
- 启动脚本双段编排（start.bat 三段、start.ps1 四段）
- 字段不一致（9876 返回裸 JSON，8000 用 `ApiResponse` 信封）
- e2e 测试易踩边界（跨域 + 双端口进程顺序）

2026-06-20 调研确认：

- 9876 Express **没有任何 opencode SDK 转发**（`@opencode-ai/sdk` 是 `package.json` 依赖但 `src/webui/server/*.ts` 中 0 import、0 调用）
- opencode CLI 由 `start.ps1` 独立以 4096 端口启动（`opencode serve --port 4096`）
- 9876 的全部 35 个端点都只是 opencode 配置文件读写，可等价移植到 8000
- 9876 静态托管职责在 dev 模式由 vite 替代，生产环境由 nginx/CDN 替代

## 决策

1. **所有 opencode 配置读写端点统一迁移至 8000 v1 router**（providers / permissions / rules / tools / agents 部分 / mcp 部分 / skills 部分 / config 已对齐），使用项目统一 `ApiResponse` 信封
2. **9876 Express 下线**，仅保留其静态托管职责（生产环境由 nginx/CDN 替代；dev 模式由 vite 替代）
3. **前端 baseURL 统一为 `/api/v1`**，删除 `OPENCODE_API_BASE` 散落
4. **opencode CLI 独立进程保留**（端口 4096），与 8000 无进程间通信依赖
5. **逐步迁移 + 环境变量回退**：每个端点独立迁移，失败可一键回退 9876

## 后果

### 收益

- 单一后端入口，单一 CORS 配置，单一启动编排
- 前端 baseURL 单一来源（消除散落）
- e2e 测试不需改（3 个 spec 不直接调 9876）
- 消除 vite proxy 顺序耦合（不再需要 bypass 函数）
- 字段一致性由 `ApiResponse` 信封统一保证
- 减少约 10 个 TypeScript 文件维护成本（`src/webui/server/`）

### 成本

- 8000 端点增加 25+ 个，需保证响应 `data` shape 严格对齐原 Express 响应
- Python 端接管 TypeScript 端的配置读写逻辑，TypeScript 代码（10 个 .ts 文件）可删除
- 迁移期需并行运行 8000 / 9876，curl 双源对比字段（已通过 `docs/refactor-decisions/9876-shape-snapshot.md` 解决）

## 回退方案

阶段 1-3 期间，所有切换通过 `VITE_USE_LEGACY_OPENCODE_PROXY` 环境变量驱动，未全部迁移期间可随时回退 9876。阶段 4 收尾后该环境变量和分支代码已删除，无法回退——如需重新启用 9876，需 git revert 阶段 1-4 全部改动。

## 实施

详见：

- `docs/plans/option-a-merge-9876/stage-0-snapshot.md`（基线抓取）
- `docs/plans/option-a-merge-9876/stage-1-new-routers.md`（4 个新 router）
- `docs/plans/option-a-merge-9876/stage-2-extend-routers.md`（扩展 3 个 router）
- `docs/plans/option-a-merge-9876/stage-3-frontend-migration.md`（前端 25 个 hook 切换）
- `docs/plans/option-a-merge-9876/stage-4-shutdown-9876.md`（关闭 9876）
- `docs/plans/option-a-merge-9876/stage-5-docs.md`（文档同步）

## 参考

- 子代理调研报告：架构盘点（2026-06-20）
- 子代理调研报告：实施前事实核对（2026-06-20）
- 字段快照：`docs/refactor-decisions/9876-shape-snapshot.md`
- 完整计划：`docs/plans/option-a-merge-9876/README.md`
