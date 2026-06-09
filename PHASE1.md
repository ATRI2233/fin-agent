# Phase 1：基础建设与安全网

> 目标：搭建重构基础设施，建立安全网，完成后端数据访问层统一
> 预计周期：3 周（原蓝图阶段 0 + 阶段 1）
> 基于：ARCHITECTURE_AUDIT.md 审计结论

---

## 〇、架构审计要点（决策依据）

> 以下为 ARCHITECTURE_AUDIT.md 核心发现，是本次重构的直接动因。

### 0.1 五大反模式

| 反模式 | 文件 | 严重程度 | 具体表现 |
|--------|------|----------|----------|
| God Object | `conversations.py` (610行) | 极高 | 路由+会话管理+业务编排+后台任务四合一 |
| God Object | `workflow_engine.py` (603行) | 高 | execute_node 162行，4种节点类型混在一起 |
| DRY 违规 | `config.py` + `process_pool.py` | 中 | `_find_opencode_bin()` 重复实现 |
| 全局状态滥用 | 4个文件 | 高 | 模块级全局变量+configure()函数，绕过DI容器 |
| DB会话混乱 | 12个文件37处 | 高 | 每个函数自建SessionLocal()，SQLite并发写入冲突 |

### 0.2 分层评估 — 跨层调用

**API 层直接操作数据库**（最突出的分层违规）：
- `conversations.py` 直接导入并使用 `SessionLocal` 进行数据库查询
- `sessions.py` 直接查询 `ExecutionNode` 和 `Conversation` 模型
- `executions.py` 同时使用 `ExecutionRepository` 和直接 `SessionLocal()`
- `triggers.py` 直接使用 `SessionLocal()` 进行 6 次数据库操作

**核心层直接创建数据库会话**：
- `workflow_engine.py` 的 `execute_node()` 方法自己创建 `SessionLocal()`
- `scheduler.py` 中的 `_execute_workflow_job` 函数直接操作数据库

**Repository 层形同虚设**：`ExecutionRepository` 只被两个文件引用，其余所有数据库操作都绕过它直接使用 `SessionLocal()`。

### 0.3 耦合度分析

**workflow_engine.py** 导入了 8 个内部模块，被 `conversations.py`, `scheduler.py`, `container.py` 依赖，修改任何接口都会波及至少 3 个文件。

**conversations.py** 同时依赖 `container` 和 `session_manager` 两个不同的依赖注入机制，修改对话功能可能影响工作流执行、会话管理和后台任务。

**跨技术栈耦合**：`agents/lib/` (TypeScript) 和 `main/` (Python) 通过 opencode CLI 子进程耦合，调试链路极长。

**前端耦合**：`ChatPage.tsx` (833行)、`WorkflowEditor.tsx` (1563行)、`AgentsPage.tsx` (941行) 直接包含业务逻辑，没有状态管理库、没有自定义 hooks。

### 0.4 重构优先级（Top 5）

1. **拆分 conversations.py** — 痛苦指数：极高
2. **统一数据库会话管理** — 痛苦指数：高
3. **消除全局状态，完成 DI 容器落地** — 痛苦指数：高
4. **拆分 workflow_engine.py 的 execute_node** — 痛苦指数：中高
5. **建立前端 API 客户端层** — 痛苦指数：中

---

## 一、前置条件与安全网（第 1 周）

### 1.1 关键路径集成测试（最高优先级）

在任何重构前，必须先为现有功能编写集成测试，作为重构的安全网。

| 测试文件 | 覆盖范围 | 最低用例数 |
|----------|----------|------------|
| `tests/integration/test_conversation_flow.py` | 创建对话 → 发送消息 → 获取回复 | 3 |
| `tests/integration/test_workflow_flow.py` | 创建工作流 → 触发执行 → 查看结果 | 3 |
| `tests/integration/test_scheduled_workflow.py` | 创建工作流 → 设置定时 → 手动触发 | 2 |
| `tests/integration/test_dispatch_flow.py` | Agent 直接调度（同步/并行） | 2 |

