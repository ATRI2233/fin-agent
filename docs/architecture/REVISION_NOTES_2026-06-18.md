# 架构文档修订与追加说明（2026-06-18）

> 本文档是对 `ARCHITECTURE_AUDIT_2026-06-18.md` 与 `TARGET_ARCHITECTURE_v2_2026-06-18.md` 的逐项修订清单。
> 核验方法：grep + Read 逐文件比对，所有引用都标注了 `文件:行号`。
> 适用范围：合并入 PR 前的人工修订；其中"修订"是可机械替换的 find-and-replace，"追加"是新增章节。

---

## 第一部分：对审计文档的修订

> 审计文档主体结论（P0/P1/P2 分级、双胞胎判断）经核验全部成立，无需改动。
> 仅 §2.12 "文档漂移" 一节有 **2 处失实**，需要修正。

### 修订 A-1：删除"CLAUDE.md 没写 services/core/"的说法

**位置**：`ARCHITECTURE_AUDIT_2026-06-18.md` §2.12

**原文本**：
> - CLAUDE.md 说 `src/webui/server/` 存在 → 实际目录结构是 `src/webui/`，server 子目录需要确认
> - CLAUDE.md 没说 `src/main/framework/services/core/` 与 `services/queries/` 的双目录

**事实核验**：
- CLAUDE.md 第 43-46 行明确列出：
  ```
  │   │   ├── services/        # 业务逻辑层
  │   │   │   ├── core/        # 核心服务实现
  │   │   │   ├── patterns/    # 横切模式: ...
  │   │   │   └── queries/     # 只读查询服务
  ```
- `src/webui/server/` **确实存在**（`ls -la src/webui/` 列出 `server` 子目录）。

**实际漂移点**：CLAUDE.md **确实没提** `services/{workflow,execution,conversation,scheduler,session}_service.py` 这 6 个 shim 文件——它们和 `services/core/`、`services/queries/` 下的真身共存，但文档没标记 shim 的存在。

**替换为**：

```markdown
### 🔵 P3 — 命名 / 文档漂移

#### 2.12 CLAUDE.md 的目录树与磁盘基本一致，但漏标了 shim 文件

- CLAUDE.md 列出了 `services/{core,patterns,queries}/` 三个子目录 ✅
- CLAUDE.md **漏标**了 `services/{workflow,execution,conversation,scheduler,session}_service.py` 这 6 个 shim 文件——它们与 `services/core/` 下同名 canonical 实现共存，但文档未声明"双路径导入"的事实
- 实际影响：新人按 CLAUDE.md 找到 `services/workflow_service.py` 读到的只是 re-export，看不到真实代码（canonical 在 `services/core/workflow_service.py`）

**修订建议**：在 CLAUDE.md 的 `services/` 段落追加一行：
> 注：`services/{workflow,execution,conversation,scheduler,session}_service.py` 是 shim，
> canonical 实现在 `services/core/` 下。后续重构（见 TARGET_ARCHITECTURE_v2）会删除 shim。
```

### 修订 A-2：常量计数修正

**位置**：`ARCHITECTURE_AUDIT_2026-06-18.md` §2.9 顶部表格 + §3 附录 A

**原文本**（§2.9 表格）：
> | `config/constants.py` | 4 个"业务常量" | MAX_AGENT_RETRIES=3, MAX_NODES_PER_WORKFLOW=20, MAINTENANCE_RETENTION_DAYS=30 |

**事实核验**：`constants.py` 实际有 6 条：
- `MAX_AGENT_RETRIES = 3`
- `DEFAULT_TIMEOUT = 300`
- `MAX_NODES_PER_WORKFLOW = 20`
- `SCHEDULER_MAX_INSTANCES = 1`
- `MAINTENANCE_RETENTION_DAYS = 30`
- `SERVE_BACKEND_DEFAULT_PORT = 4096`

**替换为**：

