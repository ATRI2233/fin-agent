# Phase 2：业务逻辑拆分与依赖治理

> 目标：提取 Service 层、拆分 God Object、消除全局状态、完成后端分层
> 预计周期：3 周（原蓝图阶段 2 + 阶段 3）
> 前置条件：Phase 1 全部完成

---

## 一、后端 Service 层建设（第 4-5 周）

### 1.1 提取 Service 模块

| Service | 提取来源 | 核心职责 |
|---------|----------|----------|
| `conversation_service.py` | `conversations.py` (610行) | 对话 CRUD、消息分发（Agent/Workflow） |
| `workflow_service.py` | `workflows.py` + `workflow_engine.py` | 工作流 CRUD、触发执行 |
| `execution_service.py` | `executions.py` | 执行记录查询、重试 |
| `scheduler_service.py` | `scheduler.py` | 定时任务管理 |
| `debate_service.py` | `debate_executor.py` | 多 Agent 辩论逻辑 |
| `maintenance_service.py` | `data_maintenance/core/` | 数据维护业务逻辑 |

### 1.2 拆分 conversations.py（痛苦指数：极高）

**现状**：610 行，同时承载路由、会话管理、业务编排、后台任务四种职责。

**拆分方案**：

| 提取内容 | 目标文件 | 原始行范围 |
|----------|----------|------------|
| `ConvSessionManager` 类 | `services/conversation_service.py` | 行 65-126 |
| `_process_agent_message` 函数 | `services/message_processor.py` | 行 165-233 |
| `_execute_workflow_async` 函数 | `services/message_processor.py` | 行 236-358 |
| Pydantic 模型 | `schemas/conversation.py` | 行 26-59 |
| API 路由 | `controllers/conversations.py`（精简） | 行 364-609 |

**目标**：`conversations.py` 从 610 行降至 **150 行以下**。

### 1.3 拆分 workflow_engine.py 的 execute_node（痛苦指数：中高）

**现状**：`execute_node` 方法 162 行，包含 4 种节点类型的处理逻辑。

**拆分方案 — 策略模式**：

```
core/workflow/node_executors/
├── base.py              # NodeExecutor 抽象接口
├── agent_executor.py    # Agent 节点执行
├── debate_executor.py   # Debate 节点执行
├── io_executor.py       # Input/Output 节点执行
└── registry.py          # 执行器注册表
```

```python
# node_executors/base.py
class NodeExecutor(ABC):
    @abstractmethod
    async def execute(self, node: ExecutionNode, context: ExecutionContext) -> NodeResult: ...

# workflow/engine.py — 精简后的 execute_node
async def execute_node(self, node, context):
    executor = self._executor_registry.get(node.type)
    return await executor.execute(node, context)
```

**目标**：`workflow_engine.py` 从 603 行降至 **300 行以下**。

### 1.4 Controller 层精简为纯路由

**规范**：
- 每个端点函数不超过 20 行
- 参数校验使用 Pydantic Schema
- 业务逻辑全部委托给 Service
- 异常统一由全局异常处理器捕获

**目标**：所有 Controller 文件不超过 **200 行**。

#### Controller 完整示例

```python
# controllers/conversations.py
from fastapi import APIRouter, Depends, HTTPException
from ..services.conversation_service import ConversationService
from ..core.container import get_service
from ..schemas.conversation import (
    CreateConversationRequest,
    ConversationResponse,
    SendMessageRequest
)

router = APIRouter(prefix="/api/v1/conversations", tags=["conversations"])

@router.post("/", response_model=ConversationResponse)
async def create_conversation(
    request: CreateConversationRequest,
    service: ConversationService = Depends(get_service(ConversationService))
):
    """创建对话 — 仅做参数校验与响应封装"""
    return service.create(request)

@router.post("/{id}/messages")
async def send_message(
    id: str,
    request: SendMessageRequest,
    service: ConversationService = Depends(get_service(ConversationService))
):
    """发送消息 — 异步处理，返回任务 ID"""
    task_id = service.send_message(id, request)
    return {"task_id": task_id, "status": "processing"}
```

#### Service 完整示例

```python
# services/conversation_service.py
from ..repositories.conversation_repo import ConversationRepository
from ..repositories.execution_repo import ExecutionRepository
from ..core.protocols import AgentBackend
from ..core.workflow_engine import WorkflowEngine

class ConversationService:
    def __init__(
        self,
        conv_repo: ConversationRepository,
        exec_repo: ExecutionRepository,
        backend: AgentBackend,
        engine_factory: callable
    ):
        self._conv_repo = conv_repo
        self._exec_repo = exec_repo
        self._backend = backend
        self._engine_factory = engine_factory

    def create(self, request) -> ConversationResponse:
        """创建对话"""
        conversation = self._conv_repo.create(title=request.title)
        return ConversationResponse.from_model(conversation)

    def send_message(self, conv_id: str, request) -> str:
        """发送消息 — 根据模式分发"""
        conversation = self._conv_repo.get(conv_id)
        if request.mode == "agent":
            return self._send_agent_message(conversation, request)
        elif request.mode == "workflow":
            return self._execute_workflow(conversation, request)
```

#### Repository 完整示例

