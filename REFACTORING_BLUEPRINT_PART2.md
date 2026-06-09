# fin-agent 重构执行蓝图 — Part 2：治理与前置条件

> 本文档包含第五~七章：全局状态与依赖治理、自动化防护工具配置、重构前置条件
> 全局限制（架构规范总则）请参见 Part 1

---


## 目录

- [一、架构规范总则](#一架构规范总则)
- [二、后端分层架构规范](#二后端分层架构规范)
- [三、前端分层架构规范](#三前端分层架构规范)
- [四、重构后完整目录结构](#四重构后完整目录结构)
- [五、全局状态与依赖治理](#五全局状态与依赖治理)
- [六、自动化防护工具配置](#六自动化防护工具配置)
- [七、重构前置条件（依赖图 + 并发方案 + 测试策略）](#七重构前置条件依赖图--并发方案--测试策略)
- [八、重构执行计划（7 阶段）](#八重构执行计划7-阶段)
- [九、验收标准与检查清单](#九验收标准与检查清单)

---

## 一、架构规范总则

### 1.1 单一职责原则

- 所有文件/模块行数 **不超过 500 行**（硬性上限）
- 单个文件仅承担 **一项核心职责**
- 严禁出现 God Object
- 禁止单一文件同时处理 CRUD、日志、缓存等多项职责

### 1.2 依赖倒置原则

- 高层模块依赖 **抽象接口** 而非低层模块
- 严禁 API 层直接操作数据库
- 所有数据操作必须通过 Service → Repository 中间层隔离

### 1.3 彻底消除硬编码

- API 地址 → `config/` 或 `.env`
- 阈值/常量 → `config/constants.py` / `config/constants.ts`
- 密钥 → `.env`（不入版本控制）
- 样式色值 → CSS 变量 / 主题配置文件
- 魔法数字与字符串 → 命名常量

### 1.4 明确模块边界

- 模块间仅通过定义好的接口通信
- 禁止直接访问其他模块内部全局变量、私有方法
- 跨模块调用必须通过依赖注入或事件总线

---

## 五、全局状态与依赖治理

### 5.1 后端 DI 容器

```python
# core/container.py — 增强版
from typing import TypeVar, Type, Callable, Dict, Any
from functools import lru_cache

T = TypeVar("T")

class Container:
    """依赖注入容器 — 管理所有服务实例"""

    def __init__(self):
        self._services: Dict[Type, Any] = {}
        self._factories: Dict[Type, Callable] = {}
        self._singletons: Dict[Type, Any] = {}

    def register_singleton(self, interface: Type[T], implementation: T):
        """注册单例服务"""
        self._singletons[interface] = implementation

    def register_factory(self, interface: Type[T], factory: Callable[[], T]):
        """注册工厂函数"""
        self._factories[interface] = factory

    def get(self, interface: Type[T]) -> T:
        """获取服务实例"""
        # 优先返回单例
        if interface in self._singletons:
            return self._singletons[interface]
        # 使用工厂创建
        if interface in self._factories:
            return self._factories[interface]()
        raise ValueError(f"Service {interface} not registered")

# 全局容器实例
_container = Container()

def get_container() -> Container:
    return _container

def get_service(interface: Type[T]) -> Callable:
    """FastAPI Depends 工厂"""
    def dependency():
        return _container.get(interface)
    return dependency
```

### 5.2 容器初始化

```python
# main.py — startup 事件
from .core.container import get_container
from .config.database import SessionLocal
from .repositories import *
from .services import *

def configure_container():
    """配置依赖注入容器"""
    container = get_container()

    # 注册数据库会话工厂
    container.register_factory(SessionLocal, SessionLocal)

    # 注册 Repository
    container.register_factory(
        ConversationRepository,
        lambda: ConversationRepository(SessionLocal())
    )
    # ... 其他 Repository

    # 注册 Service
    container.register_singleton(
        ConversationService,
        ConversationService(
            conv_repo=container.get(ConversationRepository),
            exec_repo=container.get(ExecutionRepository),
            backend=container.get(AgentBackend),
        )
    )
    # ... 其他 Service

app = FastAPI()

@app.on_event("startup")
async def startup():
    configure_container()
```

### 5.3 消除全局状态清单

| 文件 | 全局变量 | 替换方案 |
|------|----------|----------|
| `scheduler.py` | `_engine_factory` | 移入 Container，通过 `get_service(EngineFactory)` 获取 |
| `session_cleanup.py` | `_backend`, `_active_sessions` | 移入 Container，SessionRegistry 作为单例注册 |
| `conversations.py` | `session_manager` | 移入 ConversationService |
| `data_maintenance.py` | `_dispatcher`, `_scheduler` | 移入 Container |

### 5.4 前端状态管理

- 使用 **Zustand** 替代组件内 useState 管理全局状态
- 每个领域创建独立 Store（conversationStore、workflowStore 等）
- Store 通过 Hooks 暴露给组件，组件不直接修改 Store 内部状态

---

## 六、自动化防护工具配置

### 6.1 ESLint 配置

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

### 6.2 Python 代码检查

```toml
# pyproject.toml — ruff 配置
[tool.ruff]
line-length = 120
max-lines = 500

[tool.ruff.lint]
select = [
    "E",    # pycodestyle errors
    "W",    # pycodestyle warnings
    "F",    # pyflakes
    "C",    # conventions
    "I",    # isort
    "N",    # naming
    "UP",   # pyupgrade
]

[tool.ruff.lint.per-file-ignores]
"main/controllers/*.py" = ["C901"]  # 允许路由文件稍复杂

[tool.ruff.lint.mccabe]
max-complexity = 10
```

### 6.3 Pre-commit Hook

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

```python
# scripts/check_lines.py — 行数检查脚本
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

### 6.4 依赖架构检测

```python
# scripts/check_dependencies.py — 分层依赖检测
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

## 七、重构前置条件（依赖图 + 并发方案 + 测试策略）

> ⚠️ 以下三项是重构的**安全网**，必须在动手前完成，否则重构就是在裸奔。

### 7.1 后端依赖关系图分析

#### 6.1.1 当前依赖关系（问题诊断）

通过分析 `main/` 目录下所有 Python 文件的 import 语句，得出以下依赖关系：

```
main.py (入口)
├── framework/main.py (FastAPI app)
│   ├── framework/api/* (12 个路由模块)
│   │   ├── conversations.py ──→ models, core/workflow_engine, core/container, SessionLocal
│   │   ├── workflows.py ──→ models, core/workflow_parser, core/container
│   │   ├── executions.py ──→ repositories/execution_repo, models, SessionLocal
│   │   ├── sessions.py ──→ models, SessionLocal
│   │   ├── triggers.py ──→ models, core/container, SessionLocal
│   │   ├── dispatch.py ──→ core/agent_dispatcher, core/container
│   │   ├── scheduler_routes.py ──→ core/scheduler
│   │   └── ... (其余路由)
│   │
│   ├── framework/core/* (16 个核心模块)
│   │   ├── workflow_engine.py ──→ models, agent_dispatcher, debate_executor, retry_handler, workflow_parser, SessionLocal
│   │   ├── agent_dispatcher.py ──→ protocols (AgentBackend)
│   │   ├── scheduler.py ──→ workflow_engine (延迟), SessionLocal, models
│   │   ├── container.py ──→ config, hapi_bridge/session
│   │   ├── session_cleanup.py ──→ protocols (AgentBackend) [全局 _backend, _active_sessions]
│   │   └── ...
│   │
│   └── framework/config.py ──→ Settings, _find_opencode_bin()
│
├── session/* (Agent 执行层)
│   ├── opencode_backend.py ──→ process_pool
│   └── process_pool.py ──→ _find_opencode_bin() (与 config.py 重复)
│
└── data_maintenance/* (独立子系统)
    └── core/data_maintenance.py ──→ framework/core/agent_dispatcher [全局 _dispatcher, _scheduler]
```

#### 6.1.2 已识别的循环依赖风险

| 风险点 | 说明 |
|--------|------|
| `conversations.py` ↔ `workflow_engine.py` | conversations 延迟导入 WorkflowEngine，WorkflowEngine 被 conversations 间接调用 |
| `scheduler.py` → `workflow_engine.py` → `models` | scheduler 通过引擎工厂间接依赖 models，同时自己也直接操作 models |
| `container.py` → `session/` → `config.py` | 容器创建 backend 实例，backend 依赖 config 中的路径查找 |

#### 6.1.3 DI Container 初始化顺序（拓扑排序）

```
Level 0: config/settings.py (无依赖)
Level 1: config/database.py (依赖 settings)
Level 2: models/* (依赖 database)
Level 3: repositories/* (依赖 models + database)
Level 4: session/opencode_backend (依赖 config)
Level 5: core/agent_dispatcher (依赖 session/backend)
Level 6: services/* (依赖 repositories + agent_dispatcher)
Level 7: core/workflow_engine (依赖 services + agent_dispatcher)
Level 8: core/scheduler (依赖 workflow_engine)
Level 9: controllers/* (依赖 services)
Level 10: main.py (组装所有)
```

**Container 注册顺序必须严格按此拓扑序执行，否则会触发未初始化依赖。**

### 7.2 SQLite 并发方案

#### 7.2.1 问题分析

当前 SQLite 并发问题的根源：
- `workflow_engine.py` 在并行执行节点时，多个协程同时写入 `execution_nodes` 表
- `conversations.py` 的 `_execute_workflow_async` 创建嵌套 Session（`db2 = SessionLocal()`）
- 默认 journal mode 是 DELETE，不支持并发读写

#### 7.2.2 方案选型：SQLite WAL + 写队列（选定方案）

**不迁移 PostgreSQL**，理由：
- 项目是单机部署的个人工具，不需要分布式
- SQLite 零配置、备份简单（复制文件即可）
- 迁移成本高，收益低

**实施方案：**

```python
# config/database.py — WAL 模式 + 连接池配置
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    pool_size=5,          # 连接池大小
    max_overflow=10,      # 溢出连接数
    pool_pre_ping=True,   # 连接健康检查
)

# 启用 WAL 模式
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")      # 写冲突时等待 5 秒
    cursor.execute("PRAGMA synchronous=NORMAL")      # WAL 模式下安全且更快
    cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
```

```python
# repositories/base.py — 写队列（可选，高并发场景启用）
import asyncio
from contextlib import asynccontextmanager

class WriteQueue:
    """串行化所有写操作，避免 SQLite 写锁冲突"""

    def __init__(self):
        self._queue: asyncio.Queue = asyncio.Queue()
        self._running = False

    async def enqueue(self, func, *args, **kwargs):
        """将写操作加入队列，等待执行完成"""
        future = asyncio.get_event_loop().create_future()
        await self._queue.put((func, args, kwargs, future))
        return await future

    async def start(self):
        """启动写队列消费者"""
        self._running = True
        while self._running:
            func, args, kwargs, future = await self._queue.get()
            try:
                result = func(*args, **kwargs)
                future.set_result(result)
            except Exception as e:
                future.set_exception(e)

# 全局写队列实例
_write_queue = WriteQueue()

class BaseRepository(Generic[T]):
    def __init__(self, model: Type[T], db_factory: Callable):
        self._model = model
        self._db_factory = db_factory

    def _write(self, operation):
        """通过写队列串行化写操作"""
        return _write_queue.enqueue(operation)
```

#### 7.2.3 Repository 层会话管理规则

| 场景 | 策略 |
|------|------|
| 读操作 | 直接使用注入的 Session，不创建新 Session |
| 单次写操作 | 使用注入的 Session，Repository 方法结束时 commit |
| 批量写操作 | 使用 `db.begin()` 上下文管理器，全部成功才 commit |
| 跨 Repository 写操作 | Service 层管理事务，通过 UnitOfWork 模式 |
| 并行节点写入 | WAL 模式 + busy_timeout=5000 自动重试 |

```python
# services/unit_of_work.py — 跨 Repository 事务
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

### 7.3 测试策略

#### 7.3.1 测试金字塔

```
         ╱╲
        ╱E2E╲        少量（5-10 个核心流程）
       ╱──────╲
      ╱ 集成测试 ╲     中量（30-50 个 API 端点）
     ╱────────────╲
    ╱   单元测试    ╲    大量（Service/Repository/工具函数）
   ╱────────────────╲
```

#### 7.3.2 重构前：关键路径集成测试（安全网）

**必须在重构前完成的测试，作为重构的安全网：**

```python
# tests/integration/test_conversation_flow.py
"""
测试路径：创建对话 → 发送消息 → 获取回复
覆盖：conversations.py 的核心流程
"""
import pytest
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

    # 发送消息
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
        if len(messages) > 1:  # 用户消息 + AI 回复
            assert messages[-1]["role"] == "assistant"
            break
        await asyncio.sleep(0.5)
    else:
        pytest.fail("Agent 回复超时")
```

```python
# tests/integration/test_workflow_flow.py
"""
测试路径：创建工作流 → 触发执行 → 查看结果
覆盖：workflows.py + workflow_engine.py 的核心流程
"""
@pytest.mark.asyncio
async def test_create_and_execute_workflow(client: AsyncClient):
    """创建简单工作流并执行"""
    # 创建工作流
    response = await client.post("/api/v1/workflows/", json={
        "name": "测试工作流",
        "nodes": [
            {"id": "n1", "type": "agent", "agent": "macro-scout", "prompt": "查看大盘"},
            {"id": "n2", "type": "agent", "agent": "technical-chartist", "prompt": "分析上证指数"}
        ],
        "edges": [
            {"source": "n1", "target": "n2"}
        ]
    })
    assert response.status_code == 200
    workflow_id = response.json()["id"]

    # 触发执行
    response = await client.post(f"/api/workflows/{workflow_id}/trigger")
    assert response.status_code == 200
    execution_id = response.json()["execution_id"]

    # 等待执行完成
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
"""
测试路径：创建工作流 → 设置定时 → 手动触发验证
覆盖：scheduler_routes.py + scheduler.py 的核心流程
"""
@pytest.mark.asyncio
async def test_scheduled_workflow(client: AsyncClient):
    """定时工作流设置与触发"""
    # 创建工作流
    workflow_id = await create_test_workflow(client)

    # 设置定时
    response = await client.post(f"/api/v1/workflows/{workflow_id}/schedule", json={
        "cron_expression": "0 9 * * 1-5"
    })
    assert response.status_code == 200

    # 验证定时任务已注册
    response = await client.get("/api/v1/workflows/scheduled")
    scheduled = response.json()
    assert any(w["id"] == workflow_id for w in scheduled)
```

#### 7.3.3 重构后：分层单元测试

```python
# tests/unit/test_conversation_service.py
"""
测试 ConversationService 的业务逻辑
mock 所有 Repository 依赖
"""
from unittest.mock import Mock, MagicMock
from main.services.conversation_service import ConversationService

class TestConversationService:
    def setup_method(self):
        self.conv_repo = Mock()
        self.exec_repo = Mock()
        self.backend = Mock()
        self.service = ConversationService(
            conv_repo=self.conv_repo,
            exec_repo=self.exec_repo,
            backend=self.backend
        )

    def test_create_conversation(self):
        """创建对话 — 验证 Repository 调用"""
        self.conv_repo.create.return_value = Mock(id="conv-1", title="测试")
        result = self.service.create(CreateConversationRequest(title="测试"))
        self.conv_repo.create.assert_called_once()
        assert result.id == "conv-1"

    def test_send_message_agent_mode(self):
        """Agent 模式发送消息 — 验证 Backend 调用"""
        self.conv_repo.get.return_value = Mock(id="conv-1", hapi_session_id=None)
        self.backend.create_session.return_value = "session-1"

        self.service.send_message("conv-1", SendMessageRequest(content="你好", mode="agent"))

        self.backend.create_session.assert_called_once()
        self.backend.send_message.assert_called_once()

    def test_send_message_workflow_mode(self):
        """Workflow 模式发送消息 — 验证引擎创建"""
        self.conv_repo.get.return_value = Mock(id="conv-1")
        # ...
```

```python
# tests/unit/test_execution_repository.py
"""
测试 ExecutionRepository 的数据访问逻辑
使用 SQLite 内存数据库
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from main.models import Base
from main.repositories.execution_repo import ExecutionRepository

@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()

class TestExecutionRepository:
    def test_create_execution(self, db_session):
        repo = ExecutionRepository(db_session)
        execution = repo.create(workflow_id="wf-1", status="pending")
        assert execution.id is not None
        assert execution.status == "pending"

    def test_update_node_status(self, db_session):
        repo = ExecutionRepository(db_session)
        execution = repo.create(workflow_id="wf-1")
        repo.update_node(execution.id, "n1", status="completed", output={"result": "ok"})
        node = repo.get_node(execution.id, "n1")
        assert node.status == "completed"
```

#### 7.3.4 测试目录结构

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
    └── test_full_analysis.py   # 端到端：大盘分析完整流程
```

#### 7.3.5 测试执行计划

| 阶段 | 测试类型 | 数量目标 | 执行频率 |
|------|----------|----------|----------|
| 重构前 | 集成测试 | 10-15 个 | 每次提交 |
| 重构中 | 单元测试 | 50-80 个 | 每个 PR |
| 重构后 | 全量测试 | 100+ 个 | CI/CD 自动 |

---