```markdown
| `config/constants.py` | 6 个"业务常量" | MAX_AGENT_RETRIES=3, DEFAULT_TIMEOUT=300, MAX_NODES_PER_WORKFLOW=20, SCHEDULER_MAX_INSTANCES=1, MAINTENANCE_RETENTION_DAYS=30, SERVE_BACKEND_DEFAULT_PORT=4096 |
```

**端口 4096 重复源数量修正**：

**原文本**（§2.9 表格中）：
> | `config/settings.py` | ... | API_PORT=8000, NODE_TIMEOUT_SECONDS=600, SERVE_BACKEND_URL=http://127.0.0.1:4096 |

**事实核验**：4096 实际出现在 3 处，不止 2 处：
- `config/settings.py:45` — `SERVE_BACKEND_URL: str = "http://127.0.0.1:4096"`
- `config/constants.py:17` — `SERVE_BACKEND_DEFAULT_PORT = 4096`
- `core/infrastructure/container.py:130` — `getattr(self._settings, "SERVE_BACKEND_URL", "http://127.0.0.1:4096")` ← 第 3 处硬编码 fallback，审计漏掉了

**替换为**：

```markdown
- 端口 4096 实际硬编码 3 处（`settings.py:45` + `constants.py:17` + `container.py:130` 的 getattr fallback），而非审计误标的 2 处
```

---

## 第二部分：对目标架构 v2.1 的修订与追加

> 目标架构 v2.1 的核心设计（Domain-driven 分层 / Protocol / UoW 边界 / 单点 DI / §7.6 ContextVar 契约 / §8.1 Phase 3 diff 校验）方向正确，无需重写。
> 以下 **8 处缺口 + 3 处风险**需要在进入实施前补齐。

---

### 修订 T-1：`CircuitBreaker` Protocol 位置错误（🔴 风险）

**问题**：§3.6.2 在 `modules/execution/protocol.py` 末尾声明 `class CircuitBreaker(Protocol): ...`，
但 docstring 写"由 workflow.retry_service 实现并调用，execution 不感知"。
这违反 §0 P2："对外只暴露 Protocol；实现类禁止被其他模块 import"的方向——
execution 模块**不应该**声明一个由 workflow 实现的 Protocol。

**修改位置**：`TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.6.2

**操作**：**删除** §3.6.2 末尾的 CircuitBreaker Protocol 整段，**追加**到 §3.6.3 `modules/workflow/protocol.py` 末尾：

```python
# 在 modules/workflow/protocol.py 末尾追加:

class CircuitBreaker(Protocol):
    """Per-execution node failure threshold + cooldown state.

    Implementations live in modules/workflow/service/retry_service.py.
    The execution module does NOT import this Protocol — it only
    persists node-level failure counts; circuit decisions belong to
    workflow orchestration.
    """

    def is_open(self, execution_id: ExecutionId, node_id: NodeId) -> bool: ...
    def record_failure(self, execution_id: ExecutionId, node_id: NodeId) -> None: ...
    def reset(self, execution_id: ExecutionId, node_id: NodeId) -> None: ...
```

---

### 修订 T-2：熔断器 key 必须明确为 `(execution_id, node_id)`（🔴 风险）

**问题**：§4.2 说"熔断器状态由 RetryService 内部维护(per execution_id)"，但当前 `WorkflowRetryHandler._circuit_state` 是 `dict[str, int]`（keyed by `node_id`）。
**同一个 node_id 在不同 execution 中会冲突**，是真实存在的潜在 bug。

**修改位置**：§3.6.3 `RetryService` Protocol docstring + §4.2

**替换 §3.6.3 RetryService 段为**：

```python
class RetryService(Protocol):
    """DAG-aware retry + circuit breaker.

    Circuit breaker key MUST be ``(execution_id, node_id)`` — the same
    node_id appears in different executions and must NOT share state.
    Implementations persist counts keyed on this composite string.
    """

    async def retry_node(self, execution_id: ExecutionId,
                         node_id: NodeId, trace_id: TraceId) -> RetryResult: ...
    async def retry_workflow(self, workflow_id: WorkflowId,
                             *, from_node_id: NodeId | None,
                             trace_id: TraceId) -> RetryResult: ...
