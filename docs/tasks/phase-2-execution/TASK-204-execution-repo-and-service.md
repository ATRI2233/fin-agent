# TASK-204: modules/execution/repo/execution_repo.py + service/execution_service.py

> **阶段**: Phase 2 · **估时**: 5h · **优先级**: P1
> **上下文窗口**: 4 输入 · 2 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-204` |
| 所属阶段 | Phase 2 / execution repo + service |
| 前置任务 | TASK-003, TASK-010, TASK-201, TASK-202, TASK-203 |
| 后置任务 | TASK-310, TASK-409, TASK-CCC-04 |
| 输出文件 | `src/main/modules/execution/repo/execution_repo.py`, `src/main/modules/execution/service/execution_service.py`, `service/__init__.py` |

## 2. 目标

实现 `ExecutionRecorder` 与 `ExecutionStateReader` Protocol 的 SQLAlchemy 实现,封装事务边界(UoW)。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.6.2, §4.1
2. `src/main/modules/execution/protocol.py` (TASK-201)
3. `src/main/modules/execution/domain/*.py` (TASK-202)
4. `src/main/modules/execution/repo/orm.py` (TASK-203)
5. `src/main/infra/uow.py` (TASK-010) — UoW 边界

### 3.2 类型依赖

- 上述全部
- `infra.errors.DatabaseError` (TASK-003)

### 3.3 输出文件

1. `src/main/modules/execution/repo/execution_repo.py` - 含:
   - `class SqlAlchemyExecutionReader(ExecutionStateReader)`:
     - `__init__(self, session_factory)`(直接 SQLAlchemy session,非 UoW,用于只读)
     - 5 个查询方法
   - **不实现 Recorder**（Recorder 必须用 UoW,在 service 层）
2. `src/main/modules/execution/service/execution_service.py` - 含:
   - `class SqlAlchemyExecutionRecorder(ExecutionRecorder)`:
     - `__init__(self, uow_factory: UoWFactory)`
     - 每个 record_* 方法:**外层 with uow_factory.begin() as uow**,在 uow 内操作 ORM,然后退出时自动 commit
     - `mark_downstream_skipped`:查询下游节点并 update status=SKIPPED,return [NodeId]
3. `src/main/modules/execution/service/__init__.py`(空)

## 4. 详细步骤

### 4.0 准备: 创建空 `__init__.py`

```python
# Step 0: 创建空 __init__.py(占位模块入口,后续 import 必备)
import os
for sub in ("src/main/modules/execution/repo", "src/main/modules/execution/service"):
    os.makedirs(sub, exist_ok=True)
    open(os.path.join(sub, "__init__.py"), "w", encoding="utf-8").close()
```

### 4.1 execution_repo.py

1. `from __future__ import annotations`
2. `from sqlalchemy.orm import sessionmaker, Session`
3. `from src.main.modules.execution.protocol import ExecutionStateReader`
4. `from src.main.modules.execution.domain.execution import WorkflowExecution`
5. `from src.main.modules.execution.domain.execution_node import ExecutionNode`
6. `from src.main.modules.execution.repo.orm import WorkflowExecutionORM, ExecutionNodeORM`
7. `class SqlAlchemyExecutionReader(ExecutionStateReader)`:
   - 5 个方法实现,每个都把 ORM 行转成 domain dataclass
   - `list_executions` 用 `query.offset(offset).limit(limit).all()`
   - 不创建新 UoW(只读不需要事务)

### 4.2 execution_service.py

1. `from __future__ import annotations`
2. `from src.main.modules.execution.protocol import ExecutionRecorder`
3. `from src.main.modules.execution.domain.execution_node import ExecutionStatus, transition`
4. `from src.main.modules.execution.repo.orm import WorkflowExecutionORM, ExecutionNodeORM, ExecutionLogORM`
5. `from src.main.infra.uow import UoWFactory`
6. `from src.main.infra.errors import DatabaseError`
7. `class SqlAlchemyExecutionRecorder(ExecutionRecorder)`:
   - `__init__(self, uow_factory: UoWFactory)`
   - 每个 record_* 方法模板:
     ```python
     async def record_node_completed(self, execution_id, node_id, output, session_id, trace_id):
         with self._uow.begin() as uow:
             row = uow.session.query(ExecutionNodeORM).filter_by(...).first()
             if row:
                 transition(ExecutionStatus(row.status), ExecutionStatus.COMPLETED)
                 row.status = ExecutionStatus.COMPLETED.value
                 row.output = output
                 row.session_id = session_id
                 row.completed_at = datetime.now(UTC)
             uow.session.add(ExecutionLogORM(
                 execution_id=execution_id, node_id=node_id,
                 event="node.completed", payload={"output_keys": list(output.keys())},
                 trace_id=trace_id
             ))
     ```
   - `mark_downstream_skipped`:查询下游节点,update status=SKIPPED,return list[NodeId]
   - 失败必须 raise DatabaseError,**不** `except Exception: pass`

## 5. Do Not 清单

- [ ] **Do Not #5**: 事务边界 = UoW;执行器是纯函数 — 本卡片是**唯一**合法的执行侧 DB 入口
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError — DB 错误必须 raise DatabaseError
- [ ] **Do Not #10**: 必须用 `ExecutionStatus` 枚举 — 必须用 ExecutionStatus 枚举
- [ ] **Do Not #4**: 异常必须结构化(继承 FinAgentError + ErrorCode)
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry

## 6. 验收标准

- [ ] `python -c "from src.main.modules.execution.repo.execution_repo import SqlAlchemyExecutionReader"` 退出码 0
- [ ] `python -c "from src.main.modules.execution.service.execution_service import SqlAlchemyExecutionRecorder"` 退出码 0
- [ ] `isinstance(SqlAlchemyExecutionReader(SessionLocal()), ExecutionStateReader)` True
- [ ] `isinstance(SqlAlchemyExecutionRecorder(mock_uow_factory), ExecutionRecorder)` True
- [ ] **关键 grep**: `grep -nE 'try:.*except Exception: pass' src/main/modules/execution/service/execution_service.py` → 0
- [ ] **关键 grep**: `grep -nE 'with self._uow.begin' src/main/modules/execution/service/execution_service.py` ≥ 7(每个 record_* 方法一个)
- [ ] **关键 grep**: `grep -nE '"pending"|"running"|"failed"' src/main/modules/execution/service/execution_service.py` → 0(必须用枚举)

## 7. 非目标

- 不实现 retry(workflow 层 TASK-313)
- 不实现 DAG 知识(本卡片无 workflow 依赖)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-204 交付说明

$ grep -nE 'with self\._uow\.begin' src/main/modules/execution/service/execution_service.py
18:    async def create_execution(...):
22:        with self._uow.begin() as uow:
...
(≥ 7 matches)

$ grep -nE 'try:.*except Exception: pass' src/main/modules/execution/service/execution_service.py
(no output)
```
