# TASK-305: input_executor.py + output_executor.py (2 文件)

> **阶段**: Phase 3 · **估时**: 2h · **优先级**: P1
> **上下文窗口**: 2 输入 · 2 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-305` |
| 所属阶段 | Phase 3 / workflow executor |
| 前置任务 | TASK-301, TASK-304 |
| 后置任务 | TASK-309(TASK-307 也依赖 base,但不依赖 input/output) |
| 输出文件 | `src/main/modules/workflow/executor/input_executor.py`, `output_executor.py` |

## 2. 目标

实现最简的两个 executor: input(把 params 注入 results)与 output(把上游结果汇总)。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.6.3
2. `src/main/modules/workflow/executor/base.py` (TASK-304)

### 3.2 类型依赖

- `modules.workflow.executor.base.BaseNodeExecutor` (TASK-304)
- `modules.workflow.protocol.NodeContext, NodeResult` (TASK-301)

### 3.3 输出文件

1. `src/main/modules/workflow/executor/input_executor.py` - 含:
   - `class InputNodeExecutor(BaseNodeExecutor)`:
     - `async def execute(self, ctx) -> NodeResult`: `return {"output": ctx["params"], "session_id": None, "extra_data": {}}`
2. `src/main/modules/workflow/executor/output_executor.py` - 含:
   - `class OutputNodeExecutor(BaseNodeExecutor)`:
     - `async def execute(self, ctx) -> NodeResult`:
       - `inputs = [ctx["results"][pid] for pid in ctx["predecessor_ids"] if pid in ctx["results"]]`
       - `return {"output": {"inputs": inputs}, "session_id": None, "extra_data": {}}`

## 4. 详细步骤

### 4.1 input_executor.py

1. `from src.main.modules.workflow.executor.base import BaseNodeExecutor`
2. `class InputNodeExecutor(BaseNodeExecutor)`:
   - `async def execute(self, ctx)`: 直接 return,不动 ctx

### 4.2 output_executor.py

1. 同 import
2. `class OutputNodeExecutor(BaseNodeExecutor)`:
   - 聚合上游 outputs
   - **不**触发 session cleanup(留给 WorkflowRunner 决定)

## 5. Do Not 清单

- [ ] **Do Not #19**: 执行器必须无状态;所有跨调用持久化状态由 WorkflowRunner 独占,通过 `NodeContext` 只读快照传入。并行执行时任何共享实例字段 = 数据串读
- [ ] **Do Not #5**: 事务边界 = UoW;执行器是纯函数
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError

## 6. 验收标准

- [ ] `python -c "from src.main.modules.workflow.executor.input_executor import InputNodeExecutor"` 退出码 0
- [ ] `python -c "from src.main.modules.workflow.executor.output_executor import OutputNodeExecutor"` 退出码 0
- [ ] `InputNodeExecutor()` 实例化成功(基类 dispatcher/recorder/trace_id 默认 None)
- [ ] **关键 grep**: `grep -nE 'self\._(results|chain_sessions|db)' src/main/modules/workflow/executor/input_executor.py src/main/modules/workflow/executor/output_executor.py` → 0
- [ ] `OutputNodeExecutor.execute({"predecessor_ids": [], "results": {}, "params": {}, ...})` 返回 `output={"inputs": []}`

## 7. 非目标

- 不实现 agent_executor(TASK-307,关键卡)
- 不实现 debate_executor(TASK-308)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-305 交付说明

$ grep -nE 'self\._(results|chain_sessions|db)' src/main/modules/workflow/executor/input_executor.py src/main/modules/workflow/executor/output_executor.py
(no output)
```