```

**§4.2 第 3 段**追加一句：

> 熔断器状态由 RetryService 内部维护，key 为 `f"{execution_id}:{node_id}"`（composite key），
> 严禁仅以 `node_id` 作为 key（跨 execution 串状态）。

---

### 修订 T-3：`AgentDispatcher.dispatch_parallel` 返回类型语义模糊（🟡 缺口）

**问题**：§3.6.1 写 `tuple[list[DispatchResult], list[SessionId]]`，
但 `DispatchResult` 已含 `session_id`，再额外返回 `list[SessionId]` 没有语义说明——
是 debate 多 session？是否与 `extra_data["debate_session_ids"]` 重复？

**修改位置**：§3.6.1 `AgentDispatcher.dispatch_parallel` docstring

**替换为**：

```python
class AgentDispatcher(Protocol):
    """高层调度：会话复用、超时、结构化错误分类。"""

    async def dispatch(
        self,
        agent: AgentReference,
        prompt: str,
        *,
        timeout: float | None = None,
        session_id: SessionId | None = None,
        reuse_session: bool = False,
        trace_id: TraceId,
    ) -> DispatchResult:
        """Raises: AgentTimeoutError, AgentHttp5xxError, OpencodeUnavailableError,
                   McpServerError, ValidationError"""

    async def dispatch_parallel(
        self,
        agents: list[AgentReference],
        prompt: str,
        *,
        timeout: float | None = None,
        trace_id: TraceId,
    ) -> tuple[list[DispatchResult], list[SessionId]]:
        """Fan-out dispatch for independent agent calls.

        Returns:
            (results, extra_session_ids):
              - results: parallel to ``agents``; each has its own primary session_id.
              - extra_session_ids: **debate-style** auxiliary session IDs
                (e.g. opening a follow-up session in the same dispatch).
                MUST NOT overlap with ``results[i].session_id`` — call sites
                use this list to seed ``NodeResult.extra_data["debate_session_ids"]``.

        Raises: same exceptions as ``dispatch``, raised from the first failing agent.
        """
```

---

### 修订 T-4：CLEANED_UP 终态需要明示"无法复活 retry"（🟡 缺口）

**问题**：§3.5 的 `LEGAL_TRANSITIONS` 把 `CLEANED_UP → {}` 设为终态，但 §4.2 / §3.6.3 的 Protocol
描述没说"CLEANED_UP 后只能开新 execution，不能原 execution 重试"——这是隐式假设。
如果不显式，Phase 3 实现时大概率有人会加 `CLEANED_UP → PENDING` 复活分支。

**修改位置**：§3.5 末尾追加

**追加内容**：

```python
# === 在 LEGAL_TRANSITIONS 下方追加注释 ===

# 设计约束（不允许在实现中绕过）:
# - CLEANED_UP 是终态；不允许 CLEANED_UP → PENDING 复活。
# - 用户在 session 清理后想重跑工作流，必须创建**新的 WorkflowExecution**
#   （即 RetryService.retry_workflow() 内部的"新建 execution"语义），
#   而不是把现有 execution 的状态从 CLEANED_UP 拉回 PENDING/RUNNING。
# - 历史 execution 的 CLEANED_UP 行保留作为审计追溯。
```

---

### 修订 T-5：`app.dependency_overrides` 对 `Settings` 单例的覆盖未明确方案（🟡 缺口）

**问题**：§6.4 的测试覆盖示例是 `app.dependency_overrides[service_dep(AgentDispatcher)] = lambda: mock_dispatcher`，
这只对 `Depends()` 包装的协议有效。`Settings` 是 `reg.register_singleton(Settings, lambda r: settings)` 注册的，
**没有走 `Depends()`**——要 mock Settings 就需要直接操作 `app.state.registry._instances[Settings]`，破坏封装。

**修改位置**：§6.2 FastAPI 集成 + §6.4 测试覆盖

**§6.2 追加**：

```python
# api/deps.py（追加 get_settings）

