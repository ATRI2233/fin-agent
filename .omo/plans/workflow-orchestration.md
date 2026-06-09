# 工作流编排系统实现计划

## TL;DR

> **Quick Summary**: 在现有 fin-agent 框架上构建任务级多会话多智能体自由编排系统，支持用户通过可视化画布创建复杂工作流（并行/串行/DAG/辩论），每个节点可指定 agent 和工具，支持手动框选 HAPI session 边界，实时状态监控，定时/命令触发执行。
>
> **Deliverables**:
> - 后端：Workflow 模型 + 工作流执行引擎 + Session 管理器
> - 前端：React Flow 可视化编辑器 + 工作流管理页面 + 实时状态监控
> - 集成：HAPI 多 session 管理 + 定时任务调度
>
> **Estimated Effort**: XL
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 → Task 3 → Task 6 → Task 10 → Task 14 → F1-F4

---

## Context

### Original Request
用户要求实现按任务级别的多会话(HAPI)多智能体自由编排组合。具体需求：
1. 用户可创建任务，设置周期执行或命令触发
2. 可视化编排界面，自由排列流程，支持并行/串行/DAG/辩论块
3. Agent 可指定调用的工具（基于已有 skill）
4. 可手动框选流程区域创建独立 HAPI session
5. 任务完成后自动清理 session
6. WebUI 展示实时传递状态图

### Interview Summary
**Key Discussions**:
- 并行/串行是流程天然支持的（多输出边=并行，单链=串行），不是特殊块
- 辩论是唯一的特殊块类型，只支持一层
- 数据传递格式为 JSON
- Agent prompt 作为历史对话注入
- 多输入合并格式：`agent_name: output`
- 错误处理：跳过失败节点并报错
- Session 边界：手动框选
- 存储：SQLite
- 长任务持久化：除非手动停止，否则持续运行

### Research Findings
**Existing System**:
- Python Framework: FastAPI + SQLite + 9 agents + HAPI Bridge + APScheduler
- WebUI: React 18 + Vite + Ant Design + Monaco Editor
- HAPI Hub: @twsxtd/hapi, port 3006, REST API with Bearer token
- Agents: 9 agents in `.opencode/agents/` with skills and tools
- Skills: 5 skills in `.opencode/skills/`

**Key Gap**: 现有框架只支持单 agent 单 session 的 Job 模型，需要扩展为多节点工作流。

---

## Work Objectives

### Core Objective
构建一个完整的可视化工作流编排系统，让用户可以通过拖拽方式创建复杂的多 agent 协作流程，并支持定时执行和实时监控。

### Concrete Deliverables
1. **后端 API**: 工作流 CRUD、执行控制、状态查询
2. **数据库模型**: workflows 表（存储工作流定义）、workflow_executions 表（执行记录）
3. **执行引擎**: 解析工作流图 → 拓扑排序 → 并行/串行执行 → 结果合并
4. **Session 管理器**: 管理每个节点的 HAPI session，支持 session 边界分组
5. **前端编辑器**: React Flow 画布 + agent 拖拽 + 连线 + 辩论块
6. **监控页面**: 实时展示节点执行状态和数据传递
7. **定时调度**: 集成 APScheduler 支持 cron 表达式

### Definition of Done
- [ ] 用户可通过 API 创建包含 10+ 节点的工作流
- [ ] 工作流可并行执行多个独立节点
- [ ] 辩论块可正确执行并输出融合结果
- [ ] 多输入节点正确合并上游输出
- [ ] 失败节点被跳过，不影响其他节点执行
- [ ] 定时任务可正确触发执行
- [ ] 执行完成后 session 被自动清理
- [ ] WebUI 可展示实时执行状态

### Must Have
- 工作流图必须是 DAG（有向无环图）
- 支持并行执行（多输出边）
- 支持串行执行（单链）
- 支持辩论块（多 agent + judge）
- 多输入合并（agent_name + output 格式）
- 错误跳过和报错
- Session 手动框选
- 定时和命令触发
- 自动 session 清理
- 实时状态监控

