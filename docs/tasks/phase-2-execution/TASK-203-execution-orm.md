# TASK-203: modules/execution/repo/orm.py - SQLAlchemy 模型

> **阶段**: Phase 2 · **估时**: 3h · **优先级**: P1
> **上下文窗口**: 2 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-203` |
| 所属阶段 | Phase 2 / execution repo |
| 前置任务 | TASK-002, TASK-009, TASK-202 |
| 后置任务 | TASK-204 |
| 输出文件 | `src/main/modules/execution/repo/orm.py`, `src/main/modules/execution/repo/__init__.py` |

## 2. 目标

定义 `WorkflowExecution` 与 `ExecutionNode` 的 SQLAlchemy ORM 模型,以及 `execution_log` 表(v2.1 §7.4 新增)。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §7.4 (execution_log), §3.5 (状态机)
2. `src/main/infra/db.py` (TASK-009) - 含 `Base`

### 3.2 类型依赖

- `infra.db.Base` (TASK-009)
- `infra.domain.WorkflowId, ExecutionId, NodeId, SessionId` (TASK-002)
- `modules.execution.domain.execution_node.ExecutionStatus` (TASK-202)

### 3.3 输出文件

1. `src/main/modules/execution/repo/__init__.py`(空)
2. `src/main/modules/execution/repo/orm.py` - 含 3 个 ORM 类:
   - `class WorkflowExecutionORM(Base)`: 对应 domain.WorkflowExecution,字段含 `id, workflow_id, status, params (JSON), created_at, started_at, completed_at, trace_id (TEXT NOT NULL)`
   - `class ExecutionNodeORM(Base)`: 对应 ExecutionNode,字段含 `id (PK), execution_id (FK), node_id, agent, status, input (JSON), output (JSON), session_id, error, started_at, completed_at, retry_count`
   - `class ExecutionLogORM(Base)`: v2.1 §7.4 新增,字段 `id, execution_id (FK), node_id (nullable), agent_name (nullable), event (NOT NULL), payload (JSON), trace_id (NOT NULL), created_at`

## 4. 详细步骤

### 4.0 准备: 创建空 `__init__.py`

```python
# Step 0: 创建空 __init__.py(占位模块入口,后续 import 必备)
import os
os.makedirs("src/main/modules/execution/repo", exist_ok=True)
with open("src/main/modules/execution/repo/__init__.py", "w", encoding="utf-8") as f:
    pass
```

1. `from __future__ import annotations`
2. `from datetime import datetime`
3. `from sqlalchemy import String, Integer, DateTime, ForeignKey, JSON, Text`
4. `from sqlalchemy.orm import Mapped, mapped_column`
5. `from src.main.infra.db import Base`
6. 3 个 ORM 类都用 `class XxxORM(Base)` + `__tablename__ = "..."`
7. 主键用 `String`(UUID 字符串化存储,与现有 schema 兼容)
8. JSON 字段用 `JSON` 类型(SQLite 实际存为 TEXT,但 SQLAlchemy 抽象)
9. 不创建 init schema(留给后续 alembic 卡片)

## 5. Do Not 清单

- [ ] **Do Not #8**: 全部走 `settings.py` 或 `constants.py` — 用类属性显式
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol

## 6. 验收标准

- [ ] `python -c "from src.main.modules.execution.repo.orm import WorkflowExecutionORM, ExecutionNodeORM, ExecutionLogORM"` 退出码 0
- [ ] 3 个 ORM 都是 `Base` 子类
- [ ] `WorkflowExecutionORM.__tablename__ == "workflow_executions"`(或其他确定名,本卡片决定)
- [ ] `ExecutionLogORM` 含 `trace_id` 列且 nullable=False
- [ ] `Base.metadata.tables.keys()` 含 3 个表名

## 7. 非目标

- 不实现迁移脚本(后续 alembic)
- 不实现 repository(后续 TASK-204)
- 不实现 service(后续 TASK-204)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-203 交付说明

$ python -c "
from src.main.modules.execution.repo.orm import WorkflowExecutionORM, ExecutionNodeORM, ExecutionLogORM
from src.main.infra.db import Base
for t in (WorkflowExecutionORM, ExecutionNodeORM, ExecutionLogORM):
    print(t.__name__, t.__tablename__, 'cols:', [c.name for c in t.__table__.columns])
"
```