def get_settings(reg: Registry = Depends(get_registry)) -> Settings:
    """FastAPI entry point for the Settings singleton — overridable in tests."""
    return reg.resolve_sync(Settings)  # 见下注

# 注: §6.1 的 Registry.resolve() 是 async 的;为兼容同步 Depends(),
# 在 Registry 增加同步方法 resolve_sync() —— 仅用于初始化时已确定的单例
# (Settings / DB engine 等无 async 工厂的对象)。
```

**§6.1 `Registry` 类追加方法**：

```python
def resolve_sync(self, protocol: type) -> Any:
    """Synchronous variant for already-constructed singletons.

    Use only for Settings / DB engine / Tracer — objects whose factory
    is pure (no DB connection, no subprocess). For everything else, use
    ``await resolve(protocol)``.
    """
    with self._lock:
        if protocol in self._instances:
            return self._instances[protocol]
        if protocol not in self._factories:
            raise RegistryError(f"{protocol.__name__} not registered")
        instance = self._factories[protocol](self)
        self._instances[protocol] = instance
        return instance
```

**§6.4 测试覆盖示例追加**：

```python
# tests/conftest.py
@pytest.fixture
def app_with_overrides():
    app = build_app()
    mock_dispatcher = MockAgentDispatcher()
    mock_settings = MockSettings(api_port=9999)
    # Depends-style 覆盖（适用于 service_dep 包装的协议）
    app.dependency_overrides[service_dep(AgentDispatcher)] = lambda: mock_dispatcher
    # Getter-style 覆盖（适用于 Settings 等单例）
    app.dependency_overrides[get_settings] = lambda: mock_settings
    yield app, mock_dispatcher, mock_settings
    app.dependency_overrides.clear()
```

---

### 修订 T-6：Phase 5 删除 shim 前缺少"import 影响面分析"（🟡 缺口）

**问题**：§8.1 Phase 5 直接列了"删除 framework/services/{workflow,execution,...}_service.py shim"，
但当前 `workflow_engine.py:21` 用的是 `from main.framework.services.workflow_service import WorkflowService`，
且多个 controller 通过 `from main.framework.services import X` 间接消费 shim。
**该计划缺少一个"import 影响面清单 + 切换顺序"**。

**修改位置**：§8.1 Phase 5 之前新增 §8.1.1

**追加内容**：

```markdown
#### 8.1.1 删除 shim 前的强制 import 影响面扫描（Phase 0 末必做）

**执行命令**：
```bash
# (1) 列出所有通过 shim 路径导入服务的文件
grep -rn "from main.framework.services" src/main/ \
    | grep -v "from main.framework.services.core\|from main.framework.services.queries\|from main.framework.services.patterns" \
    | tee phase0_shim_importers.txt

# (2) 列出所有间接通过 __init__.py 消费 shim 的文件
grep -rn "from main.framework.services import" src/main/ \
    | tee phase0_init_consumers.txt

# (3) 列出所有用 string-based lookup 访问服务的代码
grep -rn "from main.framework.services import" src/main/ \
    | grep "__init__" \
    | tee phase0_reexport_consumers.txt
```

**Phase 5 实施前置条件**：

1. `phase0_shim_importers.txt` + `phase0_init_consumers.txt` 的全部命中必须改为：
   - 服务类（WorkflowService 等）→ 改 `from modules.workflow.service.workflow_runner import WorkflowRunner`
   - 查询类（WorkflowQueryService 等）→ 改 `from modules.workflow.service.workflow_query_service import WorkflowQueryService`
2. `phase0_reexport_consumers.txt` 的命中必须改为对应 Protocol（来自 `modules/*/protocol.py`）的 `Depends(service_dep(...))`
3. 三份 txt 文件作为 PR 附件入库，CI 阶段强制要求

