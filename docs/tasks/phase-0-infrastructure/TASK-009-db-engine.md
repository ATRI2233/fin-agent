# TASK-009: infra/db.py - SQLAlchemy 引擎与 PRAGMA 配置

> **阶段**: Phase 0 · **估时**: 3h · **优先级**: P0
> **上下文窗口**: 1 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-009` |
| 所属阶段 | Phase 0 / infra |
| 前置任务 | TASK-007 |
| 后置任务 | TASK-010, TASK-014, TASK-203, TASK-303, TASK-403 |
| 输出文件 | `src/main/infra/db.py` |

## 2. 目标

SQLAlchemy engine + SessionLocal 工厂,带 SQLite WAL + busy_timeout PRAGMA,作为所有模块的 DB 入口。**本卡片必须导出 `SessionLocal`**(供 TASK-010 / TASK-411 使用)。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §4.3

### 3.2 类型依赖

- `infra.settings.Settings` (TASK-007)

### 3.3 输出文件

1. `src/main/infra/db.py` - 含:
   - `class Base(DeclarativeBase)` (SQLAlchemy 2.0 风格 `class Base(DeclarativeBase): pass`)
   - `def configure_sqlite(connection, connection_record) -> None`: 4 条 PRAGMA
   - `def create_engine(settings: Settings) -> Engine`: 含 `pool_size=settings.DB_POOL_SIZE`, `connect_args` 中 `timeout` 从 `settings.DB_BUSY_TIMEOUT_MS / 1000` 派生
   - `def get_session_local(engine: Engine) -> sessionmaker[Session]`: **必须导出**(供 UoW 工厂、build_registry 注入)
   - **禁止**: 模块级全局 `engine` / `_default_engine` / `get_engine()` 单例（由 main.py / TASK-411 持有 engine 引用）

## 4. 详细步骤

1. `from __future__ import annotations`
2. `from sqlalchemy import create_engine, event`
3. `from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session`
4. `from src.main.infra.settings import Settings`
5. `class Base(DeclarativeBase): pass`
6. `def configure_sqlite(connection, connection_record) -> None`: 设置 WAL, busy_timeout, synchronous=NORMAL, foreign_keys=ON（4 条 PRAGMA）
7. `def create_engine(settings: Settings) -> Engine`:
   - `engine = create_engine(settings.DATABASE_URL, pool_size=settings.DB_POOL_SIZE, connect_args={"check_same_thread": False, "timeout": settings.DB_BUSY_TIMEOUT_MS / 1000})`
   - `event.listen(engine, "connect", configure_sqlite)`
   - `return engine`
8. `def get_session_local(engine: Engine) -> sessionmaker[Session]`:
   - `return sessionmaker(bind=engine, expire_on_commit=False)`
   - **不**在模块底部创建全局 `SessionLocal`（每个 engine 独立 sessionmaker,避免跨测试污染）

## 5. Do Not 清单

- [ ] **Do Not #8**: 全部走 `settings.py` 或 `constants.py` — busy_timeout_ms 从 settings 来
- [ ] **Do Not #7**: 全部走 `settings.py`(pydantic-settings)
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry — （engine 由 main.py / TASK-411 创建并持有；SessionLocal 由 `get_session_local(engine)` 工厂按需创建）
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol

## 6. 验收标准

- [ ] `python -c "from src.main.infra.db import Base, create_engine, configure_sqlite, get_session_local"` 退出码 0
- [ ] `engine = create_engine(Settings()); sm = get_session_local(engine); session = sm(); session.close()` 流程正常
- [ ] `from src.main.infra.db import SessionLocal` 抛 `ImportError`（本卡片**不**导出模块级 SessionLocal,只有工厂函数 `get_session_local`）
- [ ] `engine = create_engine(Settings()); conn = engine.connect(); print(conn.execute(text("PRAGMA journal_mode")).scalar())` 输出 `wal`
- [ ] `conn.execute(text("PRAGMA busy_timeout")).scalar() == 30000`
- [ ] `create_engine(Settings(DB_BUSY_TIMEOUT_MS=5000))` 创建的 engine `connect_args["timeout"] == 5.0`
- [ ] `Base` 是 `DeclarativeBase` 子类

## 7. 非目标

- 不创建任何 ORM 模型(各模块自己)
- 不实现 Session 上下文管理器(TASK-010 UoW)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-009 交付说明

$ python -c "
from sqlalchemy import text
from src.main.infra.db import create_engine, configure_sqlite
from src.main.infra.settings import Settings
e = create_engine(Settings())
with e.connect() as c:
    print('journal:', c.execute(text('PRAGMA journal_mode')).scalar())
    print('busy:', c.execute(text('PRAGMA busy_timeout')).scalar())
"
journal: wal
busy: 30000
```
