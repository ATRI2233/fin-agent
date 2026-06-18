# Framework — 工作流与消息系统架构

## 目录结构

```
framework/
├── controllers/ # API 路由层（FastAPI）
│ ├── workflows.py # 工作流 CRUD + 触发
│ ├── conversations.py # 对话 + 消息（支持 mode="workflow"）
│ ├── executions.py # 执行记录查询
│ └── ...
├── services/
│ ├── core/
│ │ ├── workflow_service.py # 工作流编排核心（DAG 遍历）
│ │ ├── execution_service.py # 执行记录管理
│ │ ├── conversation_service.py # 对话业务逻辑
│ │ └── message_processor.py # 消息处理 + 工作流结果回写对话
│ └── patterns/
│ ├── prompt_builder.py # Prompt 构建（参数替换 + 上游合并）
│ ├── workflow_graph.py # 前驱映射 / 下游查找
│ └── protocols.py # Protocol 接口定义
├── core/
│ └── workflow/
│ ├── workflow_engine.py # 引擎入口（薄包装，委托 WorkflowService）
│ ├── workflow_parser.py # 拓扑排序 + 并行分支识别
│ ├── session_manager.py # Session 生命周期管理
│ ├── session_cleanup.py # Session 清理（信号/atexit）
│ ├── scheduler.py # APScheduler 定时触发
│ └── node_executors/
│ ├── base.py # NodeContext / NodeResult / NodeExecutor ABC
│ ├── registry.py # 执行器注册表
│ ├── input_executor.py # Input 节点（透传参数）
│ ├── agent_executor.py # Agent 节点（核心，含 session 复用）
│ ├── output_executor.py # Output 节点（聚合结果）
│ └── debate_executor.py # Debate 节点（多 agent 辩论）
└── models/
    ├── workflow.py # Workflow ORM
    ├── workflow_execution.py # WorkflowExecution + ExecutionNode ORM
    └── conversation.py # Conversation + Message ORM
```

---

## 执行生命周期

```
触发方式:
  ① HTTP 手动 → POST /api/v1/workflows/{id}/trigger
  ② 对话消息 → POST /api/v1/conversations/{id}/messages (mode="workflow")
  ③ 定时 Cron → WorkflowScheduler (APScheduler CronTrigger)
       │
       ▼
  WorkflowService.run()
       │
       ├─ 1. 重置状态 (_results, _failed_nodes, _skipped_nodes, _chain_sessions)
       ├─ 2. 从 DB 加载 Workflow (nodes JSON + edges JSON)
       ├─ 3. 拓扑排序 (Kahn 算法) → 识别并行分支
       ├─ 4. 构建前驱映射 build_predecessors()
       ├─ 5. 创建 WorkflowExecution + N 个 ExecutionNode (全部 pending)
       ├─ 6. 按层级遍历 DAG:
       │ ├─ 同层级节点 → asyncio.gather 并行
       │ ├─ 每个并行节点独立 DB Session (避免 SQLite 锁)
       │ └─ 等待前驱完成 → 轮询 _results / _failed_nodes / _skipped_nodes
       ├─ 7. 设置最终状态 COMPLETED / FAILED
       └─ 8. finally: 清理所有 session
```

---

## 4 种节点执行器

| 类型 | 执行器 | 行为 |
|------|--------|------|
| `input` | `InputNodeExecutor` | 透传触发参数 → `NodeResult(result=ctx.params)` |
| `agent` | `AgentNodeExecutor` | 构建 prompt → 调度 agent → 捕获结果，支持 session 复用 |
| `output` | `OutputNodeExecutor` | 聚合所有前驱结果，合并文本输出 |
| `debate` | `DebateNodeExecutor` | 多 agent 辩论 → judge 选最佳分析 |

未知类型 fallback 到 `AgentNodeExecutor`。

---

## 节点间数据传递

```
              WorkflowService._results: dict[node_id, NodeResult]
              ─────────────────────────────────────────────────────
                                  │
              ┌───────────────────┼───────────────────┐
              ▼ ▼ ▼
         ┌────────┐ ┌──────────┐ ┌──────────┐
         │ Input │─result▶│ Agent A │─result▶│ Agent B │
         └────────┘ └──────────┘ └──────────┘
```

每个节点执行完毕后将 `NodeResult` 写入 `_results` 字典。下游节点构建 `NodeContext` 时读取所有前驱的结果。

**Prompt 构建** (`prompt_builder.py`):
1. `{key}` → workflow 触发参数替换
2. 节点配置字段替换
3. 边级 prompt（`edge.prompt`）作为 "Connection" 段注入
4. 上游输出提取 + `merge_inputs()` 合并 → 注入 `{upstream}` 或追加为 "Upstream Outputs"

---

## Session 复用规则

```
串行链复用（同时满足）:
  ① 当前节点只有 1 个前驱
  ② 该前驱只有 当前节点 1 个后继（非扇出）

  前驱 ──session──▶ 当前节点 ✓ 复用
  前驱 ──▶ A (新 session)
       ──▶ B (新 session) ✗ 各自独立
```

- `_chain_sessions` 跟踪 node_id → session_id 映射
- 并行分支各自 shallow-copy 独立的 `_chain_sessions`
- `finally` 块统一调用 `backend.cleanup_sessions` 清理

---

## 失败级联

```
节点 A 失败
    ├─ _failed_nodes 加入 A
    ├─ DB: ExecutionNode → "failed"
    └─ DFS find_downstream(A)
         ├─ B → "skipped"
         ├─ C → "skipped"
         └─ D → "skipped"

层级遍历时: if node_id in _skipped_nodes → 跳过
```

---

## 对话-工作流集成

从对话触发工作流时，执行过程中的状态、结果、错误分别写为不同类型的 `Message`:

```
用户消息 → Conversation (mode="workflow")
    │
    ├─ 执行中 → Message(role="system", extra_data.type="workflow_status")
    ├─ 成功 → Message(role="assistant") ← 优先取 OutputNode 合并结果
    └─ 失败 → Message(role="system", extra_data.type="workflow_error")
```

---

## ORM 表关系

```
Workflow (nodes, edges, status)
    │ 1:N
    ▼
WorkflowExecution (conversation_id FK, results, errors)
    │ 1:N │ N:1
    ▼ ▼
ExecutionNode Conversation (session_id)
 (node_id, agent, │ 1:N
  session_id, input, ▼
  output, status) Message (role, content,
                             extra_data, workflow_id)
```

---

## 状态机

| 领域 | 转换规则 |
|------|---------|
| **workflow** | `draft` → `running`/`paused` → `completed`/`failed` → `draft` |
| **execution** | `pending` → `running` → `completed`/`failed`/`cancelled`（终态不可逆） |
| **node** | `pending` → `running` → `completed`/`failed`/`skipped`; `completed`/`failed` → `cleaned_up` |

所有转换通过 `state_machine.validate_transition()` 校验。
