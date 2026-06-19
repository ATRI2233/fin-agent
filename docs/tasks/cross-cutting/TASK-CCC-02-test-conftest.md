# TASK-CCC-02: tests/conftest.py - app.dependency_overrides fixture

> **阶段**: 跨切 · **估时**: 2h · **优先级**: P1
> **上下文窗口**: 2 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-CCC-02` |
| 所属阶段 | 跨切 |
| 前置任务 | TASK-405, TASK-409 |
| 后置任务 | TASK-CCC-03, TASK-CCC-04 |
| 输出文件 | `tests/conftest.py`, `tests/__init__.py` |

## 2. 目标

提供 in-memory SQLite + app + dependency_overrides 机制的 pytest fixture,所有测试通过此 fixture 拿 mock 服务。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §6.4
2. `src/main/api/app.py` (TASK-409) - create_app

### 3.2 类型依赖

- `src.main.api.app.create_app` (TASK-409)
- `src.main.api.deps.service_dep` (TASK-405)
- 各模块 Protocol

### 3.3 输出文件

1. `tests/__init__.py`(空)
2. `tests/conftest.py` - 含 fixtures:
   - `settings()` -> Settings with in-memory SQLite
   - `engine()` -> SQLAlchemy engine
   - `app()` -> FastAPI with overrides
   - `client()` -> TestClient
   - `mock_dispatcher()` -> MockAgentDispatcher
   - `mock_recorder()` -> MockExecutionRecorder

## 4. 详细步骤

1. `import pytest`
2. `from fastapi.testclient import TestClient`
3. `from sqlalchemy import create_engine`
4. `from sqlalchemy.orm import sessionmaker`
5. `from src.main.api.app import create_app`
6. `from src.main.infra.settings import Settings`
7. `from src.main.api.deps import service_dep`
8. fixture:
   ```python
   @pytest.fixture
   def settings():
       return Settings(DATABASE_URL="sqlite:///:memory:", ...)
   
   @pytest.fixture
   def app(settings):
       registry = build_registry(Settings())
       app = create_app(settings=Settings(), registry=registry)
       # override services
       app.dependency_overrides[service_dep(AgentDispatcher)] = lambda: MockAgentDispatcher()
       app.dependency_overrides[service_dep(ExecutionRecorder)] = lambda: MockExecutionRecorder()
       ...
       return app
   
   @pytest.fixture
   def client(app):
       return TestClient(app)
   ```

## 5. Do Not 清单

- [ ] **Do Not #14**: 必须 `app.dependency_overrides[service_dep(...)] = lambda: mock`
- [ ] **Do Not #6**: 重构期一次性切换;不允许共存
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry

## 6. 验收标准

- [ ] `tests/__init__.py` 存在
- [ ] `tests/conftest.py` 存在
- [ ] `pytest --collect-only tests/` 列出 ≥ 1 个 test item(即使全 skip)
- [ ] `from tests.conftest import app` 成功
- [ ] fixture `app` 接受 mock 注入

## 7. 非目标

- 不写具体测试用例(后续 TASK-CCC-03/04 覆盖)
- 不实现覆盖率统计(运维 CI 配置)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-CCC-02 交付说明

$ pytest --collect-only tests/ -q 2>&1 | head -20
<collect output>
```
