# TASK-411: main.py - build_registry 全局装配 + uvicorn 进程入口

> **阶段**: Phase 4 · **估时**: 8h · **优先级**: P0（最终集成卡 · 与 TASK-409 配对）
> **上下文窗口**: 5 输入 · 1 输出
> **关联修订**: REVISION_NOTES_2026-06-18.md 修订 **T-5**（DI 注册）+ 修订 **T-11**（engine dispose）+ 修订 **T-10**（DBHealthProbe 注册）
> **范围说明**: 本卡片与 TASK-409 共同拆分原"main.py"职责。TASK-411 拥有 `build_registry()` 与 `__main__` 入口；TASK-409 拥有 `create_app()` 工厂与 `lifespan`。

---

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-411` |
| 所属阶段 | Phase 4 / process entry |
| 前置任务 | **Phase 1**: TASK-007, TASK-009, TASK-010, TASK-011, TASK-013<br>**Phase 2**: TASK-101, TASK-103, TASK-104, TASK-105, TASK-107, TASK-108, TASK-109<br>**Phase 3**: TASK-201, TASK-204, TASK-301, TASK-303, TASK-304, TASK-309, TASK-310<br>**Phase 4**: TASK-401, TASK-403, TASK-404, TASK-409 |
| 后置任务 | TASK-501, TASK-CCC-02, TASK-CCC-03, TASK-CCC-04 |
| 输出文件 | `src/main/main.py` |
| **不输出**（明确划清） | `src/main/api/app.py`（由 TASK-409 拥有） |

## 2. 目标

实现两个唯一职责：
1. **`build_registry(settings) -> Registry`** — 装配所有 Protocol 单例（DB engine / UoW / ToolCatalog / AgentBackend / Dispatcher / ExecutionRecorder / WorkflowRunner / RetryService / ConversationService / DBHealthProbe 等），按设计文档 §6.3 的注册顺序。
2. **`__main__` 入口** — 进程启动：`Settings()` → `validate()` → `build_registry()` → `create_app()` → `uvicorn.run()`。

> **不实现** `create_app()` 与 `lifespan`（在 TASK-409）；本卡片 `import create_app` 即可。

## 3. 上下文范围

### 3.1 输入文件

**架构文档**:
1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §6.3 启动装配, §5.3 启动校验

**Phase 1 基础设施 (5 个)**:
2. `src/main/infra/settings.py` (TASK-007) — `Settings`, `opencode_serve_url`, `validate()`
3. `src/main/infra/db.py` (TASK-009) — `create_engine`, `get_session_local` (工厂函数)
4. `src/main/infra/uow.py` (TASK-010) — `SqlAlchemyUoWFactory`, `UoWFactory`
5. `src/main/infra/di.py` (TASK-011) — `Registry.register_singleton`
6. `src/main/infra/db_health.py` (TASK-013) — `DBHealthProbe`

**Phase 2 MCP + Agent (7 个)**:
7. `src/main/modules/mcp/protocol.py` (TASK-101) — `ToolCatalog` Protocol
8. `src/main/modules/mcp/repo/manifest_loader.py` (TASK-103) — `OpencodeManifestLoader`
9. `src/main/modules/mcp/service/tool_query_service.py` (TASK-104) — `OpencodeJsonToolCatalog`
10. `src/main/modules/agent/protocol.py` (TASK-105) — `AgentBackend`, `AgentDispatcher`, `SessionManager` Protocols
11. `src/main/modules/agent/adapter/serve_backend.py` (TASK-107) — `ServeBackend`
12. `src/main/modules/agent/service/agent_dispatcher.py` (TASK-108) — `DefaultAgentDispatcher`
13. `src/main/modules/agent/service/session_manager.py` (TASK-109) — `InMemorySessionManager`

**Phase 3 Execution + Workflow (7 个)**:
14. `src/main/modules/execution/protocol.py` (TASK-201) — `ExecutionRecorder`, `ExecutionStateReader` Protocols
15. `src/main/modules/execution/service/execution_service.py` (TASK-204) — `SqlAlchemyExecutionRecorder`, `SqlAlchemyExecutionReader`, `DefaultExecutionService`
16. `src/main/modules/workflow/protocol.py` (TASK-301) — `WorkflowReader`, `NodeExecutorFactory`, `WorkflowRunner`, `RetryService`, `CircuitBreaker` Protocols
17. `src/main/modules/workflow/repo/workflow_repo.py` (TASK-303) — `SqlAlchemyWorkflowRepository`
18. `src/main/modules/workflow/executor/registry.py` (TASK-304) — `NodeExecutorRegistry`
19. `src/main/modules/workflow/service/workflow_runner.py` (TASK-309) — `DefaultWorkflowRunner`
20. `src/main/modules/workflow/service/retry_service.py` (TASK-310) — `DefaultRetryService`, `DefaultCircuitBreaker`

**Phase 4 Conversation (3 个 + 配对卡)**:
21. `src/main/modules/conversation/protocol.py` (TASK-401) — `ConversationService` Protocol
22. `src/main/modules/conversation/repo/conversation_repo.py` (TASK-403) — `SqlAlchemyConversationRepository`
23. `src/main/modules/conversation/service/conversation_service.py` (TASK-404) — `DefaultConversationService`
24. `src/main/api/app.py` (TASK-409) — `create_app` (本卡片仅 import)

### 3.2 类型依赖（按 §4.1 build_registry 注册顺序，仅参考顺序）

> 标题说明：本节类型依赖按 §4.1 `build_registry` 的**注册顺序**排列，便于一一对照；**不意味着** TASK-411 必须按此顺序开发或实现任何这些类。

所有 Protocol + 实现类 + import 路径:

# infra
- `infra.settings.Settings` (TASK-007)
- `infra.di.Registry` (TASK-011)
- `infra.db.create_engine, get_session_local` (TASK-009)  # 修正:get_session_local 替代 SessionLocal
- `infra.uow.SqlAlchemyUoWFactory, UoWFactory` (TASK-010)
- `infra.db_health.DBHealthProbe` (TASK-013)

# mcp
- `modules.mcp.protocol.ToolCatalog` (TASK-101)
- `modules.mcp.repo.manifest_loader.OpencodeManifestLoader` (TASK-103)
- `modules.mcp.service.tool_query_service.OpencodeJsonToolCatalog` (TASK-104)

# agent
- `modules.agent.protocol.AgentBackend, AgentDispatcher, SessionManager` (TASK-105)
- `modules.agent.adapter.serve_backend.ServeBackend` (TASK-107)
- `modules.agent.service.agent_dispatcher.DefaultAgentDispatcher` (TASK-108)
- `modules.agent.service.session_manager.InMemorySessionManager` (TASK-109)

# execution
- `modules.execution.protocol.ExecutionRecorder, ExecutionStateReader` (TASK-201)
- `modules.execution.service.execution_service.{SqlAlchemyExecutionRecorder, SqlAlchemyExecutionReader, DefaultExecutionService}` (TASK-204)

# workflow
- `modules.workflow.protocol.{WorkflowReader, NodeExecutorFactory, WorkflowRunner, RetryService, CircuitBreaker}` (TASK-301)
- `modules.workflow.repo.workflow_repo.SqlAlchemyWorkflowRepository` (TASK-303)
- `modules.workflow.executor.registry.NodeExecutorRegistry` (TASK-304)
- `modules.workflow.service.workflow_runner.DefaultWorkflowRunner` (TASK-309)
- `modules.workflow.service.retry_service.{DefaultRetryService, DefaultCircuitBreaker}` (TASK-310)

# conversation
- `modules.conversation.protocol.ConversationService` (TASK-401)
- `modules.conversation.repo.conversation_repo.SqlAlchemyConversationRepository` (TASK-403)
- `modules.conversation.service.conversation_service.DefaultConversationService` (TASK-404)

### 3.3 输出文件

1. **`src/main/main.py`** — 严格只含两个职责：
   - `def build_registry(settings: Settings) -> Registry`（装配所有单例）
   - `def main() -> None`（启动顺序封装，便于测试）
   - `if __name__ == "__main__": main()` 入口

> **禁止**在本文件定义 `create_app` / `lifespan`（属 TASK-409）。
> **禁止**注册中间件或路由（属 TASK-409）。

## 4. 详细步骤

### 4.1 build_registry 实现（按设计文档 §6.3 注册顺序）

```python
"""Fin-Agent process entry — build_registry 全局装配 + uvicorn 入口。

本文件与 src/main/api/app.py（TASK-409）共同拆分 main.py:
- 本文件: build_registry() + __main__ 入口
- app.py: create_app() 工厂 + lifespan + middleware + routers

详见 docs/tasks/INDEX.md §2 阶段汇总 与各卡片元数据。
"""
from __future__ import annotations

