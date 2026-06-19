# TASK-309: workflow_runner.py + PHASE3_STATE_MIGRATION.md

> **阶段**: Phase 3 · **估时**: 16h · **优先级**: P0（核心 + 交付物）
> **上下文窗口**: 6 输入 · 2 输出
> **风险等级**: 🔴 最高 — 同时是集成卡 + state migration 报告卡

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-309` |
| 所属阶段 | Phase 3 / workflow service |
| 前置任务 | TASK-005, TASK-010, TASK-105, TASK-204, TASK-301, TASK-302, TASK-303, TASK-304, TASK-305, TASK-306, TASK-307, TASK-308 |
| 后置任务 | TASK-310, TASK-408, TASK-409, TASK-411 |
| 输出文件 | `src/main/modules/workflow/service/workflow_runner.py`, `docs/architecture/PHASE3_STATE_MIGRATION.md` |

## 2. 目标

实现 `WorkflowRunner` Protocol(DAG 编排,所有执行状态由本类独占),并产出 Phase 3 的 state migration 报告。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §4.1, §8.1 Phase 3 强制交付物, §11.2
2. `src/main/modules/workflow/protocol.py` (TASK-301) - WorkflowRunner + NodeContext
3. `src/main/modules/workflow/domain/dag.py` (TASK-302)
4. `src/main/modules/workflow/executor/registry.py` (TASK-304) + 4 个 executor
5. `src/main/modules/workflow/repo/workflow_repo.py` (TASK-303)
6. `src/main/modules/execution/service/execution_service.py` (TASK-204) - ExecutionRecorder
7. **旧代码(参考)**: `src/main/framework/services/core/workflow_service.py` 与 `src/main/framework/core/workflow/node_executors/agent_executor.py`

### 3.2 类型依赖

- 上述全部
- `modules.agent.protocol.AgentDispatcher` (TASK-105)
- `infra.uow.UoWFactory` (TASK-010)
- `infra.tracing.bind_contextvars / unbind_contextvars` (TASK-005/006)

### 3.3 输出文件

1. `src/main/modules/workflow/service/workflow_runner.py` - 含 `class DefaultWorkflowRunner(WorkflowRunner)`
2. `docs/architecture/PHASE3_STATE_MIGRATION.md` - v2.1 §11.2 强制交付物

## 4. 详细步骤

### 4.0 准备: 创建空 `__init__.py`

```python
# Step 0: 创建空 __init__.py(占位模块入口,后续 import 必备)
import os
os.makedirs("src/main/modules/workflow/service", exist_ok=True)
with open("src/main/modules/workflow/service/__init__.py", "w", encoding="utf-8") as f:
    pass
