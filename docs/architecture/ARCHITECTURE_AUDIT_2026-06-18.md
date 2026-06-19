# Fin-Agent 架构体检报告（首席架构师视角）

> 基于对 `container.py` / `workflow_engine.py` / `workflow_service.py` / `agent_executor.py` / `agent_dispatcher.py` / `node_executors/registry.py` / `serve_backend.py` / `retry_handler.py` / `protocols.py` / `settings.py` / `constants.py` / `opencode.json` / `controllers/workflows.py` 等核心文件的逐行审阅。
>
> 总体结论：**整体分层意识在，但"过渡态"代码大量残留**——典型的 AI 在重构过程中"加新层、但保留旧层、再加兼容垫片"留下的两层并跑。结构能跑，但任何二次开发都极易踩坑。下面按"架构图 → 坏味道 → 重构优先级"逐项展开。

---

## 1. 当前架构图（文本描述）

```
┌────────────────────────────────────────────────────────────────────────┐
│  WebUI (React, src/webui/src)                                          │
│    └── pages: WorkflowEditor / Monitor / Chat / Dashboard / Portfolio  │
│    └── 组件: workflow/nodes/* (Agent/Debate/Input/Output — React Flow)  │
└────────────────────────────────────────────────────────────────────────┘
                    │  HTTP (FastAPI 控制器)
                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Controllers (src/main/framework/controllers/*.py, 12 个)              │
│    thin handler 模式：Pydantic schema → Depends(get_service) → 服务    │
│    仍混着 imports:                                                     │
│      - controllers/workflows.py → from ...agent_executor import        │
│        _resolve_agent_name          ← 跨模块读私有函数                   │
│      - controllers/workflows.py → from ...workflow_graph import         │
│        （业务逻辑泄露到 controller）                                    │
└────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Service 层（双胞胎并跑）                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  services/core/  (canonical)  │ services/  (shim re-export)     │   │
│  │  ├── workflow_service.py       │ ├── workflow_service.py        │   │
│  │  ├── execution_service.py      │ ├── execution_service.py       │   │
│  │  ├── conversation_service.py   │ ├── ...                        │   │
│  │  ├── scheduler_service.py      │                                │   │
│  │  └── message_processor.py      │                                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  services/queries/  (只读查询): workflow/execution/agent/system/tool/  │
│                                dispatch/skill_query_service             │
│  services/patterns/  (横切): protocol/exceptions/prompt_builder/        │
│                                unit_of_work/workflow_graph              │
│                                                                         │
│  ⚠ 真实编排入口 WorkflowService 在 services/core/,                     │
│    但 controller 用的是 core.workflow_service 的导入路径,               │
│    同时 services/workflow_service.py 是 shim → 两条导入路径并存         │
└────────────────────────────────────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
┌──────────────────┐  ┌────────────────────────────────────┐
│  Repositories    │  │  Core 引擎（workflow/agents/...）   │
│  (5 个, SQLAlchemy) │  │                                    │
│  agent/execution/ │  │  workflow_engine.py (薄壳/兼容层)   │
│  workflow/conver- │  │      ↓ delegate ↓                  │
│  sation/mainten-  │  │  workflow_service.py (实际编排)     │
│  ance_repo        │  │      ↓ 注册表 ↓                    │
│                  │  │  node_executors/registry.py        │
│                  │  │      ├── base/        (基类)       │
│                  │  │      ├── agent/      (会话复用+    │
│                  │  │      │                 DB 提交)    │
│                  │  │      ├── debate/                   │
│                  │  │      ├── input/                    │
│                  │  │      └── output/                   │
└──────────────────┘  └────────────────────────────────────┘
        │                       │
        ▼                       ▼
┌──────────────────────────────────────────────────────────┐
│  Infrastructure (infrastructure/)                         │
│    ├── container.py          (DI, 700 行 — 详见下文)     │
│    ├── protocols.py          (AgentBackend/ExecutionStore │
│    │                          /JobStore — 仅 Protocol)   │
│    ├── retry_handler.py      (WorkflowRetryHandler +      │
│    │                          retry_on_failure 装饰器)    │
│    ├── auth / logger / event_bus / log_collector         │
│    ├── performance / request_context                      │
│    └── session_manager / session_cleanup                  │
└──────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────┐
│  Backend 实现（只有一个）                                  │
│  session/serve_backend.py → opencode serve (HTTP, 4096)   │
│    ⚠ 端口 4096 / 命令 `opencode serve --port 4096` 写死   │
└──────────────────────────────────────────────────────────┘
        │
        ▼  (子进程: opencode CLI)
┌──────────────────────────────────────────────────────────┐
│  Agent 运行时 (src/agents/opencode/)  +  MCP Servers      │
│    .opencode/opencode.json (Agent×MCP 工具白名单, 7 MCP)  │
│    .opencode/agents/*.md  (12 个 Agent 系统提示)          │
│    agents/mcp/{ashare, cn-macro, risk, sec-edgar} ← Python│
│    agents/mcp/{core, fred}                ← Node.js        │
└──────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────┐
│  数据层                                                    │
│  data/finagent.db (主) / maintenance.db / portfolio.db     │
│  models/: agent / conversation / workflow / workflow_      │
│          execution / Base                                  │
└──────────────────────────────────────────────────────────┘
```