**禁止**：在 importer 未切换完毕前删除任何 shim 文件。
```

---

### 修订 T-7：v2.1 §7.6 的 trace_id 显式参数化工作量爆炸需在 Phase 1 末局部验证（🟡 缺口）

**问题**：§7.6 要求**所有 asyncio.gather worker 显式接 trace_id + bind/unbind**。
这意味着 `WorkflowService.handle_failure / execute_node / _execute_wrapped / _cleanup_sessions / _execute_in_order` 全部要改签名。
当前 `WorkflowService` 的方法签名都没这个参数，**全链路改动量可能比 10 周估算多 30%**。

**修改位置**：§8.1 Phase 1 末尾新增 Phase 1.5

**追加内容**：

```markdown
#### 8.1.5 Phase 1.5（夹在 Phase 1 与 Phase 2 之间）—— trace_id 签名变更局部验证（1 周）

**目的**：在全面铺开 trace_id 显式参数化之前，先对单链路（`AgentDispatcher`）做端到端试点，
验证 §7.6 契约的工作量假设。

**范围**：
- 仅修改 `modules/agent/service/agent_dispatcher.py` + `modules/agent/adapter/serve_backend.py` 的方法签名（追加 `trace_id: TraceId`）
- 仅修改 `modules/agent/protocol.py` 的 Protocol 定义
- 不动 workflow / execution 模块

**验证产出**：
1. `tests/modules/agent/test_dispatcher.py` 中所有 fixture 调用必须显式传 trace_id（grep 验证）
2. `tests/infra/test_tracing.py::test_serial_trace_passthrough` 通过
3. 工作量日志：实际改动行数 vs 预估，作为 Phase 2/3/4 的预算修正依据

**判定**：
- 如果 Phase 1.5 改动量 > 200 行 → Phase 2-4 的 trace_id 参数化可考虑降级为"仅并行节点路径强制，串行路径保留 ContextVar"
- 如果 ≤ 200 行 → Phase 2-4 按原计划全量铺开

**禁止**：跳过 Phase 1.5 直接进入 Phase 2。
```

---

### 修订 T-8：webui 信封形状破坏性变更需要兼容层（🟡 缺口）

**问题**：v2.1 的 `ApiResponse` 是 `{code, message, data, trace_id}` 形状，
当前 webui 端的 axios 拦截器很可能消费的是 `{detail, ...}` 之类的形状（FastAPI 默认 JSON shape）。
§10 验收清单说"任意 HTTP 请求 → 响应 header 含 X-Trace-Id"——但响应**体**形状变了前端要同步改。
文档说"前端本轮不在改动范围"，但这是隐式延期。

**修改位置**：§10 验收清单新增一条 + §8.1 Phase 4 细化

**§10 验收清单追加**：

```markdown
- [ ] webui API 客户端已切换到 envelope 形状 `{code, message, data, trace_id}`
- [ ] webui 端的 axios 拦截器在响应 status === 200 但 envelope.code !== 0 时能正确转译为错误
- [ ] 旧 `{detail, ...}` 形状的兼容 adapter（`api/v1/_legacy_compat.py`）已实现并标注 deprecated
```

**§8.1 Phase 4 末尾追加**：

```markdown
#### Phase 4 子任务 4.3 —— webui envelope 兼容层（2-3 天）