**验收标准**：10-15 个集成测试全部通过，覆盖 conversations / workflows / scheduler / dispatch 四个核心模块。

#### 集成测试代码示例

```python
# tests/integration/test_conversation_flow.py
import pytest
import asyncio
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_create_conversation(client: AsyncClient):
    """创建对话"""
    response = await client.post("/api/v1/conversations/", json={
        "title": "测试对话",
        "agent": "fin-orchestrator"
    })
    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert data["title"] == "测试对话"
    return data["id"]

@pytest.mark.asyncio
async def test_send_agent_message(client: AsyncClient):
    """发送 Agent 消息并获取回复"""
    conv_id = await test_create_conversation(client)

    response = await client.post(f"/api/v1/conversations/{conv_id}/messages", json={
        "content": "大盘今天怎么样",
        "mode": "agent"
    })
    assert response.status_code == 200
    task_id = response.json()["task_id"]

    # 轮询等待回复（最多 60 秒）
    for _ in range(120):
        response = await client.get(f"/api/v1/conversations/{conv_id}/messages")
        messages = response.json()
        if len(messages) > 1:
            assert messages[-1]["role"] == "assistant"
            break
        await asyncio.sleep(0.5)
    else:
        pytest.fail("Agent 回复超时")
```

```python
# tests/integration/test_workflow_flow.py
@pytest.mark.asyncio
async def test_create_and_execute_workflow(client: AsyncClient):
    """创建简单工作流并执行"""
    response = await client.post("/api/v1/workflows/", json={
        "name": "测试工作流",
        "nodes": [
            {"id": "n1", "type": "agent", "agent": "macro-scout", "prompt": "查看大盘"},
            {"id": "n2", "type": "agent", "agent": "technical-chartist", "prompt": "分析上证指数"}
        ],
        "edges": [{"source": "n1", "target": "n2"}]
    })
    assert response.status_code == 200
    workflow_id = response.json()["id"]

    response = await client.post(f"/api/workflows/{workflow_id}/trigger")
    assert response.status_code == 200
    execution_id = response.json()["execution_id"]

    for _ in range(120):
        response = await client.get(f"/api/v1/executions/{execution_id}")
        status = response.json()["status"]
        if status in ("completed", "failed"):
            assert status == "completed"
            break
        await asyncio.sleep(1)
    else:
        pytest.fail("工作流执行超时")
```

```python
# tests/integration/test_scheduled_workflow.py
@pytest.mark.asyncio
async def test_scheduled_workflow(client: AsyncClient):
    """定时工作流设置与触发"""
    workflow_id = await create_test_workflow(client)

    response = await client.post(f"/api/v1/workflows/{workflow_id}/schedule", json={
        "cron_expression": "0 9 * * 1-5"
    })
    assert response.status_code == 200

    response = await client.get("/api/v1/workflows/scheduled")
    scheduled = response.json()
    assert any(w["id"] == workflow_id for w in scheduled)
```

#### 测试目录结构

```
tests/
├── conftest.py              # pytest fixtures（client, db_session 等）
├── integration/
│   ├── test_conversation_flow.py
│   ├── test_workflow_flow.py
│   ├── test_scheduled_workflow.py
│   └── test_dispatch_flow.py
├── unit/
│   ├── services/
│   │   ├── test_conversation_service.py
│   │   ├── test_workflow_service.py
│   │   └── test_execution_service.py
│   ├── repositories/
│   │   ├── test_execution_repository.py
│   │   └── test_conversation_repository.py
│   └── core/
│       ├── test_workflow_parser.py
│       └── test_retry_handler.py
└── e2e/
    └── test_full_analysis.py
```

#### 测试执行计划

| 阶段 | 测试类型 | 数量目标 | 执行频率 |
|------|----------|----------|----------|
| 重构前 | 集成测试 | 10-15 个 | 每次提交 |
| 重构中 | 单元测试 | 50-80 个 | 每个 PR |
| 重构后 | 全量测试 | 100+ 个 | CI/CD 自动 |

### 1.2 测试基础设施