```

### 4.1 workflow_runner.py

```python
class DefaultWorkflowRunner(WorkflowRunner):
    def __init__(
        self,
        *,
        reader: WorkflowReader,
        recorder: ExecutionRecorder,
        dispatcher: AgentDispatcher,
        executor_registry: NodeExecutorFactory,
        uow_factory: UoWFactory,
        settings: Settings,
    ):
        self._reader = reader
        self._recorder = recorder
        self._dispatcher = dispatcher
        self._registry = executor_registry
        self._uow = uow_factory
        self._settings = settings

    async def run(self, workflow_id, params, *, execution_id=None, trace_id) -> ExecutionSummary:
        # ⚠️ Bug C-7 约束: v2.1 §7.6 已规定 worker 显式接 trace_id
        # 此处 bind_contextvars 仅用于 logging 横切层(structlog 自动附加到日志 metadata),
        # **不**作为跨调用传递 trace_id 的机制 — 所有 worker 函数(包括嵌套子执行器)
        # 必须显式接收 `trace_id` 参数,不得依赖 ContextVar.bind/unbind 跨调用传递。
        # 禁止嵌套 bind 必须用 token 保存的 pattern,本设计**根本不依赖 ContextVar**。
        bind_contextvars(trace_id=str(trace_id))
        try:
            workflow = self._reader.get(workflow_id)
            if not workflow: raise WorkflowNotFoundError(...)
            
            # ⚠️ WorkflowRunner 独占所有执行状态
            self._results: dict[NodeId, NodeResult] = {}
            self._failed_nodes: set[NodeId] = set()
            self._skipped_nodes: set[NodeId] = set()
            self._chain_sessions: dict[NodeId, SessionId] = {}
            
            # 创建 Execution
            if execution_id is None:
                execution_id = await self._recorder.create_execution(workflow_id, params, trace_id)
            
            # DAG 计算
            order = topological_sort(workflow.nodes, workflow.edges)
            preds_map = build_predecessors(workflow.edges)
            
            # 拓扑驱动执行
            for node_id in order:
                if node_id in self._failed_nodes or node_id in self._skipped_nodes:
                    continue
                # 等待前驱
                ...
                # 构造 ctx(把 self._results 与 self._chain_sessions 作为只读快照传入)
                ctx: NodeContext = {
                    "node": next(n for n in workflow.nodes if n.id == node_id),
                    "execution_id": execution_id,
                    "predecessor_ids": preds_map.get(node_id, []),
                    "params": params,
                    "results": dict(self._results),  # 拷贝避免执行器修改
                    "edges": workflow.edges,
                    "trace_id": trace_id,
                    "chain_sessions": dict(self._chain_sessions),  # 同上
                }
                # Step 4.5: 标记节点进入 RUNNING(配对 TASK-201 record_node_started 必调契约)
                # 必须在 dispatch 之前:把 ExecutionNode.status 从 PENDING 转 RUNNING,
                # 记录 started_at;若 executor 抛 FinAgentError 则下一步 catch 后调
                # record_node_failed 完成 RUNNING -> FAILED 的状态闭环。
                await self._recorder.record_node_started(
                    execution_id=execution_id,
                    node_id=node_id,
                    trace_id=trace_id,
                )
                executor = self._registry.create(
                    ctx["node"].type,
                    dispatcher=self._dispatcher,
                    execution_recorder=self._recorder,
                    trace_id=trace_id,
                )
                try:
                    result = await executor.execute(ctx)
                    self._results[node_id] = result
                    if result.get("session_id"):
                        self._chain_sessions[node_id] = result["session_id"]
                    await self._recorder.record_node_completed(
                        execution_id, node_id,
                        output={"result": result["output"]},
                        session_id=result.get("session_id"),
                        trace_id=trace_id,
                    )
                except FinAgentError as e:
                    self._failed_nodes.add(node_id)
                    await self._recorder.record_node_failed(execution_id, node_id, e, trace_id)
                    # cascade skip(关键:传 workflow.edges 而非 workflow,符合 TASK-302 §3.3 纯函数契约)
                    for dn in find_downstream(node_id, workflow.edges):
                        if dn not in self._failed_nodes:
                            self._skipped_nodes.add(dn)
                            await self._recorder.record_node_skipped(execution_id, dn, trace_id)
            
            await self._recorder.mark_execution(
                execution_id,
                ExecutionStatus.FAILED if self._failed_nodes else ExecutionStatus.COMPLETED,
                trace_id,
            )
            return {
                "execution_id": execution_id,
                "workflow_id": workflow_id,
                "status": "failed" if self._failed_nodes else "completed",
                "results": self._results,
                "failed_nodes": list(self._failed_nodes),
                "skipped_nodes": list(self._skipped_nodes),
            }
        finally:
            unbind_contextvars("trace_id")