1. 实现 `api/v1/_legacy_compat.py`：当请求 header `X-Api-Version: legacy` 时返回旧 FastAPI `{detail, ...}` 形状
2. webui 通过 env var `VITE_API_VERSION=legacy` 切到兼容模式，给前端 1 个 sprint 时间迁移
3. CI 阶段加测试：legacy / new 两种形状各跑一遍 e2e
4. 1 sprint 后删除 `_legacy_compat.py` 与 env var
```

---

### 修订 T-9：Phase 3 executor 异常类型显式转换预算（🔴 风险）

**问题**：`ExecutionRecorder.record_node_failed(self, ..., error: FinAgentError, trace_id: TraceId)`
签名要求 `FinAgentError`，但执行器当前抛的是 `RuntimeError` / `ValueError`。
`agent_executor.py:114` 抛 `RuntimeError(f"Agent '{agent}' definition not found...")` 就是反例。
Phase 3 实施时不显式处理，签名匹配会失败。

**修改位置**：§8.1 Phase 3 强制 diff 校验之前，追加第 0 步

**追加内容**：

```markdown
#### 8.1 Phase 3 第 0 步 —— Executor raise 路径全面审计（强制）

**执行命令**（在第 1 步之前必做）：
```bash
# 列出所有 executor 中的 raise 点
grep -nE "raise (RuntimeError|ValueError|Exception|NotImplementedError|AssertionError)" \
    src/main/framework/core/workflow/node_executors/*.py \
    > phase3_old_executor_raises.txt

# 同理: debate_executor.py / input_executor.py / output_executor.py
```

**转换映射表**（写入 §3.2 异常族）：

| 旧 raise | 新 raise | ErrorCode |
|---|---|---|
| `RuntimeError("Agent '...' definition not found: ...")` | `AgentNotFoundError(...)` | `AGENT_NOT_DEFINED` (1004) |
| `RuntimeError(f"Node {node_id} has no agent name defined")` | `AgentNotFoundError(...)` | `AGENT_NOT_DEFINED` (1004) |
| `RuntimeError("AgentNodeExecutor requires a dispatcher")` | `ConfigError(...)` | `CONFIG_INCONSISTENT` (2002) |
| `ValueError("Failed to compute topological order - possible cycle")` | `ValidationError(...)` | `VALIDATION_FAILED` (1100) |
| `ValueError(f"Workflow {workflow_id} not found")` | `WorkflowNotFoundError(...)` | `WORKFLOW_NOT_FOUND` (1001) |
| `ValueError(f"Node {node_id} not found")` | `NodeNotFoundError(...)` | `NODE_NOT_FOUND` (1003) |

**第 0 步产出**：`phase3_old_executor_raises.txt` 与上述转换映射表的对照，
作为 Phase 3 完成的必要条件入 PR。

**禁止**：在未完成第 0 步的情况下进入第 1 步（grep diff 校验）。
```

---

### 修订 T-10：PostgreSQL 迁移阈值缺自动化监测（🟡 缺口）

**问题**：§4.3 列了 5 个 PG 迁移触发条件，但没有任何自动化监测代码——
这是个文档化决策，不是工程化决策。运维侧得自己 grep 文档才能知道阈值。

**修改位置**：§8.1 Phase 0 新增子任务 0.6

**追加内容**：

```markdown
#### 8.1 Phase 0 子任务 0.6 —— DB 迁移阈值 metrics（1-2 天）

**目的**：把 §4.3 的 5 个阈值变成可观测信号。

**实现**：
- 新增 `infra/db_health.py::DBHealthProbe`
- 定期（默认 60s）采集：
  1. 并行节点平均并发（来自 ExecutionNode 的 running 计数 / 周期）
  2. 主 DB 文件大小（`os.path.getsize(data/finagent.db)`）
  3. WAL 文件数 + 大小（`ls data/finagent.db-wal*`）
  4. 当前 worker 数（`os.environ.get("UVICORN_WORKERS", "1")`）
  5. 写入 QPS（来自 metrics 计数器）
- 通过 `GET /api/v1/system/db_health` 暴露
- 每个指标按 §4.3 表打 `severity: ok / warn / critical` 标签

