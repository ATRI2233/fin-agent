# TASK-303: modules/workflow/repo - orm.py + workflow_repo.py (2 文件)

> **阶段**: Phase 3 · **估时**: 4h · **优先级**: P1
> **上下文窗口**: 3 输入 · 2 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-303` |
| 所属阶段 | Phase 3 / workflow repo |
| 前置任务 | TASK-002, TASK-003, TASK-009, TASK-301, TASK-302 |
| 后置任务 | TASK-309, TASK-408, TASK-409 |
| 输出文件 | `src/main/modules/workflow/repo/orm.py`, `src/main/modules/workflow/repo/workflow_repo.py`, `repo/__init__.py` |

## 2. 目标

定义 `Workflow` ORM 与 Repository(实现 `WorkflowReader` Protocol 的一部分)。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §2 (workflow repo 部分), §3.6.3
2. `src/main/modules/workflow/domain/*` (TASK-302)
3. `src/main/infra/db.py` (TASK-009) - 含 `Base`

### 3.2 类型依赖

- `infra.db.Base` (TASK-009)
- `infra.domain.WorkflowId, NodeId` (TASK-002)
- `infra.errors.WorkflowNotFoundError` (TASK-003)
- `modules.workflow.protocol.WorkflowReader` (TASK-301)
- `modules.workflow.domain.{Workflow, Node, Edge, NodeType}` (TASK-302)

### 3.3 输出文件

1. `src/main/modules/workflow/repo/__init__.py`(空)
2. `src/main/modules/workflow/repo/orm.py` - 含:
   - `class WorkflowORM(Base)`: 字段 `id, name, description, nodes (JSON), edges (JSON), trigger_type, config (JSON), status, created_at, updated_at`
3. `src/main/modules/workflow/repo/workflow_repo.py` - 含:
   - `class SqlAlchemyWorkflowRepository`:
     - 实现 `WorkflowReader` Protocol 的 `get` 与 `list`
     - `get(id)`: ORM → domain.Workflow,Not found raise WorkflowNotFoundError
     - `list(*, limit, offset)`: 分页

## 4. 详细步骤

### 4.0 准备: 创建空 `__init__.py`

```python
# Step 0: 创建空 __init__.py(占位模块入口,后续 import 必备)
import os
os.makedirs("src/main/modules/workflow/repo", exist_ok=True)
with open("src/main/modules/workflow/repo/__init__.py", "w", encoding="utf-8") as f:
    pass
```

### 4.1 orm.py

1. `from __future__ import annotations`
2. `from sqlalchemy import String, DateTime, JSON`
3. `from src.main.infra.db import Base`
4. `class WorkflowORM(Base)`:
   - `__tablename__ = "workflows"`
   - `id: Mapped[str]`(主键)
   - `name: Mapped[str]`
   - `description: Mapped[str | None]`
   - `nodes: Mapped[list]`(JSON)
   - `edges: Mapped[list]`(JSON)
   - `trigger_type: Mapped[str]`
   - `config: Mapped[dict]`(JSON)
   - `status: Mapped[str]`
   - `created_at`, `updated_at: Mapped[datetime]`

### 4.2 workflow_repo.py

1. `from __future__ import annotations`
2. `from sqlalchemy.orm import sessionmaker, Session`
3. `from src.main.modules.workflow.protocol import WorkflowReader`
4. `from src.main.modules.workflow.domain.workflow import Workflow`
5. `from src.main.modules.workflow.domain.node import Node, NodeType`
6. `from src.main.modules.workflow.domain.edge import Edge`
7. `from src.main.modules.workflow.repo.orm import WorkflowORM`
8. `from src.main.infra.domain import WorkflowId, NodeId`
9. `from src.main.infra.errors import WorkflowNotFoundError`
10. `class SqlAlchemyWorkflowRepository(WorkflowReader)`:
    - `__init__(self, session_factory)`
    - `_to_domain(orm_row) -> Workflow`: ORM → domain(JSON 反序列化为 Node/Edge)
    - `get(workflow_id) -> Workflow`:
      - `row = session.query(WorkflowORM).filter_by(id=workflow_id).first()`
      - `if not row: raise WorkflowNotFoundError(f"workflow {workflow_id} not found")`
      - return self._to_domain(row)
    - `list(*, limit, offset) -> list[Workflow]`:
      - `rows = session.query(WorkflowORM).offset(offset).limit(limit).all()`
      - return [self._to_domain(r) for r in rows]

## 5. Do Not 清单

- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError — NotFound 必须 raise WorkflowNotFoundError
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol

## 6. 验收标准

- [ ] `python -c "from src.main.modules.workflow.repo.orm import WorkflowORM"` 退出码 0
- [ ] `python -c "from src.main.modules.workflow.repo.workflow_repo import SqlAlchemyWorkflowRepository"` 退出码 0
- [ ] `isinstance(SqlAlchemyWorkflowRepository(sessionmaker()), WorkflowReader)` True
- [ ] `WorkflowORM.__tablename__ == "workflows"`
- [ ] `WorkflowORM.nodes` 是 JSON 类型
- [ ] 用 in-memory SQLite 跑一次: `repo.create(...)` 后 `repo.get(id)` 返回 domain.Workflow(此测试留给后续卡片;本卡片只验证 Protocol 实现)

## 7. 非目标

- 不实现 workflow_query_service(CRUD + 列表 + 统计;TASK-309)
- 不实现 ORM migrations

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-303 交付说明

$ python -c "
from src.main.modules.workflow.repo.workflow_repo import SqlAlchemyWorkflowRepository
from src.main.modules.workflow.repo.orm import WorkflowORM
from src.main.modules.workflow.protocol import WorkflowReader
from sqlalchemy.orm import sessionmaker
repo = SqlAlchemyWorkflowRepository(sessionmaker())
assert isinstance(repo, WorkflowReader)
print('Protocol satisfied')
"
```