```
tests/
├── conftest.py              # pytest fixtures（client, db_session）
├── integration/             # 集成测试（重构前安全网）
│   ├── test_conversation_flow.py
│   ├── test_workflow_flow.py
│   ├── test_scheduled_workflow.py
│   └── test_dispatch_flow.py
├── unit/                    # 单元测试（重构后补充）
└── e2e/                     # 端到端测试（最终验收）
```

### 1.3 SQLite 并发方案落地

**问题根源**：
- `workflow_engine.py` 并行节点同时写入
- `conversations.py` 创建嵌套 Session（`db2 = SessionLocal()`）
- 默认 journal mode 不支持并发读写

**实施方案**：SQLite WAL 模式 + busy_timeout

```python
# config/database.py
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()
```

**验收标准**：WAL 模式生效，并行写入不再报 `database is locked`。

### 1.4 写队列（可选，高并发场景启用）

```python
# repositories/write_queue.py
import asyncio

class WriteQueue:
    """串行化所有写操作，避免 SQLite 写锁冲突"""

    def __init__(self):
        self._queue: asyncio.Queue = asyncio.Queue()
        self._running = False

    async def enqueue(self, func, *args, **kwargs):
        future = asyncio.get_event_loop().create_future()
        await self._queue.put((func, args, kwargs, future))
        return await future

    async def start(self):
        self._running = True
        while self._running:
            func, args, kwargs, future = await self._queue.get()
            try:
                result = func(*args, **kwargs)
                future.set_result(result)
            except Exception as e:
                future.set_exception(e)

_write_queue = WriteQueue()

class BaseRepository(Generic[T]):
    def __init__(self, model: Type[T], db_factory: Callable):
        self._model = model
        self._db_factory = db_factory

    def _write(self, operation):
        return _write_queue.enqueue(operation)
```

### 1.5 Repository 层会话管理规则

| 场景 | 策略 |
|------|------|
| 读操作 | 直接使用注入的 Session，不创建新 Session |
| 单次写操作 | 使用注入的 Session，Repository 方法结束时 commit |
| 批量写操作 | 使用 `db.begin()` 上下文管理器，全部成功才 commit |
| 跨 Repository 写操作 | Service 层管理事务，通过 UnitOfWork 模式 |
| 并行节点写入 | WAL 模式 + busy_timeout=5000 自动重试 |

### 1.6 UnitOfWork 跨 Repository 事务

```python
# services/unit_of_work.py
from typing import TypeVar, Type, Dict
from sqlalchemy.orm import Session

T = TypeVar("T")

class UnitOfWork:
    def __init__(self, db: Session):
        self._db = db
        self._repos: Dict[str, BaseRepository] = {}

    def __enter__(self):
        self._transaction = self._db.begin()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self._transaction.rollback()
        else:
            self._transaction.commit()

    def repository(self, name: str, model: Type[T]) -> BaseRepository[T]:
        if name not in self._repos:
            self._repos[name] = BaseRepository(model, self._db)
        return self._repos[name]
```

---

## 二、配置层与基础设施（第 2 周）

### 2.1 创建 config/ 目录

| 文件 | 职责 | 从何处迁移 |
|------|------|------------|
| `config/settings.py` | `Settings(BaseSettings)` 统一配置 | `framework/config.py` |
| `config/constants.py` | 业务常量（阈值、限制、默认值） | 散落各处的魔法数字 |
| `config/database.py` | 引擎、SessionLocal、get_db | `framework/models/database.py` |

### 2.2 增强 DI 容器

```python
# core/container.py — 增强版
class Container:
    _services: Dict[Type, Any] = {}
    _factories: Dict[Type, Callable] = {}
    _singletons: Dict[Type, Any] = {}

    def register_singleton(self, interface, implementation): ...
    def register_factory(self, interface, factory): ...
    def get(self, interface) -> T: ...

def get_service(interface: Type[T]) -> Callable:
    """FastAPI Depends 工厂"""
    def dependency():
        return _container.get(interface)
    return dependency
```

### 2.3 创建 Repository 泛型基类