### Must NOT Have (Guardrails)
- ❌ 嵌套子工作流（工作流调用工作流）
- ❌ 实时协作编辑（多人同时编辑）
- ❌ 工作流模板库
- ❌ 变量状态管理（复杂变量系统）
- ❌ 条件分支（if/else 逻辑）
- ❌ 循环结构（while/for）
- ❌ Agent 市场/库浏览器
- ❌ 工作流导入/导出
- ❌ 高级 agent 配置（模型选择、温度调节）
- ❌ 自定义代码执行块
- ❌ 嵌套辩论块（辩论只支持一层）
- ❌ 超过 50 个节点的工作流
- ❌ 超过 10 个并行 agent 的工作流

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: Tests after implementation
- **Framework**: pytest (backend) + manual testing (frontend)
- **Agent-Executed QA**: ALL verification is agent-executed

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.omo/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Backend API**: Use Bash (curl) - Send requests, assert status + response fields
- **Frontend UI**: Use Playwright - Navigate, interact, assert DOM, screenshot
- **Database**: Use Bash (sqlite3) - Query tables, verify data

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - 数据模型 + 基础 API):
├── Task 1: Workflow 数据库模型 [quick]
├── Task 2: Workflow CRUD API [quick]
├── Task 3: Workflow Execution 模型 [quick]
└── Task 4: 扩展 HAPI Bridge 支持多 session [unspecified-high]

Wave 2 (Core Engine - 执行引擎 + Session 管理):
├── Task 5: 工作流图解析器 (DAG 验证 + 拓扑排序) [deep]
├── Task 6: 工作流执行引擎 (并行/串行调度) [deep]
├── Task 7: Session 管理器 (边界分组 + 清理) [unspecified-high]
├── Task 8: 辩论块执行器 [unspecified-high]
└── Task 9: 多输入合并器 [quick]

Wave 3 (Frontend - 可视化编辑器 + 监控):
├── Task 10: React Flow 画布 + 节点拖拽 [visual-engineering]
├── Task 11: 辩论块组件 + 连线逻辑 [visual-engineering]
├── Task 12: Session 边界框选功能 [visual-engineering]
├── Task 13: 实时状态监控页面 [visual-engineering]
└── Task 14: 工作流管理页面 (列表/创建/编辑/删除) [visual-engineering]

Wave 4 (Integration - 调度 + 清理 + 优化):
├── Task 15: 定时任务调度集成 [unspecified-high]
├── Task 16: 命令触发 + 参数传递 [unspecified-high]
├── Task 17: Session 自动清理 [quick]
├── Task 18: 错误处理 + 重试逻辑 [unspecified-high]
└── Task 19: 性能优化 (并发限制 + 超时) [quick]

Wave FINAL (Verification):
├── Task F1: Plan Compliance Audit [oracle]
├── Task F2: Code Quality Review [unspecified-high]
├── Task F3: Real Manual QA [unspecified-high]
└── Task F4: Scope Fidelity Check [deep]

Critical Path: Task 1 → Task 3 → Task 5 → Task 6 → Task 10 → Task 14 → F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 5 (Wave 3)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|------------|--------|
| 1 | - | 2, 3, 5 |
| 2 | 1 | 6, 14 |
| 3 | 1 | 6, 14 |
| 4 | - | 6, 7 |
| 5 | 1 | 6 |
| 6 | 2, 3, 4, 5 | 10, 11, 12, 13, 14 |
| 7 | 4 | 6, 12 |
| 8 | 6 | 11 |
| 9 | 6 | 13 |
| 10 | 6 | 14 |
| 11 | 6, 8 | 14 |
| 12 | 6, 7 | 14 |
| 13 | 6, 9 | 14 |
| 14 | 10, 11, 12, 13 | F1-F4 |
| 15 | 6 | F1-F4 |
| 16 | 6 | F1-F4 |
| 17 | 6, 7 | F1-F4 |
| 18 | 6 | F1-F4 |
| 19 | 6 | F1-F4 |

