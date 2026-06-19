# TASK-202: modules/execution/domain - 3 文件 (execution_node + state_machine + execution)

> **阶段**: Phase 2 · **估时**: 4h · **优先级**: P1
> **上下文窗口**: 1 输入 · 3 输出
> **关联修订**: REVISION_NOTES_2026-06-18.md 修订 **T-4**（CLEANED_UP 终态不可复活明示）

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-202` |
| 所属阶段 | Phase 2 / execution domain |
| 前置任务 | TASK-002, TASK-003, TASK-201 |
| 后置任务 | TASK-203, TASK-204 |
| 输出文件 | `src/main/modules/execution/domain/__init__.py`, `execution_node.py`, `state_machine.py`, `execution.py` |

## 2. 目标

定义 `ExecutionStatus` 枚举 + 迁移表、`transition()` 校验,以及 `ExecutionNode` / `WorkflowExecution` 聚合根。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.5

### 3.2 类型依赖

- `infra.domain.TraceId, WorkflowId, ExecutionId, NodeId, SessionId` (TASK-002)
- `infra.domain.AgentReference` (TASK-002) — ExecutionNode.agent 用,frozen 值对象
- `infra.errors.InvalidStateTransitionError` (TASK-003)

# 同模块类型依赖(由本卡片产出)
- `modules.execution.domain.execution_node.{ExecutionStatus, ExecutionNode, LEGAL_TRANSITIONS, transition}`
- `modules.execution.domain.state_machine.{can_transition, validate_transition}`
- `modules.execution.domain.execution.WorkflowExecution`

### 3.3 输出文件

1. `src/main/modules/execution/domain/__init__.py`(空)
2. `src/main/modules/execution/domain/execution_node.py` - 含:
   - `class ExecutionStatus(str, Enum)`: 6 个值(PENDING/RUNNING/COMPLETED/FAILED/SKIPPED/CLEANED_UP)
   - `LEGAL_TRANSITIONS: dict[ExecutionStatus, frozenset[ExecutionStatus]]`: 按设计文档 §3.5
   - `def transition(current: ExecutionStatus, target: ExecutionStatus) -> None`: 非法 raise InvalidStateTransitionError
   - `@dataclass class ExecutionNode`: 字段 `node_id: NodeId`, `agent: AgentReference`, `status: ExecutionStatus`, `input: dict`, `output: dict | None`, `session_id: SessionId | None`, `error: str | None`, `started_at: datetime | None`, `completed_at: datetime | None`, `retry_count: int = 0`
3. `src/main/modules/execution/domain/state_machine.py` - 含:
   - `def can_transition(current, target) -> bool`
   - `def validate_transition(execution_id, current, target) -> None`: 含 execution_id 在 error message 中
4. `src/main/modules/execution/domain/execution.py` - 含:
   - `@dataclass class WorkflowExecution`: 字段 `id: ExecutionId`, `workflow_id: WorkflowId`, `status: ExecutionStatus`, `params: ExecutionParams`, `trace_id: TraceId`, `created_at: datetime`, `started_at: datetime | None`, `completed_at: datetime | None`
   - **类型化说明**: `params` 应使用 `ExecutionParams` TypedDict(由 `infra/domain.py` 导出,TASK-002 负责定义)。本卡**只标注期望类型**,不新增 TypedDict 定义。`ExecutionParams` 期望字段(供 TASK-002 参考):
     ```python
     from typing import TypedDict
     class ExecutionParams(TypedDict):
         trace_id: str
         custom: dict[str, Any]  # 业务自定义参数
     ```

## 4. 详细步骤

### 4.0 准备: 创建空 `__init__.py`

```python
# Step 0: 创建空 __init__.py(占位模块入口,后续 import 必备)
import os
os.makedirs("src/main/modules/execution/domain", exist_ok=True)
with open("src/main/modules/execution/domain/__init__.py", "w", encoding="utf-8") as f:
    pass