from src.main.infra.settings import Settings
from src.main.infra.di import Registry
from src.main.infra.db import create_engine, get_session_local
from src.main.infra.uow import SqlAlchemyUoWFactory, UoWFactory

# 各模块 Protocol — 必须在 build_registry 注册前 import
from src.main.modules.mcp.protocol import ToolCatalog
from src.main.modules.agent.protocol import AgentBackend, AgentDispatcher, SessionManager
from src.main.modules.execution.protocol import ExecutionRecorder, ExecutionStateReader
from src.main.modules.workflow.protocol import (
    WorkflowReader, NodeExecutorFactory, WorkflowRunner, RetryService, CircuitBreaker,
)
from src.main.modules.conversation.protocol import ConversationService
from src.main.infra.db_health import DBHealthProbe  # TASK-013


def build_registry(settings: Settings) -> Registry:
    """装配全项目 Protocol 单例。

    注册顺序敏感（后注册者依赖前者）：
    1. Settings / Registry 自引用
    2. infra: UoWFactory
    3. mcp: ToolCatalog
    4. agent: AgentBackend → AgentDispatcher → SessionManager
    5. execution: ExecutionRecorder → ExecutionStateReader
    6. workflow: WorkflowReader → NodeExecutorFactory → WorkflowRunner → RetryService
    7. conversation: ConversationService
    8. monitoring: DBHealthProbe
    """
    # 实现类 import（函数内 import 避免循环依赖；Protocol 在模块顶部 import）
    from src.main.modules.mcp.repo.manifest_loader import OpencodeManifestLoader  # TASK-103
    from src.main.modules.mcp.service.tool_query_service import OpencodeJsonToolCatalog  # TASK-104
    from src.main.modules.agent.adapter.serve_backend import ServeBackend  # TASK-107
    from src.main.modules.agent.service.agent_dispatcher import DefaultAgentDispatcher  # TASK-108
    from src.main.modules.agent.service.session_manager import InMemorySessionManager  # TASK-109
    from src.main.modules.execution.service.execution_service import (  # TASK-204
        SqlAlchemyExecutionRecorder,
        SqlAlchemyExecutionReader,
    )
    from src.main.modules.workflow.repo.workflow_repo import SqlAlchemyWorkflowRepository  # TASK-303
    from src.main.modules.workflow.executor.registry import NodeExecutorRegistry  # TASK-304
    from src.main.modules.workflow.service.workflow_runner import DefaultWorkflowRunner  # TASK-309
    from src.main.modules.workflow.service.retry_service import (  # TASK-310
        DefaultRetryService,
        DefaultCircuitBreaker,
    )
    from src.main.modules.conversation.repo.conversation_repo import (  # TASK-403
        SqlAlchemyConversationRepository,
    )
    from src.main.modules.conversation.service.conversation_service import (  # TASK-404
        DefaultConversationService,
    )

    reg = Registry()
    engine = create_engine(settings)
    session_local = get_session_local(engine)  # 修正:SessionLocal → get_session_local(engine)

    reg.register_singleton(Settings, lambda r: settings)
    reg.register_singleton(Registry, lambda r: r)

    # ── infra ──
    reg.register_singleton(UoWFactory, lambda r: SqlAlchemyUoWFactory(session_local))

    # ── mcp ──
    reg.register_singleton(ToolCatalog, lambda r: OpencodeJsonToolCatalog(
        OpencodeManifestLoader(settings)))

    # ── agent ──
    reg.register_singleton(AgentBackend, lambda r: ServeBackend(settings))
    reg.register_singleton(AgentDispatcher, lambda r: DefaultAgentDispatcher(
        backend=r.resolve(AgentBackend), settings=settings))
    reg.register_singleton(SessionManager, lambda r: InMemorySessionManager())

    # ── execution ──
    reg.register_singleton(ExecutionRecorder, lambda r: SqlAlchemyExecutionRecorder(
        uow_factory=r.resolve(UoWFactory)))
    reg.register_singleton(ExecutionStateReader, lambda r: SqlAlchemyExecutionReader(session_local))

    # ── workflow ──
    reg.register_singleton(WorkflowReader, lambda r: SqlAlchemyWorkflowRepository(session_local))
    reg.register_singleton(NodeExecutorFactory, lambda r: NodeExecutorRegistry())
    reg.register_singleton(WorkflowRunner, lambda r: DefaultWorkflowRunner(
        reader=r.resolve(WorkflowReader),
        recorder=r.resolve(ExecutionRecorder),
        dispatcher=r.resolve(AgentDispatcher),
        executor_registry=r.resolve(NodeExecutorFactory),
        uow_factory=r.resolve(UoWFactory),
        settings=settings))
    # 修订 T-2:先注册 CircuitBreaker(RetryService 依赖项)
    reg.register_singleton(CircuitBreaker, lambda r: DefaultCircuitBreaker(
        threshold=settings.CIRCUIT_BREAKER_THRESHOLD))
    reg.register_singleton(RetryService, lambda r: DefaultRetryService(
        reader=r.resolve(ExecutionStateReader),
        recorder=r.resolve(ExecutionRecorder),
        dispatcher=r.resolve(AgentDispatcher),
        settings=settings,
        circuit_breaker=r.resolve(CircuitBreaker)))  # 修订 T-2:补第 5 个必填参数

    # ── conversation ──
    reg.register_singleton(ConversationService, lambda r: DefaultConversationService(
        repo=SqlAlchemyConversationRepository(session_local)))

    # ── monitoring (修订 T-10) ──
    reg.register_singleton(DBHealthProbe, lambda r: DBHealthProbe(r.resolve(Settings)))

    return reg