**关键观察：**

- **DI 容器是唯一相对成熟的层**——但它自己也有双源问题（详见 §2）。
- **WorkflowEngine ↔ WorkflowService** 是 "双层编排"——一个做事、一个只是空壳但仍暴露相同 public API，让外部难以判断该用谁。
- **NodeExecutorRegistry ↔ agent_executor** 在用反射修补"构造函数签名不匹配"，意味着它们的契约不一致。
- **WebUI 通过 FastAPI → Controller → Service → Repo → SQLAlchemy**,但 **Agent 路径走的是子进程 + HTTP(opencode serve)+ JSON 字符串**,前端真实数据流要穿过 4 个进程边界。

---

## 2. 核心坏味道（按严重度分级）

### 🔴 P0 — 影响数据一致性 / 并发安全

#### 2.1 `AgentNodeExecutor` 持有 db Session 并自己 commit
**位置**: `core/workflow/node_executors/agent_executor.py:172-203`

```python
def _safe_db_update(self, ..., db=None):
    ...
    exec_node.completed_at = datetime.now(UTC)
    ...
    self._db.commit()      # ← 节点执行器直接 commit
except Exception as db_err:
    try: self._db.rollback() except Exception: pass
```

**问题**：
- 执行器不是事务边界——它跨越了 dispatch（HTTP 到 opencode,可能耗时 30s）+ DB 写入两个完全不同生命周期的资源。
- 并行分支时 `WorkflowService._execute_wrapped` 已经为每个并行节点开新 Session (`SessionLocal()`),但执行器内部还在 `self._db.commit()`,与外层 `unit_of_work` 概念完全脱钩。
- 失败回滚被 `except Exception: pass` 吞掉,任何 DB 异常都被静默——只会日志,不会向上抛。
- `agent_executor.py:139-152` 同时在做"内部重试 3 次",外层 `WorkflowRetryHandler.retry_node` 又是一套重试——**两层重试叠加**,实际重试次数是 3×3=9。

#### 2.2 跨模块私有属性写入
**位置**: `services/core/workflow_service.py:331-346`

```python
executor = copy.deepcopy(executor) if hasattr(executor, '__deepcopy__') else copy.copy(executor)
for attr in ("_chain_sessions", "_results", "_failed_nodes"):
    if hasattr(executor, attr):
        setattr(executor, attr, {})        # ← 直接 setattr 私有属性
if hasattr(executor, "_db"):
    if db is not None:
        try: db.rollback() except Exception: pass
    executor._db = db                      # ← 直接覆盖私有属性
if hasattr(executor, "dispatcher") and executor.dispatcher is None:
    executor.dispatcher = self._dispatcher
```