**Do Not 联动**：违反 Do Not #16（"Agent 抛出非 FinAgentError 子类的异常"）需在 metrics 中暴露告警计数。
```

---

### 修订 T-11：Registry.shutdown() 缺少 SQLAlchemy engine 显式释放（🔴 风险）

**问题**：§6.1 `Registry.shutdown()` 异步关闭所有持有 `close()` 的实例。
但：
- FastAPI lifespan handler 调用 `await registry.shutdown()` 时
- `SqlAlchemyUoWFactory` 持有的 engine 在 close 链中不一定能正确 dispose
- engine 连接池残留可能导致测试间状态泄漏

**修改位置**：§6.1 `Registry.shutdown()` 末尾 + main.py lifespan 示例

**替换为**：

```python
async def shutdown(self) -> None:
    """Reverse-registration-order teardown for owned resources."""
    # 1. 关闭按注册顺序的实例（先注册的先关）
    for proto, inst in list(self._instances.items()):
        for method_name in ("close", "cleanup", "shutdown", "stop"):
            closer = getattr(inst, method_name, None)
            if callable(closer):
                try:
                    maybe_coro = closer()
                    if asyncio.iscoroutine(maybe_coro):
                        await maybe_coro
                except Exception:  # noqa: BLE001
                    pass

    # 2. 显式 dispose 所有 SQLAlchemy engine（无论是否注册了 close）
    from sqlalchemy.engine import Engine
    for inst in self._instances.values():
        # Engine 实例本身没有 close(),但有 dispose()
        if isinstance(inst, Engine):
            try:
                inst.dispose()
            except Exception:  # noqa: BLE001
                pass

    self._instances.clear()
```

**main.py lifespan 示例追加**：

```python
# main.py — 启动 / 关闭流程
async def lifespan(app: FastAPI):
    settings = Settings()
    settings.validate()
    registry = await build_registry(settings)
    app.state.registry = registry
    yield
    # 关闭: registry.shutdown() 内部已 dispose 所有 engine
    await registry.shutdown()
```

---

### 修订 T-12：§10 验收清单追加 trace_id / webui / 异常转换的硬检查

**修改位置**：§10 验收清单

**追加内容**（紧跟原 12 条 checklist 之后）：

```markdown
**v2.1 + 修订 T-* 追加的硬检查**