```python
# repositories/base.py
class BaseRepository(Generic[T]):
    def __init__(self, model: Type[T], db: Session): ...
    def get(self, id: str) -> Optional[T]: ...
    def list(self, **filters) -> List[T]: ...
    def create(self, **kwargs) -> T: ...
    def update(self, id: str, **kwargs) -> Optional[T]: ...
    def delete(self, id: str) -> bool: ...
```

### 2.4 自动化防护工具

| 工具 | 配置文件 | 用途 |
|------|----------|------|
| ruff | `pyproject.toml` | Python 代码检查（max-lines=500） |
| ESLint | `webui/.eslintrc.json` | TS/TSX 代码检查（禁止直接 fetch） |
| pre-commit | `.pre-commit-config.yaml` | 提交时自动检查 |
| 分层检测 | `scripts/check_dependencies.py` | 检测跨层违规 import |
| 行数检查 | `scripts/check_lines.py` | 检测超 500 行文件 |

#### 2.4.1 ESLint 配置

```jsonc
// webui/.eslintrc.json
{
  "rules": {
    "max-lines": ["error", { "max": 500, "skipBlankLines": true, "skipComments": true }],
    "max-lines-per-function": ["error", { "max": 50, "skipBlankLines": true }],
    "no-magic-numbers": ["warn", { "ignore": [0, 1, -1, 200, 404, 500] }],
    "no-restricted-imports": ["error", {
      "paths": [{
        "name": "axios",
        "message": "请使用 @/api/client 统一请求"
      }]
    }],
    "no-restricted-syntax": ["error", {
      "selector": "CallExpression[callee.name='fetch']",
      "message": "禁止直接使用 fetch，请使用 @/api 模块"
    }]
  }
}
```

#### 2.4.2 Python ruff 配置

```toml
# pyproject.toml
[tool.ruff]
line-length = 120
max-lines = 500

[tool.ruff.lint]
select = ["E", "W", "F", "C", "I", "N", "UP"]

[tool.ruff.lint.per-file-ignores]
"main/controllers/*.py" = ["C901"]

[tool.ruff.lint.mccabe]
max-complexity = 10
```

#### 2.4.3 Pre-commit Hook

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: check-file-lines
        name: Check file line count
        entry: python scripts/check_lines.py
        language: system
        files: \.(py|ts|tsx)$

      - id: ruff-check
        name: Ruff lint
        entry: ruff check
        language: system
        files: \.py$

      - id: eslint-check
        name: ESLint check
        entry: npx eslint
        language: system
        files: \.(ts|tsx)$

      - id: dependency-check
        name: Dependency architecture check
        entry: python scripts/check_dependencies.py
        language: system
        files: \.py$
```

#### 2.4.4 行数检查脚本

```python
# scripts/check_lines.py
import sys
import os

MAX_LINES = 500
EXCLUDE_DIRS = {'node_modules', 'dist', '.git', '__pycache__', 'venv'}

def check_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = len(f.readlines())
    if lines > MAX_LINES:
        print(f"❌ {filepath}: {lines} 行 (超过 {MAX_LINES} 行限制)")
        return False
    return True

def main():
    failed = False
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for file in files:
            if file.endswith(('.py', '.ts', '.tsx')):
                filepath = os.path.join(root, file)
                if not check_file(filepath):
                    failed = True
    sys.exit(1 if failed else 0)

if __name__ == '__main__':
    main()
```

#### 2.4.5 分层依赖检测脚本

```python
# scripts/check_dependencies.py
"""
检测规则：
1. controllers/ 不得直接 import models/ 中的 ORM 模型（应通过 Service）
2. controllers/ 不得直接使用 SessionLocal
3. services/ 不得直接使用 SessionLocal
4. 不得跨模块访问私有成员（以 _ 开头）
"""
import ast
import sys
from pathlib import Path

RULES = [
    {
        "name": "Controller 不得直接操作数据库",
        "source_dir": "main/controllers",
        "forbidden_imports": ["SessionLocal", "sqlalchemy"],
        "pattern": "controllers 不应直接导入数据库相关模块"
    },
    {
        "name": "Service 不得直接操作数据库",
        "source_dir": "main/services",
        "forbidden_imports": ["SessionLocal"],
        "pattern": "services 不应直接使用 SessionLocal，应通过 Repository"
    },
]