`WorkflowService` 用反射 + `setattr` 改 `AgentNodeExecutor` 的私有状态——**这是"两个类没谈拢接口,用反射强制对齐"的典型味道**。如果哪天 AgentNodeExecutor 把字段改名,这里会静默失败(因为外层是 `hasattr` 包裹)。

#### 2.3 `_sync_from_service` 复制状态,违反单一事实源
**位置**: `core/workflow/workflow_engine.py:187-195`

```python
def _sync_from_service(self, service: WorkflowService) -> None:
    """Copy service state back for collect_results / cleanup compat."""
    self._results = service._results
    self._failed_nodes = service._failed_nodes
    self._skipped_nodes = service._skipped_nodes
    self._chain_sessions = service._chain_sessions
    self.execution_id = service.execution_id
    self.nodes = service.nodes
    self.edges = service.edges
```

**WorkflowEngine 是"薄包装"但又复制全部状态**,意味着：
- 任何修改了 service 状态的代码,engine 上的视图会过时(直到下次 `execute` 调用才同步)。
- 调用方在 `engine.execute()` 之后读 `engine.results` 和读 `service.results` 会得到**两份不同的内存对象**。
- 这就是为什么 `_WorkflowRepoAdapter` / `_ExecServiceAdapter` 必须作为 inner class 放在 engine 文件里——它们本来属于 service 层的关注点,被强行搬到了"兼容层"。

---

### 🟠 P1 — 影响可测试性 / 模块边界

#### 2.4 DI 容器有 3 套注册 API + 双源 Service 映射表
**位置**: `core/infrastructure/container.py:66-90, 640-664`

```python
def register_singleton(self, cls, instance):  # cls.__name__ 作 key
def register_factory(self, cls, factory):     # cls.__name__ 作 key
def register(self, name, instance):           # 任意 string 作 key
```
然后:
```python
_SERVICE_MAP = {
    "WorkflowQueryService": "workflow_query_service",
    ...
}
def get_service(interface):
    prop = _SERVICE_MAP.get(interface.__name__)
    if prop is not None:
        return getattr(get_container(), prop)   # 路径 A
    return _from_factory()                       # 路径 B (从 _factories)
```

**问题**:
- **三个注册入口**(typed singleton / typed factory / 任意 string),三种 key 命名规则,没有任何统一约束。
- `_SERVICE_MAP` 把"类名 → 属性名"又重复定义了一遍——类名变了不会报错,只有运行时 `getattr` 失败。
- `register(name, instance)` 在测试 conftest 用,但生产代码用 `register_singleton`——**测试与生产走两条命名规则**,你换任何一处都会污染另一处。
- `create_message_processor()` (L454-463) 直接 `return None`,docstring 承认是"no-op placeholder"。这种僵尸工厂应被移除,不是保留。
- 模块级全局变量 `_container` + `configure()/get_container()` 与 DI 容器**并存**——你同时在用"DI"和"Service Locator"两个反模式。

#### 2.5 私有函数被到处 import
**位置**: 多处调用 `from main.framework.core.workflow.node_executors.agent_executor import _resolve_agent_name`

- `controllers/workflows.py:105`
- `core/workflow/workflow_engine.py:83, 286`
- (grep 显示至少 3 处)

**问题**: 函数名以下划线开头说明设计意图是"私有",但**4 个文件直接 import 它**——典型的"AI 先写了私有 helper,后来发现到处要用,又懒得提到公共命名空间"。
更糟的是这个函数做的是 **DTO 字段解析**(从 `node["agent"] / node["data"]["agentType"] / node["data"]["label"]`),这是一个明确的领域概念,应该有自己的类型 `AgentReference` 和显式 parser。