```

### 4.2 PHASE3_STATE_MIGRATION.md

按 v2.1 §8.1 Phase 3 第 1-4 步产出,内容含:

1. **旧 → 新字段对照表**(至少含 `_chain_sessions / _results / _failed_nodes / _skipped_nodes / _db / dispatcher`):
   | 旧字段(AgentNodeExecutor) | 新位置 | 证据 |
   |---|---|---|
   | `_chain_sessions: dict` | `WorkflowRunner._chain_sessions` + `NodeContext["chain_sessions"]` 只读快照 | runner.py: 第 N 行;agent_executor.py 第 N 行 |
   | `_results: dict` | `WorkflowRunner._results` + `NodeContext["results"]` 只读快照 | 同上 |
   | `_failed_nodes: set` | `WorkflowRunner._failed_nodes`(执行器不感知) | runner.py: 第 N 行 |
   | `_skipped_nodes: set` | `WorkflowRunner._skipped_nodes` | 同上 |
   | `_db: Session` | 删除(由 ExecutionRecorder via UoW 接管) | execution_service.py: 第 N 行 |
   | `dispatcher` | 通过 `NodeExecutorRegistry.create(..., dispatcher=...)` 注入 | registry.py: 第 N 行 |

2. **diff 命令输出原文**(粘贴实际命令输出)

3. **并发测试用例**(`test_workflow_runner.py::test_parallel_state_isolation`):
   - 10 个并行 sibling 节点
   - 每个节点 prompt 含唯一 trace_id
   - 执行后,每个节点的结果必须能从 `WorkflowRunner._results[node_id]` 找回,**且不受其他节点污染**

4. **结论**: 旧字段已全部迁移,执行器确认无状态

## 5. Do Not 清单

- [ ] **Do Not #19**（v2.1 §11.2）: 执行器必须无状态;所有跨调用持久化状态由 WorkflowRunner 独占,通过 `NodeContext` 只读快照传入。并行执行时任何共享实例字段 = 数据串读
- [ ] **Do Not (Bug C-7)**: **禁止** `bind_contextvars` 嵌套时不保存 token 的写法;workflow_runner 与嵌套子执行器之间不依赖 ContextVar 跨调用传递 trace_id — ContextVar 仅用于 logging 横切层,所有 worker 必须显式接 `trace_id` 参数(v2.1 §7.6 + §11.2 约束)
- [ ] **Do Not #11**: Executor 必须无状态,每次新建
- [ ] **Do Not #18**（v2.1 §7.6）: ContextVar 在跨 Task 调度时只继承调度时刻快照,子 Task 的 set 不会回写;一旦污染,日志 trace_id 错乱且不可复现
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #5**: 事务边界 = UoW;执行器是纯函数
- [ ] **Do Not(dag 纯函数契约)**: 禁止执行器(包括 `agent_executor.py / debate_executor.py / input_executor.py / output_executor.py`)直接调 `find_downstream(node_id, workflow)` 传整个 `Workflow` 对象 — 必须先解包为 `workflow.edges` 再传(`find_downstream(node_id, workflow.edges)`),保持 dag.py 纯函数语义(TASK-302 §3.3 + §4.4 约束)
- [ ] **Do Not(dag 纯函数契约)**: 同上,执行器调 `is_leaf / is_only_successor / build_predecessors` 时也必须传 `workflow.edges` 而非 `workflow`

## 6. 验收标准

- [ ] `python -c "from src.main.modules.workflow.service.workflow_runner import DefaultWorkflowRunner"` 退出码 0
- [ ] **关键 grep #1**: `grep -nE 'self\._(results|chain_sessions|failed_nodes|skipped_nodes)' src/main/modules/workflow/service/workflow_runner.py` ≥ 4 行(状态在 runner)
- [ ] **关键 grep #2**: `grep -nE 'self\.results|self\._chain_sessions' src/main/modules/workflow/executor/agent_executor.py` → **0 行**(执行器无状态)
- [ ] `docs/architecture/PHASE3_STATE_MIGRATION.md` 存在,含 5 列表格 + 至少 1 个并发测试截图
- [ ] `DefaultWorkflowRunner(reader=..., recorder=..., dispatcher=..., executor_registry=..., uow_factory=..., settings=...)` 实例化成功

## 7. 非目标

- 不实现 RetryService(TASK-310)
- 不实现 Scheduler(TASK-310)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-309 交付说明

### grep 验证
$ grep -nE 'self\._(results|chain_sessions|failed_nodes|skipped_nodes)' src/main/modules/workflow/service/workflow_runner.py
42:        self._results: dict[NodeId, NodeResult] = {}
45:        self._failed_nodes: set[NodeId] = set()
46:        self._skipped_nodes: set[NodeId] = set()
47:        self._chain_sessions: dict[NodeId, SessionId] = {}

$ grep -nE 'self\.results|self\._chain_sessions' src/main/modules/workflow/executor/agent_executor.py
(no output)

### PHASE3_STATE_MIGRATION.md 路径
docs/architecture/PHASE3_STATE_MIGRATION.md
```