### Agent Dispatch Summary

- **Wave 1**: 4 tasks - T1 → `quick`, T2 → `quick`, T3 → `quick`, T4 → `unspecified-high`
- **Wave 2**: 5 tasks - T5 → `deep`, T6 → `deep`, T7 → `unspecified-high`, T8 → `unspecified-high`, T9 → `quick`
- **Wave 3**: 5 tasks - T10-T14 → `visual-engineering`
- **Wave 4**: 5 tasks - T15-T18 → `unspecified-high`, T19 → `quick`
- **FINAL**: 4 tasks - F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Workflow 数据库模型

  **What to do**:
  - 在 `main/framework/models/` 下创建 `workflow.py` 和 `workflow_execution.py`
  - Workflow 表: id (PK), name, description, nodes (JSON), edges (JSON), session_boundaries (JSON), schedule_config (JSON), status, created_at, updated_at
  - WorkflowExecution 表: id (PK), workflow_id (FK), status, started_at, completed_at, results (JSON), errors (JSON)
  - 在 `main/framework/models/database.py` 中注册新模型
  - 运行 `init_db()` 创建表

  **Must NOT do**:
  - 不要修改现有 Job/Result 模型
  - 不要添加复杂的索引

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Tasks 2, 3, 5
  - **Blocked By**: None

  **References**:
  - `main/framework/models/job.py` - 现有 Job 模型参考
  - `main/framework/models/result.py` - 现有 Result 模型参考
  - `main/framework/models/database.py` - 数据库配置和 init_db()

  **Acceptance Criteria**:
  - [x] `sqlite3 data/finagent.db ".tables"` 包含 workflows 和 workflow_executions
  - [x] `sqlite3 data/finagent.db "PRAGMA table_info(workflows);"` 显示正确列

  **QA Scenarios**:
  ```
  Scenario: 创建工作流表
    Tool: Bash (sqlite3)
    Preconditions: 数据库文件存在
    Steps:
      1. 运行 `sqlite3 data/finagent.db ".tables"`
      2. 检查输出包含 "workflows" 和 "workflow_executions"
    Expected Result: 两个表都存在
    Evidence: .omo/evidence/task-1-tables.txt
  ```

  **Commit**: YES (groups with 2, 3)
  - Message: `feat(workflow): add workflow models and CRUD API`
  - Files: `main/framework/models/workflow.py`, `main/framework/models/workflow_execution.py`, `main/framework/models/database.py`

- [x] 2. Workflow CRUD API

  **What to do**:
  - 在 `main/framework/api/` 下创建 `workflows.py`
  - 实现: POST /api/v1/workflows (创建), GET /api/v1/workflows (列表), GET /api/v1/workflows/{id} (详情), PUT /api/v1/workflows/{id} (更新), DELETE /api/v1/workflows/{id} (删除)
  - 在 `main/framework/main.py` 中注册 router
  - 添加输入验证: 节点数 <= 50, 必须是 DAG

  **Must NOT do**:
  - 不要添加工作流模板功能
  - 不要添加导入/导出功能

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Tasks 6, 14
  - **Blocked By**: Task 1

  **References**:
  - `main/framework/api/jobs.py` - 现有 Jobs API 参考
  - `main/framework/main.py` - Router 注册方式

  **Acceptance Criteria**:
  - [ ] `curl -X POST http://localhost:8000/api/v1/workflows -H "Content-Type: application/json" -d '{"name":"test","nodes":[],"edges":[]}'` 返回 201
  - [ ] `curl http://localhost:8000/api/v1/workflows` 返回 200
  - [ ] `curl http://localhost:8000/api/v1/workflows/{id}` 返回 200

  **QA Scenarios**:
  ```
  Scenario: 创建工作流
    Tool: Bash (curl)
    Preconditions: API 服务运行在 8000 端口
    Steps:
      1. 发送 POST 请求创建空工作流
      2. 检查返回状态码为 201
      3. 检查返回 JSON 包含 id 和 name
    Expected Result: 工作流创建成功
    Evidence: .omo/evidence/task-2-create.txt

  Scenario: DAG 验证
    Tool: Bash (curl)
    Preconditions: API 服务运行
    Steps:
      1. 发送 POST 请求创建包含循环的工作流 (A→B→A)
      2. 检查返回状态码为 400
    Expected Result: 拒绝创建，返回错误信息
    Evidence: .omo/evidence/task-2-dag-validation.txt
  ```

  **Commit**: YES (groups with 1, 3)
  - Message: `feat(workflow): add workflow models and CRUD API`
  - Files: `main/framework/api/workflows.py`, `main/framework/main.py`