#### 2.6 字符串驱动的 NodeType + 反射修补构造函数
**位置**: `core/workflow/node_executors/registry.py:60-86`

```python
try:
    instance = cls()
except TypeError:
    import inspect
    sig = inspect.signature(cls.__init__)
    kwargs = {}
    for name, param in sig.parameters.items():
        if name == "self": continue
        if param.default is not inspect.Parameter.empty: continue
        kwargs[name] = None    # ← 用反射+None 修补
    instance = cls(**kwargs)
```

**问题**:
- 节点类型 `"input" / "output" / "debate" / "default"` 是**字符串字面量**,散落在 registry、WorkflowService、controller 三处。
- 反射修补意味着:如果 `AgentNodeExecutor` 构造函数新增一个无默认值的必需参数,这里会**用 None 注入**,运行到那一行才崩——registry 没有任何契约校验。
- registry 内的 `_instances` 是单例(per type),但 `WorkflowService.execute_node` 用 `copy.deepcopy` 来"防御"——这说明 **registry 设计错了,不该做缓存**。节点执行器应是无状态工厂,每次注入。

#### 2.8 双层 shim 模块 — 同一文件的两个导入路径
- `services/workflow_service.py` ← shim,re-export `services/core/workflow_service.py`
- `services/execution_service.py` ← shim,re-export `services/core/execution_service.py`
- 但**CLAUDE.md 没写**有 `services/core/` 这个目录,只说 `services/`。

意味着任何新人按 CLAUDE.md 找 `ExecutionService`,搜到的是 shim 文件,读不到真实代码——典型的"AI 改了目录结构但忘了改文档"。

---

### 🟡 P2 — 硬编码 / 配置泄漏

#### 2.9 配置分散在 4 个位置
| 位置 | 内容 | 例 |
|---|---|---|
| `config/settings.py` | 用 `pydantic-settings` 加载,带 `env_prefix="FIN_AGENT_"` | API_PORT=8000, NODE_TIMEOUT_SECONDS=600, SERVE_BACKEND_URL=http://127.0.0.1:4096 |
| `config/constants.py` | 4 个"业务常量" | MAX_AGENT_RETRIES=3, MAX_NODES_PER_WORKFLOW=20, MAINTENANCE_RETENTION_DAYS=30 |
| `settings.py:_find_opencode_bin()` | 写死的 4 个候选路径 | `agents/opencode/node_modules/opencode-ai/bin/opencode.exe` |
| `.opencode/opencode.json` | 12 个 Agent × 7 个 MCP × ~60 个工具的全量白名单 | `ashare-mcp-server_ashare_stock_lookup`, `sec-edgar-mcp_*` |
| 代码内 | inline 数值,常量没被复用 | `dispatch_parallel(timeout=300)`, `_wait_for_predecessors(deadline=600)`, `_parse_response(json.loads)`, `attempt < 2`, `1.0 * (attempt + 1)` |

**具体硬编码清单**(grep 重点项):

- `agent_executor.py:107` `os.path.join(".opencode", "agents", f"{agent}.md")` — **相对路径硬编码**,与运行 cwd 强耦合
- `serve_backend.py:177` `payload = {"agent": agent} if agent and agent != "opencode" else {}` — 字符串 `"opencode"` 是 sentinel
- `serve_backend.py:326` `if not session_id.startswith("ses_"):` — **业务规则靠字符串前缀**
- `agent_executor.py:142` `if "HTTP 5" in err_str` — **错误分类靠字符串包含匹配**(RuntimeError 文本),不是结构化异常分类

#### 2.10 测试覆盖 = 2 个文件
```
tests/
├── conftest.py              # SQLite fixture
├── test_conversation_service.py
└── test_state_machine.py
```
**没有任何一个测试覆盖**:WorkflowEngine / WorkflowService / Container / AgentDispatcher / NodeExecutorRegistry / ServeBackend / 任何一个 MCP server。
这种代码库的可重构性 = 0——你不知道改了什么会断什么。

