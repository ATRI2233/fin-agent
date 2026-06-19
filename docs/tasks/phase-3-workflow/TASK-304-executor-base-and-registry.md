# TASK-304: modules/workflow/executor - base.py + registry.py (2 文件)

> **阶段**: Phase 3 · **估时**: 3h · **优先级**: P1
> **上下文窗口**: 1 输入 · 2 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-304` |
| 所属阶段 | Phase 3 / workflow executor |
| 前置任务 | TASK-002, TASK-105, TASK-201, TASK-301, TASK-302 |
| 后置任务 | TASK-305, TASK-306, TASK-307, TASK-308 |
| 输出文件 | `src/main/modules/workflow/executor/base.py`, `src/main/modules/workflow/executor/registry.py`, `executor/__init__.py` |

## 2. 目标

定义 `NodeExecutor` Protocol 占位(完整签名在 TASK-301),以及**无单例缓存**的 typed factory registry。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.6.3 (NodeExecutorFactory), §11.2

### 3.2 类型依赖

- `modules.workflow.protocol.NodeExecutor, NodeExecutorFactory` (TASK-301)
- `modules.workflow.domain.node.NodeType` (TASK-302)
- `modules.agent.protocol.AgentDispatcher` (TASK-105)
- `infra.domain.AgentReference` (TASK-002)
- `modules.execution.protocol.ExecutionRecorder` (TASK-201)

### 3.3 输出文件

1. `src/main/modules/workflow/executor/__init__.py`(空)
2. `src/main/modules/workflow/executor/base.py` - 含:
   - `class BaseNodeExecutor(NodeExecutor)`(可选抽象基类,提供 `self.dispatcher`, `self.recorder`, `self.trace_id` 引用,**禁止**任何 dict/set/list 可变字段)
3. `src/main/modules/workflow/executor/registry.py` - 含:
   - `class NodeExecutorRegistry(NodeExecutorFactory)`:
     - `__init__(self)`: 初始化 `self._factories: dict[NodeType, Callable[..., NodeExecutor]]`
     - `register(node_type: NodeType, executor_cls: type[NodeExecutor])`: 注册(替换旧条目)
     - `create(node_type, *, dispatcher, execution_recorder, trace_id) -> NodeExecutor`:
       - `cls = self._factories[node_type]`
       - `return cls(dispatcher=dispatcher, execution_recorder=execution_recorder, trace_id=trace_id)`
     - **关键**: 无 `_instances` 缓存,无 `try: cls() except TypeError: inspect.signature ... kwargs[name]=None` 反射修补

## 4. 详细步骤

### 4.0 准备: 创建空 `__init__.py`

```python
# Step 0: 创建空 __init__.py(占位模块入口,后续 import 必备)
import os
os.makedirs("src/main/modules/workflow/executor", exist_ok=True)
with open("src/main/modules/workflow/executor/__init__.py", "w", encoding="utf-8") as f:
    pass
```

### 4.1 base.py

1. `from __future__ import annotations`
2. `from abc import ABC, abstractmethod`(用 ABC 而非 Protocol,因为这是基类)
3. `from src.main.modules.workflow.protocol import NodeExecutor, NodeContext, NodeResult`
4. `from src.main.modules.agent.protocol import AgentDispatcher`
5. `from src.main.modules.execution.protocol import ExecutionRecorder`
6. `from src.main.infra.domain import TraceId`
7. `class BaseNodeExecutor(NodeExecutor, ABC)`:
   - `__init__(self, *, dispatcher: AgentDispatcher | None = None, execution_recorder: ExecutionRecorder | None = None, trace_id: TraceId | None = None)`
   - `self.dispatcher = dispatcher`
   - `self.recorder = execution_recorder`
   - `self.trace_id = trace_id`
   - **`@abstractmethod async def execute(self, ctx) -> NodeResult`**
   - **关键约束**: 禁止定义 `_results`, `_failed_nodes`, `_skipped_nodes`, `_chain_sessions`, `_db` 等可变字段

### 4.2 registry.py

1. `from __future__ import annotations`
2. `from typing import Callable`
3. `from src.main.modules.workflow.protocol import NodeExecutorFactory, NodeExecutor`
4. `from src.main.modules.workflow.domain.node import NodeType`
5. `from src.main.modules.agent.protocol import AgentDispatcher`
6. `from src.main.modules.execution.protocol import ExecutionRecorder`
7. `from src.main.infra.domain import TraceId`
8. `from src.main.infra.errors import RegistryError`
9. `class NodeExecutorRegistry(NodeExecutorFactory)`:
   - `__init__`: `self._factories: dict[NodeType, type[NodeExecutor]] = {}`
   - `register(node_type, executor_cls)`: `self._factories[node_type] = executor_cls`
   - `create(node_type, *, dispatcher, execution_recorder, trace_id)`:
     - `cls = self._factories.get(node_type)`
     - `if cls is None: raise RegistryError(f"no executor for {node_type}")`
     - `return cls(dispatcher=dispatcher, execution_recorder=execution_recorder, trace_id=trace_id)`
   - 默认注册 4 个 type(在 default_registry 模块实例):
     - `NodeType.INPUT → InputNodeExecutor`
     - `NodeType.OUTPUT → OutputNodeExecutor`
     - `NodeType.AGENT → AgentNodeExecutor`
     - `NodeType.DEBATE → DebateNodeExecutor`
10. `default_registry = NodeExecutorRegistry()`(模块级实例,**允许**,因为它是无状态的 registry)

## 5. Do Not 清单

- [ ] **Do Not #11**: Executor 必须无状态,每次新建 — Registry 只持有 cls,**不**持有 instance
- [ ] **Do Not #19**（v2.1 新增）: 执行器必须无状态;所有跨调用持久化状态由 WorkflowRunner 独占,通过 `NodeContext` 只读快照传入。并行执行时任何共享实例字段 = 数据串读
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not #2**: 接口没对齐时用反射修补 = 隐藏 bug;改 Protocol

## 6. 验收标准

- [ ] `python -c "from src.main.modules.workflow.executor.base import BaseNodeExecutor"` 退出码 0
- [ ] `python -c "from src.main.modules.workflow.executor.registry import NodeExecutorRegistry, default_registry"` 退出码 0
- [ ] `BaseNodeExecutor.__init__` 接受 `dispatcher/execution_recorder/trace_id` 三个 keyword-only
- [ ] 尝试 `BaseNodeExecutor()` 直接实例化抛 TypeError(ABC)
- [ ] **关键 grep**: `grep -nE 'self\._(results|failed_nodes|skipped_nodes|chain_sessions|db)' src/main/modules/workflow/executor/base.py` → 0
- [ ] **关键 grep**: `grep -nE '_instances|singleton|cache' src/main/modules/workflow/executor/registry.py` → 0(除 docstring)
- [ ] **关键 grep**: `grep -nE 'try:.*cls\(\).*except TypeError' src/main/modules/workflow/executor/registry.py` → 0(无反射修补)

## 7. 非目标

- 不实现具体 executor(TASK-305~308)
- 不实现 workflow_runner(TASK-309)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-304 交付说明

$ grep -nE 'self\._(results|failed_nodes|skipped_nodes|chain_sessions|db)' src/main/modules/workflow/executor/base.py
(no output)

$ grep -nE '_instances|try:.*cls\(\).*except TypeError' src/main/modules/workflow/executor/registry.py
(no output)
```