- [x] 3. Workflow Execution 模型

  **What to do**:
  - 在 `main/framework/models/workflow_execution.py` 中添加 ExecutionNode 状态表
  - ExecutionNode 表: id, execution_id, node_id, agent, status, hapi_session_id, input (JSON), output (JSON), error, started_at, completed_at
  - 支持状态: pending, running, completed, failed, skipped

  **Must NOT do**:
  - 不要添加复杂的索引

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Tasks 6, 14
  - **Blocked By**: Task 1

  **References**:
  - `main/framework/models/job.py` - Job 模型参考

  **Acceptance Criteria**:
  - [ ] `sqlite3 data/finagent.db ".tables"` 包含 execution_nodes

  **QA Scenarios**:
  ```
  Scenario: 创建执行节点表
    Tool: Bash (sqlite3)
    Steps:
      1. 运行 `sqlite3 data/finagent.db ".tables"`
      2. 检查输出包含 "execution_nodes"
    Expected Result: 表存在
    Evidence: .omo/evidence/task-3-tables.txt
  ```

  **Commit**: YES (groups with 1, 2)

- [x] 4. 扩展 HAPI Bridge 支持多 session

  **What to do**:
  - 修改 `main/framework/core/hapi_bridge.py`
  - 添加 `create_session_for_node(node_id, agent, prompt)` 方法
  - 添加 `get_session_status(session_id)` 方法
  - 添加 `cleanup_sessions(session_ids)` 批量清理方法
  - 添加并发 session 管理（最大 10 个）

  **Must NOT do**:
  - 不要修改现有单 session 方法（保持向后兼容）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Tasks 6, 7
  - **Blocked By**: None

  **References**:
  - `main/framework/core/hapi_bridge.py` - 现有 HAPI Bridge

  **Acceptance Criteria**:
  - [ ] 可同时创建 10 个 session
  - [ ] 可批量清理 session

  **QA Scenarios**:
  ```
  Scenario: 创建多个 session
    Tool: Bash (curl)
    Steps:
      1. 调用 create_session_for_node 10 次
      2. 检查每个 session 都有唯一 ID
    Expected Result: 10 个 session 创建成功
    Evidence: .omo/evidence/task-4-multi-session.txt
  ```

  **Commit**: YES
  - Message: `feat(hapi): extend HAPI Bridge for multi-session`
  - Files: `main/framework/core/hapi_bridge.py`