```python
# repositories/base.py — 泛型基类
from typing import TypeVar, Generic, Type, Optional, List
from sqlalchemy.orm import Session

T = TypeVar("T")

class BaseRepository(Generic[T]):
    def __init__(self, model: Type[T], db: Session):
        self._model = model
        self._db = db

    def get(self, id: str) -> Optional[T]:
        return self._db.query(self._model).filter(self._model.id == id).first()

    def list(self, **filters) -> List[T]:
        query = self._db.query(self._model)
        for key, value in filters.items():
            query = query.filter(getattr(self._model, key) == value)
        return query.all()

    def create(self, **kwargs) -> T:
        obj = self._model(**kwargs)
        self._db.add(obj)
        self._db.commit()
        self._db.refresh(obj)
        return obj

    def update(self, id: str, **kwargs) -> Optional[T]:
        obj = self.get(id)
        if obj:
            for key, value in kwargs.items():
                setattr(obj, key, value)
            self._db.commit()
            self._db.refresh(obj)
        return obj

    def delete(self, id: str) -> bool:
        obj = self.get(id)
        if obj:
            self._db.delete(obj)
            self._db.commit()
            return True
        return False
```

---

## 二、全局状态与依赖治理（第 6 周）

### 2.1 消除全局变量

| 文件 | 全局变量 | 替换方案 |
|------|----------|----------|
| `scheduler.py` | `_engine_factory` | 移入 Container，通过 `get_service(EngineFactory)` 获取 |
| `session_cleanup.py` | `_backend`, `_active_sessions` | 移入 Container，SessionRegistry 作为单例注册 |
| `conversations.py` | `session_manager` | 移入 ConversationService |
| `data_maintenance.py` | `_dispatcher`, `_scheduler` | 移入 Container |

### 2.2 消除 configure() 函数

所有模块级 `configure()` 函数删除，依赖通过构造函数注入：

| 文件 | configure 函数 | 删除后 |
|------|---------------|--------|
| `scheduler.py` | `configure(engine_factory)` | 构造函数注入 |
| `session_cleanup.py` | `configure(backend)` | 构造函数注入 |
| `conversations.py` | `configure_session_manager()` | 移入 Service |
| `data_maintenance.py` | `configure(dispatcher, scheduler)` | 构造函数注入 |

### 2.3 消除重复函数

`_find_opencode_bin()` 在 `config.py` 和 `process_pool.py` 中重复实现：
- 保留在 `config/settings.py` 中
- `process_pool.py` 改为从 config 导入

### 2.4 Container 注册顺序（拓扑排序）

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

### 2.5 main.py 瘦身

```python
# main.py — 最终形态
from .core.container import configure_container

app = FastAPI()

@app.on_event("startup")
async def startup():
    configure_container()

# 路由注册
app.include_router(conversations_router)
app.include_router(workflows_router)
# ...
```

---

## 三、分层后目标目录结构

```
main/
├── config/                  # 配置层（3 文件）
│   ├── settings.py
│   ├── constants.py
│   └── database.py
├── models/                  # Model 层（5 文件）
├── repositories/            # Repository 层（6 文件）
├── services/                # Service 层（7 文件）
├── controllers/             # Controller 层（按领域分组）
│   ├── conversations/       # 对话域（3 文件）
│   ├── workflows/           # 工作流域（4 文件）
│   ├── resources/           # 资源域（3 文件）
│   └── system.py
├── core/                    # 核心引擎
│   ├── agent/               # Agent 调度域（3 文件）
│   ├── workflow/            # 工作流引擎域（3 + 4 文件）
│   ├── session/             # Session 管理域（2 文件）
│   ├── infra/               # 基础设施（4 文件）
│   └── utils/               # 工具模块（6 文件）
├── middleware/               # 中间件（1 文件）
├── session/                 # OpenCode 执行层（3 文件）
├── data_maintenance/        # 数据维护子系统
└── main.py                  # FastAPI 入口（精简）
```

---

## 四、Phase 2 验收清单

### Service 层

- [ ] 6 个 Service 全部实现
- [ ] 所有 Service 通过构造函数注入依赖（无直接 SessionLocal）
- [ ] 所有 Service 可独立单元测试（mock Repository）

### God Object 拆分

- [ ] `conversations.py` ≤ 150 行（从 610 行）
- [ ] `workflow_engine.py` ≤ 300 行（从 603 行）
- [ ] `execute_node` 方法拆分为 4 个独立 Executor
- [ ] 后台任务函数提取到 `message_processor.py`

### 全局状态治理

- [ ] `grep -r "configure(" main/ --include="*.py"` 返回 0 结果
- [ ] `grep -r "_engine_factory\|_backend\|_active_sessions\|_dispatcher\|_scheduler" main/ --include="*.py"` 仅在 Container 中出现
- [ ] `_find_opencode_bin` 仅保留一份
- [ ] 所有模块通过构造函数注入依赖

### Controller 层

- [ ] 所有 Controller 文件 ≤ 200 行
- [ ] 每个端点函数 ≤ 20 行
- [ ] Controller 层无直接数据库操作
- [ ] 分层检测脚本全部通过

### 功能验证

- [ ] Phase 1 的所有集成测试仍然通过
- [ ] 新增 Service 层单元测试 50+ 个
- [ ] 全量 API 端点正常响应

---

## 附录：分层单元测试代码示例

### Service 层单元测试

```python
# tests/unit/test_conversation_service.py
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

### Repository 层单元测试

```python
# tests/unit/test_execution_repository.py
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