def main() -> None:
    """进程入口：validate → build_registry → create_app → uvicorn.run。

    显式拆为函数（非 if __name__ 内联）便于：
    - 集成测试中直接调用 main() 跳过 uvicorn.run
    - 后续引入 supervisor / gunicorn 时不修改本函数
    """
    import uvicorn
    from src.main.api.app import create_app  # TASK-409

    settings = Settings()
    settings.validate()  # ConfigError → 进程退出码 78 (EX_CONFIG)
    registry = build_registry(settings)
    app = create_app(settings=settings, registry=registry)

    uvicorn.run(
        app,
        host=settings.API_HOST,
        port=settings.API_PORT,
        log_config=None,  # 用我们自己的 structlog 配置 (TASK-006)
    )


if __name__ == "__main__":
    main()
```

### 4.2 create_app 签名约束（与 TASK-409 协调）

为避免 `create_app` 内部再调 `build_registry` 导致的双重装配，**本卡片 §4.1 强制 create_app 接收外部 registry 参数**：

```python
# TASK-409 的 create_app 必须签名（接口契约，本卡片强约束）
def create_app(
    settings: Settings,
    *,
    registry: Registry,  # 必须由 build_registry 外部传入,非内部自建
) -> FastAPI: ...
```

TASK-409 §4.2 原签名 `create_app(settings: Settings | None = None) -> FastAPI` 必须**改为上式**；内部不再调 `build_registry`。

### 4.3 启动校验顺序（设计文档 §5.3）

```python
# main() 内顺序,任一失败立即抛 ConfigError → 进程退出码 78
settings = Settings()       # 1. 读 env + .env
settings.validate()         # 2. 一致性校验（端口冲突/路径存在/pool size）
registry = build_registry(settings)  # 3. 装配（DB engine 在此连接）
app = create_app(settings=settings, registry=registry)  # 4. 工厂
uvicorn.run(app, ...)       # 5. 启动 HTTP 监听
```

## 5. Do Not 清单

- [ ] **Do Not #6**（P6 DI 单一入口）: 重构期一次性切换;不允许共存
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry — （必须是函数返回值，进程启动时才执行）
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol — （本卡片 import 各模块 Protocol 合理，但禁止 import 实现细节类之外的私有成员）
- [ ] **Do Not #11**: Executor 必须无状态,每次新建 — （如 `lru_cache` 装饰 build_registry）
- [ ] **Do Not #8**: 全部走 `settings.py` 或 `constants.py` — 全部 `settings.<FIELD>`
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError — 启动期任何异常必须传播到 uvicorn 让进程退出
- [ ] **修订 T-10 约束**: DBHealthProbe 必须在本卡片的 `build_registry` 中显式 `register_singleton`，**禁止**遗漏
- [ ] **修订 T-11 约束**: Engine dispose 由 `Registry.shutdown()` 接管（lifespan 内调用），本卡片**不直接**调 `engine.dispose()`
- [ ] **范围约束（与 TASK-409 划清）**: 本卡片**禁止**定义 `create_app` / `lifespan` / `add_middleware` / `include_router`

## 6. 验收标准

- [ ] `python -c "from src.main.main import build_registry, main"` 退出码 0
- [ ] `build_registry(Settings())` 返回 Registry 实例，且至少 14 个 Protocol 注册（`len(r._factories) >= 14`）
- [ ] `build_registry(Settings()).resolve(ToolCatalog)` 返回非 None
- [ ] `Settings(API_PORT=8000, OPENCODE_SERVE_PORT=8000).validate()` 后 `main()` 抛 `ConfigError`（端口冲突）
- [ ] `main()` 启动后 `curl http://127.0.0.1:8000/api/v1/workflows` 返回 `{code: 0, ...}` 形状（需先 `Settings().OPENCODE_BIN` 探测通过）
- [ ] **关键 grep #1**: `grep -nE 'def create_app' src/main/main.py` → 0（create_app 已被拆到 TASK-409 的 `api/app.py`）
- [ ] **关键 grep #2**: `grep -nE 'register_singleton' src/main/main.py` ≥ 14
- [ ] **关键 grep #3**: `grep -nE '^registry = |^_registry = ' src/main/main.py` → 0（无模块级实例）
- [ ] **修订 T-10 验证**: `grep -nE 'DBHealthProbe' src/main/main.py` 命中 ≥ 2（import + register_singleton）
- [ ] **修订 T-2 验证**: `grep -nE 'circuit_breaker' src/main/main.py` 命中 ≥ 1（DefaultRetryService 注入 circuit_breaker）
- [ ] **实现类 import 验证**: `grep -nE 'import OpencodeJsonToolCatalog|import ServeBackend|import DefaultWorkflowRunner|import DefaultRetryService' src/main/main.py` 命中 ≥ 4（关键 4 个实现类在 build_registry 函数内 import）
- [ ] **范围验证**: `grep -nE 'lifespan|add_middleware|include_router' src/main/main.py` → 0（这些在 TASK-409）