- [x] 5. 工作流图解析器

  **What to do**:
  - 在 `main/framework/core/` 下创建 `workflow_parser.py`
  - 实现 DAG 验证（检测循环）
  - 实现拓扑排序（确定执行顺序）
  - 识别并行分支（多输出边）
  - 识别串行链（单输出边）
  - 识别辩论块（特殊节点类型）

  **Must NOT do**:
  - 不要支持嵌套子工作流

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 8, 9)
  - **Blocks**: Task 6
  - **Blocked By**: Task 1

  **References**:
  - 现有 `main/framework/core/` 目录结构

  **Acceptance Criteria**:
  - [ ] 可检测并拒绝包含循环的图
  - [ ] 可正确拓扑排序
  - [ ] 可识别并行和串行分支

  **QA Scenarios**:
  ```
  Scenario: DAG 验证
    Tool: Bash (python)
    Steps:
      1. 创建测试脚本，传入包含循环的图
      2. 调用 parser.validate_dag()
      3. 检查返回 False
    Expected Result: 循环被检测到
    Evidence: .omo/evidence/task-5-dag-validation.txt

  Scenario: 拓扑排序
    Tool: Bash (python)
    Steps:
      1. 创建测试脚本，传入 3 个节点的链 (A→B→C)
      2. 调用 parser.topological_sort()
      3. 检查返回顺序正确
    Expected Result: [A, B, C]
    Evidence: .omo/evidence/task-5-topo-sort.txt
  ```

  **Commit**: YES (groups with 6)
  - Message: `feat(engine): add workflow execution engine`
  - Files: `main/framework/core/workflow_parser.py`

- [x] 6. 工作流执行引擎

  **What to do**:
  - 在 `main/framework/core/` 下创建 `workflow_engine.py`
  - 实现 `execute_workflow(workflow_id, params)` 主方法
  - 按拓扑顺序执行节点
  - 并行执行独立分支（使用 asyncio.gather）
  - 串行执行依赖链
  - 收集每个节点的输出
  - 处理失败节点（跳过并记录错误）

  **Must NOT do**:
  - 不要添加重试逻辑（Task 18 处理）
  - 不要添加超时逻辑（Task 19 处理）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 10, 11, 12, 13, 14, 15, 16, 17, 18, 19
  - **Blocked By**: Tasks 2, 3, 4, 5

  **References**:
  - `main/framework/core/executor.py` - 现有 Job 执行器
  - `main/framework/core/hapi_bridge.py` - HAPI 调用方式

  **Acceptance Criteria**:
  - [ ] 可执行包含 3 个串行节点的工作流
  - [ ] 可执行包含 2 个并行分支的工作流
  - [ ] 失败节点被标记为 skipped

  **QA Scenarios**:
  ```
  Scenario: 串行执行
    Tool: Bash (curl)
    Steps:
      1. 创建 3 个节点的工作流 (A→B→C)
      2. 调用执行 API
      3. 查询执行状态
    Expected Result: 3 个节点按顺序完成
    Evidence: .omo/evidence/task-6-serial.txt

  Scenario: 并行执行
    Tool: Bash (curl)
    Steps:
      1. 创建包含并行分支的工作流 (A→B, A→C)
      2. 调用执行 API
      3. 查询执行状态
    Expected Result: B 和 C 同时执行
    Evidence: .omo/evidence/task-6-parallel.txt
  ```

  **Commit**: YES (groups with 5)

- [x] 7. Session 管理器

  **What to do**:
  - 在 `main/framework/core/` 下创建 `session_manager.py`
  - 实现 session 边界分组（手动框选的节点共享 session）
  - 实现 session 创建和销毁
  - 实现 session 间数据传递
  - 支持多输入合并（agent_name + output 格式）

  **Must NOT do**:
  - 不要自动推断 session 边界

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 6, 12
  - **Blocked By**: Task 4

  **References**:
  - `main/framework/core/hapi_bridge.py` - HAPI session 管理

  **Acceptance Criteria**:
  - [ ] 可将多个节点分组到同一 session
  - [ ] 可在 session 间传递数据

  **QA Scenarios**:
  ```
  Scenario: Session 边界分组
    Tool: Bash (python)
    Steps:
      1. 创建 3 个节点，将前 2 个分组到同一 session
      2. 调用 session_manager.create_sessions()
      3. 检查前 2 个节点共享 session ID
    Expected Result: 节点 1 和 2 共享 session，节点 3 独立
    Evidence: .omo/evidence/task-7-boundary.txt
  ```

  **Commit**: YES
  - Message: `feat(session): add session manager with boundary grouping`
  - Files: `main/framework/core/session_manager.py`

