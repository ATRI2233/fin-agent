# TASK-201: modules/execution/protocol.py - ExecutionRecorder + ExecutionStateReader

> **阶段**: Phase 2 · **估时**: 2h · **优先级**: P0（Protocol 优先）
> **上下文窗口**: 1 输入 · 1 输出
> **关联修订**: REVISION_NOTES_2026-06-18.md 修订 **T-1**（CircuitBreaker Protocol 从 execution 模块移到 workflow 模块）

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-201` |
| 所属阶段 | Phase 2 / execution |
| 前置任务 | TASK-002, TASK-003, TASK-202 |
| 后置任务 | TASK-202, TASK-203, TASK-204, TASK-310 |
| 输出文件 | `src/main/modules/execution/protocol.py` |

## 2. 目标

定义 execution 模块对外 Protocol: `ExecutionRecorder`(写入侧)和 `ExecutionStateReader`(读取侧)。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.6.2

### 3.2 类型依赖

- `infra.domain.TraceId, WorkflowId, ExecutionId, NodeId, SessionId, FinAgentError` (TASK-002, TASK-003)
- `modules.execution.domain.execution_node.ExecutionStatus` (TASK-202)

### 3.3 输出文件

1. `src/main/modules/execution/protocol.py` - 含:
   - `class ExecutionRecorder(Protocol)`: 7 个写侧方法签名照抄设计文档 §3.6.2,**全部方法均为 `async def`(写侧,持久化/IO)**
   - `class ExecutionStateReader(Protocol)`: 5 个读侧方法签名照抄设计文档 §3.6.2,**全部方法均为 `def`(读侧同步,纯查询,不应阻塞事件循环)**

## 4. 详细步骤

### 4.0 准备: 创建空 `__init__.py`

```python
# Step 0: 创建空 __init__.py(占位模块入口,后续 import 必备)
import os
os.makedirs("src/main/modules/execution", exist_ok=True)
with open("src/main/modules/execution/__init__.py", "w", encoding="utf-8") as f:
    pass
```

1. `from __future__ import annotations`
2. `from typing import Protocol, runtime_checkable, Any`
3. `from src.main.infra.domain import TraceId, WorkflowId, ExecutionId, NodeId, SessionId, FinAgentError` (注:FinAgentError 在 errors.py 而非 domain.py,如无则 `from src.main.infra.errors import FinAgentError`)
4. `from src.main.modules.execution.domain.execution_node import ExecutionStatus`(forward ref 也可,但若有循环依赖则用字符串)
5. `class ExecutionRecorder(Protocol)`:**全部方法 `async def`**(写侧持久化,await 调用方如 TASK-309 line 82 `await self._recorder.create_execution(...)`):
   - `async def create_execution(workflow_id, params: dict, trace_id) -> ExecutionId`
   - `async def record_node_started(execution_id, node_id, trace_id) -> None`
     > **必调契约**: 由 `WorkflowRunner`(TASK-309 §4.1 step 4.5)在节点 `dispatch` 之前调用,把 `ExecutionNode.status` 从 `PENDING` 转 `RUNNING` 并记录 `started_at`。与 `record_node_completed` / `record_node_failed` 配对使用(后者在 `dispatch` 之后调)。**若不调**,中间 RUNNING 状态永久丢失,审计追踪无法回答"node 何时开始"。
   - `async def record_node_completed(execution_id, node_id, output: dict, session_id: SessionId | None, trace_id) -> None`
   - `async def record_node_failed(execution_id, node_id, error: FinAgentError, trace_id) -> None`
   - `async def record_node_skipped(execution_id, node_id, trace_id) -> None`
   - `async def mark_execution(execution_id, status: ExecutionStatus, trace_id) -> None`
   - `async def mark_downstream_skipped(execution_id, failed_node_id, trace_id) -> list[NodeId]`
6. `class ExecutionStateReader(Protocol)`:
   - `get_execution(execution_id) -> WorkflowExecution | None`
   - `get_execution_nodes(execution_id) -> list[ExecutionNode]`
   - `get_failed_nodes(execution_id) -> list[ExecutionNode]`
   - `get_node(execution_id, node_id) -> ExecutionNode | None`
   - `list_executions(workflow_id=None, *, limit, offset) -> list[WorkflowExecution]`
7. 两个 Protocol 都标 `@runtime_checkable`
8. **修订 T-1 强制要求（删除）**: **不要** 在本文件声明 `CircuitBreaker` Protocol。原 v2.1 §3.6.2 末尾的 `class CircuitBreaker(Protocol): ...` 必须删除。该 Protocol 由 workflow 模块暴露（见 TASK-301）。execution 模块**不感知**熔断器,只持久化 node-level failure 计数。

## 5. Do Not 清单

- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not #2**: 接口没对齐时用反射修补 = 隐藏 bug;改 Protocol
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **修订 T-1 强约束**: **禁止**在本文件出现 `CircuitBreaker` / `circuit_breaker` / 任何熔断器关键字。execution 模块是纯状态机 + 持久化,不感知 DAG 拓扑,更不感知熔断决策

## 6. 验收标准

- [ ] `python -c "from src.main.modules.execution.protocol import ExecutionRecorder, ExecutionStateReader"` 退出码 0
- [ ] 两个 Protocol 都是 `runtime_checkable`
- [ ] `ExecutionRecorder.record_node_failed` 签名含 `error: FinAgentError`
- [ ] `ExecutionRecorder.record_node_completed` 签名含 `output: dict`
- [ ] **修订 T-1 验证**: `grep -nE 'CircuitBreaker|circuit_breaker' src/main/modules/execution/protocol.py` → 0 结果
- [ ] **必调验证**: `grep -rn "record_node_started" src/main/` 在 TASK-309(workflow_runner.py)应至少 1 次调用,证明 Protocol 与 WorkflowRunner 调用方配对完整(防止 dead code 回归)

## 7. 非目标

- 不实现具体类
- 不写 ORM(后续 TASK-203)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-201 交付说明

$ python -c "
import inspect
from src.main.modules.execution.protocol import ExecutionRecorder
for m in ('create_execution','record_node_started','record_node_completed','record_node_failed','record_node_skipped','mark_execution','mark_downstream_skipped'):
    print(m, list(inspect.signature(getattr(ExecutionRecorder, m)).parameters.keys()))
"
```