## 7. 非目标

- 不实现 `create_app` / `lifespan`（在 TASK-409）
- 不实现 middleware 注册（在 TASK-406/407，由 TASK-409 集成）
- 不实现 router include（在 TASK-408，由 TASK-409 集成）
- 不实现 DBHealthProbe 自身（在 TASK-013，本卡片仅注册）
- 不实现 webui envelope 兼容层（在 TASK-410）
- 不写集成测试（在跨切 TASK-CCC-03/04）
- **不实现任何 Protocol / service**（必须由前置 TASK 全部完成；本卡片仅 `import` + `register_singleton` 装配，不得新增 Protocol、不得新增实现类、不得新增业务逻辑）

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-411 交付说明

### 装配验证
$ python -c "
from src.main.main import build_registry
from src.main.infra.settings import Settings
from src.main.modules.agent.protocol import AgentDispatcher
from src.main.modules.execution.protocol import ExecutionRecorder
from src.main.modules.workflow.protocol import WorkflowRunner
from src.main.modules.conversation.protocol import ConversationService
from src.main.infra.db_health import DBHealthProbe

r = build_registry(Settings())
print('factories:', len(r._factories))
print('AgentDispatcher:', type(r.resolve(AgentDispatcher)).__name__)
print('WorkflowRunner:', type(r.resolve(WorkflowRunner)).__name__)
print('DBHealthProbe:', type(r.resolve(DBHealthProbe)).__name__)
"

### 范围 grep 验证
$ grep -nE 'def create_app|lifespan|add_middleware|include_router' src/main/main.py
(no output — confirmed scope isolation from TASK-409)

$ grep -nE 'register_singleton' src/main/main.py | wc -l
14

### 修订 T-10 验证
$ grep -nE 'DBHealthProbe' src/main/main.py
15:from src.main.infra.db_health import DBHealthProbe
102:    reg.register_singleton(DBHealthProbe, lambda r: DBHealthProbe(r.resolve(Settings)))

### 偏离 / 备注
无偏离,严格按设计文档 §6.3 + 修订 T-10/T-11 执行。
注:本卡片与 TASK-409 共同承担原"main.py"职责,详见 INDEX.md §2 阶段汇总。
```