- [ ] `tests/infra/test_tracing.py::test_parallel_trace_isolation` 存在且通过（10 个 worker，各自 trace_id 不串）
- [ ] `tests/infra/test_tracing.py::test_serial_trace_passthrough` 存在且通过（Phase 1.5 引入）
- [ ] `grep -nE "asyncio.gather" src/main/modules/workflow/` 命中的每一处，worker 函数签名必须包含 `trace_id: TraceId` 参数
- [ ] `grep -nE "bind_contextvars" src/main/modules/` 命中的每一处，配对有 `unbind_contextvars`（在同函数 finally 块）
- [ ] `grep -nE "trace_id_var\.set|trace_ctx_var\.set" src/main/modules/` 在 worker 体内 → 0
- [ ] `docs/architecture/PHASE3_STATE_MIGRATION.md` 已提交（含旧→新字段对照表 + diff 命令输出原文 + 并发测试截图）
- [ ] `docs/architecture/PHASE3_EXECUTOR_RAISES.md` 已提交（修订 T-9 第 0 步产出）
- [ ] `grep -nE "self\._(results|failed_nodes|skipped_nodes|chain_sessions|db)" src/main/modules/workflow/executor/` → 0 结果
- [ ] `grep -rn "from main.framework.services" src/main/` → 0 结果（修订 T-6 验证）
- [ ] `grep -nE "raise (RuntimeError|ValueError)" src/main/modules/workflow/executor/` → 0 结果（修订 T-9 验证）
- [ ] `CircuitBreaker` Protocol 仅在 `modules/workflow/protocol.py` 内出现（修订 T-1 验证）
- [ ] webui envelope 兼容层 `_legacy_compat.py` 在 Phase 4 末存在并标 deprecated（修订 T-8）
- [ ] `/api/v1/system/db_health` 返回 §4.3 阈值指标的 severity 标签（修订 T-10）
- [ ] `app.state.registry` 的 lifespan shutdown 日志显示 `engine.dispose()` 被调用（修订 T-11）
```

---

## 第三部分：未修订但需要在 PR 中显式声明的假设

下列假设在目标架构中是隐式的，需要在 PR description 中明确：

1. **依赖 opencode CLI 不变**：v2.1 假设 opencode serve 的 `create_session` / `send_message` 接口契约不变。如果 opencode 升级破坏接口，§3.6.1 `AgentBackend` Protocol 需要调整。
2. **测试 conftest 改造**：当前 `tests/conftest.py` 用 in-memory SQLite，新架构需要在 `app.dependency_overrides` 模式下重新构造 fixture——这是工作量但已在 Phase 4 范围。
3. **DAG 拓扑排序算法**：`workflow_parser.py::topological_sort` 的 Kahn 实现假设图是有限 DAG，不假设有重边/自环。Phase 3 重写 `dag.py` 时保持原算法即可，不要顺手改成 BFS/DFS（会引起 cycle 检测行为差异）。

---

## 第四部分：修订影响范围汇总

| 修订 ID | 严重度 | 影响 Phase | 工作量 |
|---|---|---|---|
| 修订 A-1 | 文档失实 | 文档 PR | 5 分钟（find-and-replace） |
| 修订 A-2 | 文档失实 | 文档 PR | 5 分钟（计数修正） |
| 修订 T-1 | 🔴 风险 | Phase 2 | 0.5 天（移动 Protocol） |
| 修订 T-2 | 🔴 风险 | Phase 3 | 0.5 天（修改 Protocol docstring + RetryService 实现） |
| 修订 T-3 | 🟡 缺口 | Phase 1 | 0.5 天（Protocol docstring） |
| 修订 T-4 | 🟡 缺口 | Phase 2 | 0.5 天（状态机注释 + RetryService 文档） |
| 修订 T-5 | 🟡 缺口 | Phase 0 | 1 天（resolve_sync + get_settings + 测试 fixture） |
| 修订 T-6 | 🟡 缺口 | Phase 0 末 | 1 天（grep + 报告） |
| 修订 T-7 | 🟡 缺口 | Phase 1.5 | 1 周（独立 Phase） |
| 修订 T-8 | 🟡 缺口 | Phase 4 | 2-3 天（webui 兼容层） |
| 修订 T-9 | 🔴 风险 | Phase 3 | 1 天（grep + 转换映射 + 重写） |
| 修订 T-10 | 🟡 缺口 | Phase 0 | 1-2 天（DBHealthProbe） |
| 修订 T-11 | 🔴 风险 | Phase 0 | 0.5 天（shutdown 重写） |
| 修订 T-12 | 验收清单 | 全部 Phase | 0（grep 校验） |

**总追加工作量估算**：约 **2 周** 散布在 Phase 0/1/3/4。
**对原 10 周估算的影响**：+20%，即 ~12 周。

---

## 第五部分：建议的 PR 顺序

1. **PR #1**（文档修订）：A-1 + A-2 → `ARCHITECTURE_AUDIT_2026-06-18.md` 修订（5 分钟）
2. **PR #2**（架构修订）：T-1 到 T-12 → `TARGET_ARCHITECTURE_v2.3_2026-06-18.md` 新版（半天）
3. **PR #3**（Phase 0 入口）：基于修订版目标架构启动 Phase 0，含 T-5 / T-6 / T-10 / T-11
4. **PR #4**（Phase 0 出口）：产出 `phase0_shim_importers.txt` + `phase0_init_consumers.txt` + `phase0_reexport_consumers.txt`
5. **PR #5**（Phase 1.5 入口）：基于 Phase 1.5 试点启动
6. ...后续按原计划推进

---

文档结束。**总目标**：让目标架构从"理论上正确"演进为"工程上无歧义"——把每一个隐式假设变成显式契约，把每一个 AI 实现陷阱变成 grep 验证。