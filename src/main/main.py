"""Fin-Agent process entry - build_registry 全局装配 + uvicorn 入口。

本文件与 src/main/api/app.py（TASK-409）共同拆分原 main.py:
- 本文件: build_registry() + __main__ 入口
- app.py: FastAPI 工厂 + 生命周期 + 中间件 + 路由注册

详见 docs/tasks/INDEX.md §2 阶段汇总 与各卡片元数据。
"""
from __future__ import annotations

from src.main.infra.settings import Settings
from src.main.infra.di import Registry
from src.main.infra.db import Base, create_engine, get_session_local
from src.main.infra.db_migration import check_and_apply_migrations  # TASK-013-migration
from src.main.infra.uow import SqlAlchemyUoWFactory, UoWFactory
from src.main.infra.errors import ConfigError

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
    )
    from src.main.modules.execution.repo.execution_repo import SqlAlchemyExecutionReader
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
    # ── Database migration check (replaces DEV DROP + create_all) ──
    # Alembic manages schema evolution safely. New DBs are stamped to baseline
    # then upgraded; stale DBs raise ConfigError unless FIN_AGENT_AUTO_MIGRATE=1.
    # If alembic is not installed, falls back to Base.metadata.create_all().
    check_and_apply_migrations(engine)
    session_local = get_session_local(engine)

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
    from src.main.modules.agent.repo.agent_definition_repo import (
        FileSystemAgentDefinitionRepository,
    )
    reg.register_singleton(
        FileSystemAgentDefinitionRepository,
        lambda r: FileSystemAgentDefinitionRepository(settings),
    )

    # ── execution ──
    reg.register_singleton(ExecutionRecorder, lambda r: SqlAlchemyExecutionRecorder(
        uow_factory=r.resolve(UoWFactory)))
    reg.register_singleton(ExecutionStateReader, lambda r: SqlAlchemyExecutionReader(session_local))

    # ── workflow ──
    # SqlAlchemyWorkflowRepository 同时实现 WorkflowReader;WorkflowQueryService
    # 内部既需要 reader(读)也需要 repo(写),复用同一实例保证 session 生命周期一致。
    workflow_repo_factory = SqlAlchemyWorkflowRepository
    reg.register_singleton(WorkflowReader, lambda r: workflow_repo_factory(session_local))
    reg.register_singleton(NodeExecutorFactory, lambda r: NodeExecutorRegistry())
    reg.register_singleton(WorkflowRunner, lambda r: DefaultWorkflowRunner(
        reader=r.resolve(WorkflowReader),
        recorder=r.resolve(ExecutionRecorder),
        dispatcher=r.resolve(AgentDispatcher),
        executor_registry=r.resolve(NodeExecutorFactory),
        uow_factory=r.resolve(UoWFactory),
        settings=settings))
    # 修订 T-2: 先注册 CircuitBreaker (RetryService 依赖项)
    reg.register_singleton(CircuitBreaker, lambda r: DefaultCircuitBreaker(
        threshold=settings.CIRCUIT_BREAKER_THRESHOLD))
    reg.register_singleton(RetryService, lambda r: DefaultRetryService(
        reader=r.resolve(ExecutionStateReader),
        recorder=r.resolve(ExecutionRecorder),
        dispatcher=r.resolve(AgentDispatcher),
        settings=settings,
        circuit_breaker=r.resolve(CircuitBreaker)))  # 修订 T-2: 第 5 个必填参数
    # 修订 T-3: 注册 WorkflowQueryService —— 之前漏注册导致
    # /api/v1/workflows/{id}/trigger 报 500 (Depends 找不到 service)。
    # __init__ 签名: (reader, repo, uow_factory)
    # WorkflowReader 协议 + SqlAlchemyWorkflowRepository 实现 + UoWFactory
    from src.main.modules.workflow.service.workflow_query_service import WorkflowQueryService
    reg.register_singleton(WorkflowQueryService, lambda r: WorkflowQueryService(
        reader=r.resolve(WorkflowReader),
        repo=workflow_repo_factory(session_local),
        uow_factory=r.resolve(UoWFactory),
    ))

    # ── conversation ──
    reg.register_singleton(ConversationService, lambda r: DefaultConversationService(
        repo=SqlAlchemyConversationRepository(session_local)))

    # ── monitoring (修订 T-10) ──
    reg.register_singleton(DBHealthProbe, lambda r: DBHealthProbe(settings))

    return reg



def main() -> None:
    """进程入口：validate → build_registry → create_app → uvicorn.run。

    显式拆为函数（非 if __name__ 内联）便于：
    - 集成测试中直接调用 main() 跳过 uvicorn.run
    - 后续引入 supervisor / gunicorn 时不修改本函数
    """
    import uvicorn
    from src.main.api.app import create_app  # TASK-409

    import sys

    settings = Settings()
    try:
        settings.validate()  # ConfigError → 进程退出码 78 (EX_CONFIG)
    except ConfigError:
        sys.exit(78)
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