- [x] 8. 辩论块执行器

  **What to do**:
  - 在 `main/framework/core/` 下创建 `debate_executor.py`
  - 实现辩论块逻辑：多个 agent 分析同一问题 → judge agent 融合
  - 支持自定义 agent 列表和 judge
  - 输出格式：winner + analysis + reasoning

  **Must NOT do**:
  - 不要支持嵌套辩论块

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 11
  - **Blocked By**: Task 6

  **References**:
  - `.opencode/skills/fin-analysis-workflow/SKILL.md` - 现有辩论模式参考

  **Acceptance Criteria**:
  - [ ] 可执行包含 3 个 agent + judge 的辩论块
  - [ ] 输出包含 winner 和 reasoning

  **QA Scenarios**:
  ```
  Scenario: 辩论块执行
    Tool: Bash (curl)
    Steps:
      1. 创建包含辩论块的工作流
      2. 执行工作流
      3. 检查辩论块输出
    Expected Result: 输出包含 winner 字段
    Evidence: .omo/evidence/task-8-debate.txt
  ```

  **Commit**: YES
  - Message: `feat(executor): add debate block executor`
  - Files: `main/framework/core/debate_executor.py`

- [x] 9. 多输入合并器

  **What to do**:
  - 在 `main/framework/core/` 下创建 `input_merger.py`
  - 实现多输入合并逻辑：`agent_name: output` 格式
  - 支持空输入处理
  - 支持大输出截断（限制 10KB）

  **Must NOT do**:
  - 不要添加复杂的优先级规则

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 13
  - **Blocked By**: Task 6

  **References**:
  - 无

  **Acceptance Criteria**:
  - [ ] 多输入正确合并为指定格式
  - [ ] 空输入被正确处理

  **QA Scenarios**:
  ```
  Scenario: 多输入合并
    Tool: Bash (python)
    Steps:
      1. 创建 3 个输入
      2. 调用 merger.merge()
      3. 检查输出格式
    Expected Result: "agent1: output1\nagent2: output2\nagent3: output3"
    Evidence: .omo/evidence/task-9-merge.txt
  ```

  **Commit**: YES
  - Message: `feat(executor): add multi-input merger`
  - Files: `main/framework/core/input_merger.py`

- [x] 10. React Flow 画布 + 节点拖拽
- [x] 11. 辩论块组件 + 连线逻辑
- [x] 12. Session 边界框选功能
- [x] 13. 实时状态监控页面
- [x] 14. 工作流管理页面
- [x] 15. 定时任务调度集成
- [x] 16. 命令触发 + 参数传递
- [x] 17. Session 自动清理

  **What to do**:
  - 在工作流执行完成后自动清理 session
  - 添加清理钩子到执行引擎
  - 支持手动停止时清理
  - 日志记录清理结果

  **Must NOT do**:
  - 不要清理正在运行的 session

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 6, 7

  **References**:
  - `main/framework/core/session_manager.py` - Session 管理器

  **Acceptance Criteria**:
  - [ ] 执行完成后 session 被清理
  - [ ] 手动停止时 session 被清理

  **QA Scenarios**:
  ```
  Scenario: 自动清理
    Tool: Bash (curl)
    Steps:
      1. 执行一个工作流
      2. 等待完成
      3. 检查 session 是否被清理
    Expected Result: session 已删除
    Evidence: .omo/evidence/task-17-cleanup.txt
  ```

  **Commit**: YES
  - Message: `feat(integration): add session auto-cleanup`
  - Files: `main/framework/core/session_manager.py`