---

### 🔵 P3 — 命名 / 文档漂移

#### 2.12 `CLAUDE.md` 的目录树与磁盘不完全一致
- CLAUDE.md 说 `src/webui/server/` 存在 → 实际目录结构是 `src/webui/`,server 子目录需要确认
- CLAUDE.md 没说 `src/main/framework/services/core/` 与 `services/queries/` 的双目录

---

## 3. 重构优先级建议（按风险×影响排序）

> 总原则：**先收"事务边界",再拆"职责重叠",最后清"配置与死代码"**。

### 🚑 第一波（1-2 周）— 数据一致性与并发安全

| # | 项 | 文件 | 风险 | 工作量 |
|---|---|---|---|---|
| 1 | **移除执行器内的 db.commit/rollback**,把 commit 收回 UnitOfWork 或 Service 层 | `agent_executor.py:172-203`,`workflow_service.py:388-414` | 高 | 3-5 天 |
| 2 | **统一重试**:删除 `agent_executor.py:128-152` 的内层重试,只保留 `WorkflowRetryHandler` 一层 | `agent_executor.py`,`retry_handler.py` | 高 | 1-2 天 |
| 3 | **ExecutionNode 状态机统一**:目前"failed / cleaned_up / completed / pending / skipped"是字符串散落,引入枚举 + 合法迁移表 | `workflow_service.py:404`, `_cleanup_sessions` | 中 | 2-3 天 |
| 4 | **并行节点 SQLite 锁**:确认 `_execute_wrapped` 在 `_parallel=True` 时开新 Session 是正确的(当前看起来对,但要在并发测试里压一压) | `workflow_service.py:262-288` | 中 | 2 天 + 压测 |

> 收益：消除"事务不一致 → 状态错乱 → 监控难复现"的灾难路径。

### 🛠 第二波（2-4 周）— 模块边界与单一职责

| # | 项 | 文件 | 风险 | 工作量 |
|---|---|---|---|---|
| 5 | **二选一**:删 `WorkflowEngine` 薄壳,或迁所有 controller/调用方到 `WorkflowService`;同步删 `_WorkflowRepoAdapter / _ExecServiceAdapter` 这两个 inline class | `workflow_engine.py:37-127, 187-195` | 中(需 API 影响分析) | 1 周 |
| 6 | **DI 容器收敛**:只保留 `register_singleton(cls, instance)` 一套 API;把 `_SERVICE_MAP` 改成装饰器自动注册;删除 `register()` 与 `create_message_processor` 占位 | `container.py:66-90, 640-664` | 中 | 3-5 天 |
| 7 | **公开 AgentReference**:把 `_resolve_agent_name` 提到 `agents/agent_reference.py`,给它一个正式的 `AgentReference` dataclass,4 个调用方全部改用 | 新增 + 4 文件改动 | 低 | 1-2 天 |
| 8 | **NodeExecutorRegistry 重写**:放弃单例缓存,改为 **typed factory**(每个 type 对应一个零参 factory function);节点类型从字符串改为 `NodeType` enum | `node_executors/registry.py` 整体 | 中 | 3 天 |
| 9 | **统一 shim 与 canonical 路径**:删除 `services/{workflow,execution,...}_service.py` shim,所有 import 指向 `services/core/`;同时更新 CLAUDE.md | 6 个文件 + 文档 | 低 | 0.5 天 |

> 收益：消除"两个并跑层 + 三套注册 + 跨边界私有调用"的认知负担，新人上手时间减半。

### 🧹 第三波（持续）— 配置 / 测试 / 文档