```

### 4.1 execution_node.py

1. `from __future__ import annotations`
2. `from enum import Enum` + `from dataclasses import dataclass, field` + `from datetime import datetime`
3. `from src.main.infra.domain import NodeId, SessionId, AgentReference`
4. `class ExecutionStatus(str, Enum)`: 6 个值
5. `LEGAL_TRANSITIONS` 严格按设计文档 §3.5
6. **修订 T-4 强制注释**（紧跟 LEGAL_TRANSITIONS 定义后写入 module-level docstring 或注释）:
   ```python
   # === 设计约束（不允许在实现中绕过）===
   # - CLEANED_UP 是终态;不允许 CLEANED_UP → PENDING 复活。
   # - 用户在 session 清理后想重跑工作流,必须创建**新的 WorkflowExecution**
   #   （即 RetryService.retry_workflow() 内部的"新建 execution"语义）,
   #   而不是把现有 execution 的状态从 CLEANED_UP 拉回 PENDING/RUNNING。
   # - 历史 execution 的 CLEANED_UP 行保留作为审计追溯。
   # - SKIPPED 是**真终态**,不允许任何迁移出(`LEGAL_TRANSITIONS[SKIPPED] = frozenset()`)。
   #   - RetryService.retry_node 遇到 SKIPPED 节点必须**直接跳过**(详见 TASK-310 §4.1)。
   #   - 若业务需要重跑,创建新 execution(retry_workflow 语义,详见 TASK-310 §4.1)。
   ```
7. `def transition(current, target) -> None`:
   - `if target not in LEGAL_TRANSITIONS[current]: raise InvalidStateTransitionError(...)`

### 4.2 state_machine.py

1. `from src.main.modules.execution.domain.execution_node import ExecutionStatus, LEGAL_TRANSITIONS`
2. `from src.main.infra.errors import InvalidStateTransitionError`
3. `from src.main.infra.domain import ExecutionId`
4. `can_transition(current, target)`: 直接 `return target in LEGAL_TRANSITIONS[current]`
5. `validate_transition(execution_id, current, target)`:
   - 若非法 raise InvalidStateTransitionError,details={"execution_id": ..., "from": ..., "to": ...}

### 4.3 execution.py

1. `from src.main.infra.domain import ExecutionId, WorkflowId, TraceId, ExecutionParams`
2. `from src.main.modules.execution.domain.execution_node import ExecutionStatus`
3. `WorkflowExecution` 普通 dataclass(不 frozen,因为 status 会迁移)
4. **`params` 字段类型**: `params: ExecutionParams`(`ExecutionParams` TypedDict 由 `infra.domain` 导入);若 `infra.domain` 暂未导出 `ExecutionParams`,允许临时回退为 `dict[str, Any]`,并在代码注释中标注 `TODO: switch to ExecutionParams TypedDict once TASK-002 adds it`。**禁止**使用完全无注解的 `params: dict`。

## 5. Do Not 清单

- [ ] **Do Not #10**: 必须用 `ExecutionStatus` 枚举 — 必须用本文件的枚举
- [ ] **Do Not #4**: 异常必须结构化(继承 FinAgentError + ErrorCode)
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **修订 T-4 强约束**: **禁止**在 `transition()` 或后续 service 中加入 `CLEANED_UP → PENDING` 的特殊复活分支;若有人提 PR 加这条转换,CI 必须 fail（grep 验证见 TASK-CCC-04）
- [ ] **Do Not(状态机)**: 禁止 SKIPPED 节点被 `RetryService.retry_node` 重试 — SKIPPED 是真终态,只能创建新 execution(retry_workflow 语义)
- [ ] **Do Not(类型一致性)**: ExecutionNode.agent 必须是 `AgentReference` (frozen 值对象),**禁止**用 `str`(避免与 TASK-302 Node.agent 类型不一致)
- [ ] **Do Not(类型一致性)**: `WorkflowExecution.params` 必须是 `ExecutionParams` TypedDict(由 `infra.domain` 导入,TASK-002 定义)或至少 `dict[str, Any]`,**禁止**完全无注解的 `params: dict`(避免跨模块传递时类型裸奔)

## 6. 验收标准

- [ ] `python -c "from src.main.modules.execution.domain.execution_node import ExecutionStatus, LEGAL_TRANSITIONS, transition"` 退出码 0
- [ ] `python -c "from src.main.modules.execution.domain.state_machine import can_transition, validate_transition"` 退出码 0
- [ ] `python -c "from src.main.modules.execution.domain.execution import WorkflowExecution"` 退出码 0
- [ ] `transition(ExecutionStatus.PENDING, ExecutionStatus.RUNNING)` 不抛
- [ ] `transition(ExecutionStatus.SKIPPED, ExecutionStatus.RUNNING)` 抛 InvalidStateTransitionError
- [ ] `can_transition(ExecutionStatus.FAILED, ExecutionStatus.PENDING) == True`
- [ ] `ExecutionStatus.PENDING.value == "pending"`
- [ ] **修订 T-4 验证**: `grep -nE 'CLEANED_UP.*PENDING|PENDING.*CLEANED_UP' src/main/modules/execution/domain/execution_node.py` 仅在注释中命中,代码中无迁移
- [ ] **修订 T-4 验证 #2**: LEGAL_TRANSITIONS 中 `ExecutionStatus.CLEANED_UP: frozenset()` 仍是空集

## 7. 非目标

- 不实现 ORM(后续 TASK-203)
- 不实现 service(TASK-204)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-202 交付说明

$ python -c "
from src.main.modules.execution.domain.execution_node import ExecutionStatus, transition
from src.main.infra.errors import InvalidStateTransitionError
transition(ExecutionStatus.PENDING, ExecutionStatus.RUNNING)
print('PENDING->RUNNING ok')
try: transition(ExecutionStatus.SKIPPED, ExecutionStatus.RUNNING)
except InvalidStateTransitionError as e: print('caught:', e.message)
"
PENDING->RUNNING ok
caught: illegal: skipped -> running
```