- [x] 18. 错误处理 + 重试逻辑

  **What to do**:
  - 在执行引擎中添加错误处理
  - 失败节点标记为 failed
  - 跳过依赖失败节点的下游节点
  - 记录错误信息到 execution_nodes 表
  - 可选：添加重试逻辑（默认关闭）

  **Must NOT do**:
  - 不要自动重试（除非用户配置）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: F1-F4
  - **Blocked By**: Task 6

  **References**:
  - `main/framework/core/executor.py` - 现有执行器错误处理

  **Acceptance Criteria**:
  - [ ] 失败节点被标记为 failed
  - [ ] 下游节点被标记为 skipped
  - [ ] 错误信息被记录

  **QA Scenarios**:
  ```
  Scenario: 错误处理
    Tool: Bash (curl)
    Steps:
      1. 创建一个会失败的工作流
      2. 执行工作流
      3. 检查节点状态
    Expected Result: 失败节点标记为 failed，下游标记为 skipped
    Evidence: .omo/evidence/task-18-error.txt
  ```

  **Commit**: YES
  - Message: `feat(integration): add error handling`
  - Files: `main/framework/core/workflow_engine.py`

- [x] 19. 性能优化 (并发限制 + 超时)

  **What to do**:
  - 添加并发限制（最大 10 个并行 agent）
  - 添加超时逻辑（默认 300 秒/节点）
  - 添加工作流级别超时
  - 添加资源清理

  **Must NOT do**:
  - 不要添加复杂的资源管理

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: F1-F4
  - **Blocked By**: Task 6

  **References**:
  - `main/framework/config.py` - 配置参数

  **Acceptance Criteria**:
  - [ ] 并发限制生效
  - [ ] 超时节点被标记为 failed

  **QA Scenarios**:
  ```
  Scenario: 并发限制
    Tool: Bash (curl)
    Steps:
      1. 创建包含 15 个并行节点的工作流
      2. 执行工作流
      3. 检查同时运行的节点数
    Expected Result: 最多 10 个节点同时运行
    Evidence: .omo/evidence/task-19-concurrency.txt
  ```

  **Commit**: YES
  - Message: `feat(integration): add performance optimization`
  - Files: `main/framework/core/workflow_engine.py`, `main/framework/config.py`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run linter + type checker. Review all changed files for: empty catches, console.log in prod, commented-out code, unused imports. Check AI slop patterns.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task. Test cross-task integration. Test edge cases. Save to `.omo/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Task | Commit Message | Files |
|------|----------------|-------|
| 1, 2, 3 | `feat(workflow): add workflow models and CRUD API` | `main/framework/models/workflow.py`, `main/framework/api/workflows.py` |
| 4 | `feat(hapi): extend HAPI Bridge for multi-session` | `main/framework/core/hapi_bridge.py` |
| 5, 6 | `feat(engine): add workflow execution engine` | `main/framework/core/workflow_engine.py`, `main/framework/core/workflow_parser.py` |
| 7 | `feat(session): add session manager with boundary grouping` | `main/framework/core/session_manager.py` |
| 8, 9 | `feat(executor): add debate block and multi-input merger` | `main/framework/core/debate_executor.py`, `main/framework/core/input_merger.py` |
| 10-14 | `feat(webui): add workflow editor and monitoring` | `webui/src/pages/WorkflowEditor.tsx`, `webui/src/pages/WorkflowMonitor.tsx` |
| 15-19 | `feat(integration): add scheduling, cleanup, error handling` | `main/framework/core/scheduler.py`, `main/framework/core/workflow_engine.py` |

---

## Success Criteria

### Verification Commands
```bash
# Backend API
curl http://localhost:8000/api/v1/workflows  # Expected: 200 OK with workflow list
curl -X POST http://localhost:8000/api/v1/workflows -d '{"name":"test","nodes":[],"edges":[]}'  # Expected: 201 Created

# Database
sqlite3 data/finagent.db "SELECT COUNT(*) FROM workflows;"  # Expected: >= 0
sqlite3 data/finagent.db "SELECT COUNT(*) FROM workflow_executions;"  # Expected: >= 0

# Frontend
curl http://localhost:5173/workflows  # Expected: 200 OK with HTML
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] All QA scenarios pass
- [ ] No orphaned HAPI sessions
- [ ] No cycles in workflow graphs
- [ ] Real-time monitoring works
- [ ] Session cleanup works