def check_imports(filepath, forbidden):
    with open(filepath, 'r') as f:
        tree = ast.parse(f.read())
    violations = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if any(f in alias.name for f in forbidden):
                    violations.append(f"  行 {node.lineno}: import {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            if node.module and any(f in node.module for f in forbidden):
                violations.append(f"  行 {node.lineno}: from {node.module} import ...")
    return violations

def main():
    failed = False
    for rule in RULES:
        path = Path(rule["source_dir"])
        if not path.exists():
            continue
        for py_file in path.glob("**/*.py"):
            violations = check_imports(py_file, rule["forbidden_imports"])
            if violations:
                print(f"❌ {rule['name']}: {py_file}")
                for v in violations:
                    print(v)
                failed = True
    sys.exit(1 if failed else 0)

if __name__ == '__main__':
    main()
```

---

## 三、后端 Repository 层建设（第 3 周）

### 3.1 实现各领域 Repository

| Repository | 覆盖模型 | 核心方法 |
|------------|----------|----------|
| `agent_repo.py` | Agent | get / list / create / update |
| `workflow_repo.py` | Workflow | get / list / create / update / delete |
| `execution_repo.py` | WorkflowExecution + ExecutionNode | get / list / create / update_node / get_node |
| `conversation_repo.py` | Conversation + Message | get / list / create / add_message / get_messages |
| `maintenance_repo.py` | 维护相关模型 | get / list / create / update |

### 3.2 消除散落的 SessionLocal() 调用

**当前状态**：37 处 `SessionLocal()` 调用分散在 12 个文件中。

**目标状态**：仅 `config/database.py` 中定义 `SessionLocal`，所有数据操作通过 Repository。

**修改清单**：

| 文件 | 当前 SessionLocal 调用数 | 修改方式 |
|------|--------------------------|----------|
| `conversations.py` | 多处 | 改用 ConversationRepository |
| `workflow_engine.py` | 每个方法各自创建 | 注入 Repository |
| `executions.py` | 混用 Repository + 直接调用 | 统一用 Repository |
| `sessions.py` | 直接查询 | 改用 SessionRepository |
| `triggers.py` | 6 处直接操作 | 改用 WorkflowRepository |
| `scheduler.py` | 直接操作 models | 改用 ExecutionRepository |
| 其余 6 个文件 | 各 1-2 处 | 改用对应 Repository |

### 3.3 API 端点统一使用 Depends(get_db)

所有 12 个路由模块的数据库操作改为通过 FastAPI 依赖注入：

```python
@router.get("/api/v1/conversations/{id}")
async def get_conversation(
    id: str,
    repo: ConversationRepository = Depends(get_service(ConversationRepository))
):
    return repo.get(id)
```

---

## 四、Phase 1 验收清单

### 基础设施

- [ ] 10-15 个集成测试全部通过
- [ ] SQLite WAL 模式生效（`PRAGMA journal_mode=WAL`）
- [ ] `config/` 目录创建完成（settings / constants / database）
- [ ] `BaseRepository[T]` 泛型基类可实例化
- [ ] DI 容器支持 singleton / factory 注册
- [ ] ruff + ESLint 规则配置完成
- [ ] pre-commit hooks 可运行
- [ ] 分层检测脚本可运行

### 数据访问层

- [ ] 5 个 Repository 全部实现并可独立单元测试
- [ ] `grep -r "SessionLocal()" main/ --include="*.py"` 仅在 `database.py` 中有结果
- [ ] 所有 API 端点通过 `Depends(get_db)` 获取数据库会话
- [ ] 分层检测脚本 0 violation

### 功能验证

- [ ] 所有集成测试仍然通过（重构未破坏现有功能）
- [ ] 工作流创建、编辑、执行正常
- [ ] 对话功能正常（Agent 模式 + Workflow 模式）
- [ ] 定时任务正常
