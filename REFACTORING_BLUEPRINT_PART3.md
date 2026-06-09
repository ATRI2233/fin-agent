# fin-agent 重构执行蓝图 — Part 3：执行与验收

> 本文档包含第八~九章：重构执行计划、验收标准与检查清单
> 全局限制（架构规范总则）请参见 Part 1

---


## 目录

- [一、架构规范总则](#一架构规范总则)
- [二、后端分层架构规范](#二后端分层架构规范)
- [三、前端分层架构规范](#三前端分层架构规范)
- [四、重构后完整目录结构](#四重构后完整目录结构)
- [五、全局状态与依赖治理](#五全局状态与依赖治理)
- [六、自动化防护工具配置](#六自动化防护工具配置)
- [七、重构前置条件（依赖图 + 并发方案 + 测试策略）](#七重构前置条件依赖图--并发方案--测试策略)
- [八、重构执行计划（7 阶段）](#八重构执行计划7-阶段)
- [九、验收标准与检查清单](#九验收标准与检查清单)

---

## 一、架构规范总则

### 1.1 单一职责原则

- 所有文件/模块行数 **不超过 500 行**（硬性上限）
- 单个文件仅承担 **一项核心职责**
- 严禁出现 God Object
- 禁止单一文件同时处理 CRUD、日志、缓存等多项职责

### 1.2 依赖倒置原则

- 高层模块依赖 **抽象接口** 而非低层模块
- 严禁 API 层直接操作数据库
- 所有数据操作必须通过 Service → Repository 中间层隔离

### 1.3 彻底消除硬编码

- API 地址 → `config/` 或 `.env`
- 阈值/常量 → `config/constants.py` / `config/constants.ts`
- 密钥 → `.env`（不入版本控制）
- 样式色值 → CSS 变量 / 主题配置文件
- 魔法数字与字符串 → 命名常量

### 1.4 明确模块边界

- 模块间仅通过定义好的接口通信
- 禁止直接访问其他模块内部全局变量、私有方法
- 跨模块调用必须通过依赖注入或事件总线

---

## 八、重构执行计划（7 阶段）

### 阶段 0：安全网 + 基础设施（第 1-2 周）

> ⚠️ 阶段 0 是重构的**前置条件**，必须完成才能进入后续阶段。

| 任务 | 产出 | 验收标准 |
|------|------|----------|
| **编写关键路径集成测试** | `tests/integration/test_conversation_flow.py` 等 | 10-15 个集成测试全部通过 |
| 配置 SQLite WAL 模式 | `config/database.py` | WAL 模式生效，busy_timeout=5000 |
| 实现写队列（可选） | `repositories/write_queue.py` | 并发写入无锁冲突 |
| 创建 config/ 目录，迁移配置 | `config/settings.py`, `config/constants.py`, `config/database.py` | 所有硬编码常量抽离 |
| 创建 repositories/base.py 泛型基类 | `BaseRepository[T]` | 基类完整、可实例化 |
| 创建 core/container.py 增强版 | DI 容器 | 支持 singleton/factory 注册 |
| 配置 ruff + ESLint 规则 | `pyproject.toml`, `.eslintrc.json` | 规则生效、CI 可运行 |
| 配置 pre-commit hooks | `.pre-commit-config.yaml` | 提交时自动检查 |
| 创建分层检测脚本 | `scripts/check_dependencies.py` | 检测脚本可运行 |

### 阶段 1：后端 Repository 层建设（第 3 周）

**目标**：统一数据库访问，消除散落的 `SessionLocal()` 调用

| 任务 | 涉及文件 | 产出 |
|------|----------|------|
| 实现 AgentRepository | `repositories/agent_repo.py` | Agent CRUD 完整 |
| 实现 WorkflowRepository | `repositories/workflow_repo.py` | Workflow CRUD 完整 |
| 扩展 ExecutionRepository | `repositories/execution_repo.py` | 覆盖所有执行相关查询 |
| 实现 ConversationRepository | `repositories/conversation_repo.py` | Conversation + Message CRUD |
| 实现 MaintenanceRepository | `repositories/maintenance_repo.py` | 数据维护 CRUD |
| 修改所有 API 端点使用 Depends(get_db) | 12 个控制器文件 | 无直接 SessionLocal 调用 |

**验收标准**：
- `grep -r "SessionLocal()" main/ --include="*.py"` 返回 0 结果（仅 database.py 中定义）
- 所有 Repository 可独立单元测试
- 分层检测脚本通过

### 阶段 2：后端 Service 层建设（第 4-5 周）

**目标**：提取业务逻辑，Controller 瘦身

| 任务 | 涉及文件 | 产出 |
|------|----------|------|
| 提取 ConversationService | 从 `conversations.py` 提取 | `services/conversation_service.py` |
| 提取 WorkflowService | 从 `workflows.py` + `workflow_engine.py` 提取 | `services/workflow_service.py` |
| 提取 ExecutionService | 从 `executions.py` 提取 | `services/execution_service.py` |
| 提取 SchedulerService | 从 `scheduler.py` 提取 | `services/scheduler_service.py` |
| 拆分 workflow_engine.py 的 execute_node | 新建 `core/node_executors/` | 策略模式，每种节点独立 Executor |
| 拆分 conversations.py 的后台任务 | 新建 `services/message_processor.py` | 后台任务独立模块 |
| 重构 Controller 层为纯路由 | 12 个控制器文件 | 每个端点不超过 20 行 |

**验收标准**：
- 所有 Controller 文件不超过 200 行
- conversations.py 从 610 行降至 150 行以下
- workflow_engine.py 从 603 行降至 300 行以下
- 所有 Service 可独立单元测试

### 阶段 3：后端依赖治理（第 6 周）

**目标**：彻底消除全局状态，完成 DI 容器落地

| 任务 | 涉及文件 | 产出 |
|------|----------|------|
| 将所有依赖收入 Container | `core/container.py` | 统一依赖管理 |
| 删除所有模块级 configure() 函数 | `scheduler.py`, `session_cleanup.py`, `conversations.py`, `data_maintenance.py` | 无 configure 函数 |
| 消除 _find_opencode_bin 重复 | `config.py`, `process_pool.py` | 共享配置函数 |
| main.py 瘦身 | `main.py` | 仅路由注册和启动配置 |
| 全量集成测试 | 测试文件 | 所有 API 端点正常工作 |

**验收标准**：
- `grep -r "configure(" main/ --include="*.py"` 返回 0 结果
- `grep -r "_engine_factory\|_backend\|_active_sessions\|_dispatcher\|_scheduler" main/ --include="*.py"` 仅在 Container 中出现
- 分层检测脚本全部通过

### 阶段 4：前端架构建设（第 7-8 周）

**目标**：建立分层架构，统一 API 调用和状态管理

| 任务 | 涉及目录 | 产出 |
|------|----------|------|
| 创建 API 客户端层 | `api/client.ts`, `api/conversations.ts` 等 | 统一 Axios 封装 |
| 创建配置层 | `config/api.ts`, `config/endpoints.ts`, `config/theme.ts` | 所有常量抽离 |
| 创建 Zustand Store | `store/conversationStore.ts` 等 | 全局状态管理 |
| 创建自定义 Hooks | `hooks/useConversation.ts` 等 | 业务逻辑封装 |
| 重构 ChatPage | `pages/ChatPage.tsx` | 从 833 行降至 200 行以下 |
| 重构 WorkflowEditor | `pages/WorkflowEditor.tsx` | 从 1563 行降至 300 行以下，拆分子组件 |
| 重构 AgentsPage | `pages/AgentsPage.tsx` | 从 941 行降至 200 行以下 |
| 重构 AppLayout | `App.tsx` | 消除内联样式，使用 CSS 变量 |
| 配置 ESLint 规则 | `.eslintrc.json` | 禁止直接 fetch、限制行数 |

**验收标准**：
- 所有页面文件不超过 300 行
- 无直接 `fetch()` 调用（全部通过 api/ 模块）
- 无硬编码 API 地址
- ESLint 检查全部通过

### 阶段 5：全量验证与收尾（第 9 周）

| 任务 | 产出 |
|------|------|
| 运行 ruff 全量检查 | 0 error |
| 运行 ESLint 全量检查 | 0 error |
| 运行分层依赖检测脚本 | 0 violation |
| 运行行数检查脚本 | 所有文件 ≤ 500 行 |
| 全量集成测试 | 所有 API 端点正常 |
| 前端 E2E 测试 | 核心流程正常 |
| 更新 README.md | 反映新架构 |
| 更新架构文档 | ARCHITECTURE.md |

---

## 九、验收标准与检查清单

### 9.1 架构合规检查

- [ ] 所有文件 ≤ 500 行
- [ ] 无 God Object（单文件单一职责）
- [ ] 无全局 `configure()` 函数
- [ ] 无直接 `SessionLocal()` 调用（Repository 层除外）
- [ ] Controller 层无业务逻辑
- [ ] Service 层无数据库操作
- [ ] 前端无直接 `fetch()` 调用
- [ ] 前端无硬编码 API 地址
- [ ] 所有常量抽离至 config/

### 9.2 代码质量检查

- [ ] ruff 检查通过（0 error）
- [ ] ESLint 检查通过（0 error）
- [ ] 分层依赖检测通过（0 violation）
- [ ] 行数检查通过（所有文件 ≤ 500 行）

### 9.3 功能验证

- [ ] 后端所有 API 端点正常响应
- [ ] 工作流创建、编辑、执行正常
- [ ] 对话功能正常（Agent 模式 + Workflow 模式）
- [ ] 定时任务正常
- [ ] 数据维护功能正常
- [ ] 前端所有页面正常渲染
- [ ] 前端核心流程可走通

---

## 附录：重构前后对比预期

| 指标 | 重构前 | 重构后 |
|------|--------|--------|
| 最大文件行数 | 1563 行 (WorkflowEditor.tsx) | ≤ 500 行 |
| SessionLocal 调用次数 | 37 处 | 1 处（database.py 定义） |
| 全局 configure 函数 | 5 个 | 0 个 |
| Controller 文件平均行数 | 300+ 行 | ≤ 200 行 |
| 前端直接 fetch 调用 | 50+ 处 | 0 处 |
| 硬编码 API 地址 | 散落各处 | 集中在 config/endpoints.ts |
| 可单元测试的模块数 | ~30% | 100% Service/Repository |