| # | 项 | 目标 | 工作量 |
|---|---|---|---|
| 11 | **把所有 inline 数值迁到 settings/constants**:`"opencode"`、`"ses_"`、`".opencode/agents"`、`"HTTP 5"` 等。给 constants.py 真正扩到 30+ 行,而不是 15 行做样子 | 单一配置源 | 1 周 |
| 12 | **结构化错误分类**:在 `serve_backend.py` 抛 `BackendHTTPError(status_code, body)`,替代"靠文本包含 HTTP 5 判断是否重试" | 可观测性 | 1-2 天 |
| 13 | **测试金字塔**:先给 WorkflowService / Container / AgentDispatcher 各写 5-8 个核心单测,目标覆盖率从 ~3% 拉到 ~40% | 重构底气 | 2 周 |
| 16 | **CLAUDE.md 与磁盘对齐**:用 `tree -L 3 -I __pycache__` 重生成目录树;显式标注"占位模块"与"canonical 路径" | 文档可信 | 1 天 |

---

## 4. 一句话诊断

**这个项目是"分层做对了、但每一层的内部都有至少一对重叠职责"的典型 AI 生成代码**：WorkflowEngine 与 WorkflowService 是双胞胎,Container 的三种 register API 是三胞胎,shim 与 canonical 是镜像,inline 数值与 settings/constants 是双源。要让这个项目从"能跑"升级到"可演进",最该做的是**先承认"现在就是过渡态",然后按上面三波顺序把每一对双胞胎收敛成一个**——而不是再加第四层来掩盖第三层。

---

## 附录 A：文件清单（被引用的核心文件）

| 文件 | 行数参考 | 关键观察 |
|---|---|---|
| `src/main/framework/core/infrastructure/container.py` | ~700 | DI 容器,3 套 register API + 双源 _SERVICE_MAP |
| `src/main/framework/core/workflow/workflow_engine.py` | ~305 | 薄壳 + _sync_from_service 状态复制 |
| `src/main/framework/core/workflow/node_executors/registry.py` | ~102 | 字符串 NodeType + 反射修补构造函数 |
| `src/main/framework/core/workflow/node_executors/agent_executor.py` | ~204 | 内层重试 + 私有 db.commit |
| `src/main/framework/core/agents/agent_dispatcher.py` | ~136 | 相对干净,但 `_parse_response` 返回原文无类型 |
| `src/main/framework/core/infrastructure/protocols.py` | ~130 | AgentBackend 已用,ExecutionStore/JobStore 未实现 |
| `src/main/framework/core/infrastructure/retry_handler.py` | ~239 | WorkflowRetryHandler 与 agent_executor 内层重试重复 |
| `src/main/framework/services/core/workflow_service.py` | ~510 | 实际编排,但用反射写私有属性 |
| `src/main/framework/services/workflow_service.py` | ~10 | shim,应删除 |
| `src/main/framework/services/execution_service.py` | ~4 | shim,应删除 |
| `src/main/framework/services/patterns/prompt_builder.py` | n/a | 未审但被 executor 引用 |
| `src/main/framework/services/patterns/workflow_graph.py` | n/a | DAG 图辅助函数 |
| `src/main/framework/controllers/workflows.py` | n/a | 仍 import 私有函数 _resolve_agent_name |
| `src/main/framework/config/settings.py` | ~48 | 7 个设置 + 1 个 binary 探测函数 |
| `src/main/framework/config/constants.py` | ~15 | 4 个常量,代码内 inline 重复定义 |
| `src/session/serve_backend.py` | ~407 | opencode 子进程 + HTTP,端口 4096 硬编码 |
| `.opencode/opencode.json` | ~567 | 7 MCP × 60+ 工具白名单 |
| `src/tests/` | 2 文件 | 仅 conftest + conversation + state_machine |

## 附录 B：建议的下一步

1. **立刻做（30 分钟）**：把这份报告提交 PR review,让团队对齐"过渡态"认知。
2. **下一周**:开"第一波 #1 事务边界"的 plan,我可以进入 plan 模式给出具体落地步骤（含单元测试方案）。
3. **下一月**:在事务边界稳定后,推进"第二波 #5 合并 WorkflowEngine 与 WorkflowService"——这是改动面最大但收益最高的项。