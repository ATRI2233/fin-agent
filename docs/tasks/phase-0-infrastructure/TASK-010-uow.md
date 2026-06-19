# TASK-010: infra/uow.py - 事务边界

> **阶段**: Phase 0 · **估时**: 4h · **优先级**: P0
> **上下文窗口**: 2 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-010` |
| 所属阶段 | Phase 0 / infra |
| 前置任务 | TASK-003, TASK-009 |
| 后置任务 | TASK-204, TASK-310, TASK-404 |
| 输出文件 | `src/main/infra/uow.py` |

## 2. 目标

定义 UnitOfWork Protocol 与 SQLAlchemy 实现,使事务边界统一在 Service 层,执行器禁止直接操作 Session。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §4.1
2. `src/main/infra/db.py` (TASK-009 产出)

### 3.2 类型依赖

- `infra.errors.DatabaseError` (TASK-003)
- `infra.db.get_session_local` (TASK-009 工厂函数,**非模块级 SessionLocal**)

### 3.3 输出文件

1. `src/main/infra/uow.py` - 含:
   - `class UnitOfWork(Protocol)`
   - `class UoWFactory(Protocol)`
   - `class SqlAlchemyUnitOfWork`: 实现 UnitOfWork,持 `Session`,提供 `commit/rollback`
   - `class SqlAlchemyUoWFactory`: 实现 UoWFactory,接受 `session_factory: Callable[[], Session]`

## 4. 详细步骤

1. `from __future__ import annotations`
2. `from contextlib import contextmanager` (sync contextmanager;UoW 当前是同步的,后续如需 async 可扩展)
3. `from typing import Protocol, Callable, Any`
4. `from sqlalchemy.orm import Session, sessionmaker`
5. `from src.main.infra.db import get_session_local` (TASK-009 工厂函数,接收 engine 返回 sessionmaker)
6. `class UnitOfWork(Protocol)`:
   - `session: Session` 属性
   - `__enter__` / `__exit__`
   - `commit() -> None`
   - `rollback() -> None`
7. `class UoWFactory(Protocol)`:
   - `def begin() -> UnitOfWork`
8. `class SqlAlchemyUnitOfWork`:
   - `__init__(self, session: Session)`: self.session = session
   - `__enter__` 返回 self
   - `__exit__`: 若 exc_type is None: commit;否则 rollback;最后 close
   - `commit()`: `self.session.commit()`
   - `rollback()`: `self.session.rollback()`
9. `class SqlAlchemyUoWFactory`:
   - `__init__(self, session_factory: Callable[[], Session])`: 接收 `sessionmaker[Session]` 实例
   - `begin()` 返回 `SqlAlchemyUnitOfWork(self.session_factory())`
   - **典型装配**(TASK-411 中): `SqlAlchemyUoWFactory(get_session_local(engine))`
10. **关键**: 不要在 UoW 暴露 `repo` 属性 — UoW 只管事务,repo 由 service 自行注入

## 5. Do Not 清单

- [ ] **Do Not #5**: 事务边界 = UoW;执行器是纯函数 — UoW 是**唯一**事务入口
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError — 必须 raise DatabaseError
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry

## 6. 验收标准

- [ ] `python -c "from src.main.infra.uow import UnitOfWork, UoWFactory, SqlAlchemyUnitOfWork, SqlAlchemyUoWFactory"` 退出码 0
- [ ] `factory = SqlAlchemyUoWFactory(get_session_local(engine)); uow = factory.begin(); uow.session; uow.commit()` 流程正常
- [ ] `uow.rollback()` 不会抛(空 session 也 OK)
- [ ] 用 `with factory.begin() as uow:` 上下文管理器形式能正常 commit

## 7. 非目标

- 不实现 ExecutionRecorder(在 execution 模块)
- 不实现 repo 接口(各模块自己)
- 不实现 async UoW(后续卡片可加)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-010 交付说明

$ python -c "
from src.main.infra.db import create_engine, get_session_local
from src.main.infra.uow import SqlAlchemyUoWFactory
from src.main.infra.settings import Settings
engine = create_engine(Settings())
f = SqlAlchemyUoWFactory(get_session_local(engine))
with f.begin() as uow:
    uow.session.execute(__import__('sqlalchemy').text('SELECT 1'))
print('tx ok')
"
tx ok
```
