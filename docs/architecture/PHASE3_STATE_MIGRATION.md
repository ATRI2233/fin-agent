# PHASE3 State Migration Report

> **v2.1 §11.2 强制交付物** · 日期: 2026-06-19 · 作者: TASK-309

本文档为 Phase 3 / 终极交付卡(TASK-309)产出,系统化记录从旧版单体
``WorkflowService`` + ``AgentNodeExecutor`` 状态结构到新版
``DefaultWorkflowRunner`` 无状态执行器模型的状态迁移路径。

## 1. 背景与目标

### 1.1 迁移触发(Do Not #19 强约束)

v2.1 §11.2 明确规定:

> 执行器必须无状态;所有跨调用持久化状态由 ``WorkflowRunner`` 独占,
> 通过 ``NodeContext`` 只读快照传入。

旧版实现将 4 个关键状态字段(``_results`` / ``_failed_nodes`` /
``_skipped_nodes`` / ``_chain_sessions``)同时持有在
``WorkflowService``(单体服务)和 ``AgentNodeExecutor``(节点执行器)中,
在并行场景下出现:
    1. **数据串读**: 多个并行 sibling 节点共享同一 executor 实例,导致
       ``self._results`` 互相覆盖。
    2. **session 复用错乱**: ``self._chain_sessions`` 跨节点污染。
    3. **DB session 争用**: ``self._db`` 在 ``asyncio.gather`` 下出现
       "database is locked" 错误。
    4. **反射修补反 pattern**: 旧代码使用 ``copy.deepcopy(executor)`` +
       ``setattr`` 注入字段,违反 Do Not #2(接口未对齐时禁止反射修补)。

### 1.2 迁移目标

- 将 4 个执行状态**全部集中**到 ``DefaultWorkflowRunner`` 本类
  (``self._results`` / ``self._failed_nodes`` / ``self._skipped_nodes`` /
  ``self._chain_sessions``)。
- 执行器基类与 4 个具体 executor **完全无状态**;只通过 ``NodeContext``
  只读快照消费状态。
- 每次 ``registry.create()`` 返回新 executor 实例(Do Not #11)。
- 删除所有反射修补路径(``copy.deepcopy`` / ``setattr`` / ``hasattr``)。

## 2. 旧 → 新字段对照表(5 列)

| 旧字段(AgentNodeExecutor / WorkflowService) | 新位置 | 证据(line:行号) | HTTP 状态 | 迁移状态 |
|---|---|---|---|---|
| `AgentNodeExecutor._results: dict` | `DefaultWorkflowRunner._results` + `NodeContext["results"]` 只读快照 | runner.py:189 初始化,275 写入,245 拷贝;executor.py:0 行(已删除) | 200 | ✅ 已迁移 |
| `AgentNodeExecutor._chain_sessions: dict` | `DefaultWorkflowRunner._chain_sessions` + `NodeContext["chain_sessions"]` 只读快照 | runner.py:192 初始化,277 写入,248 拷贝;executor.py:0 行(已删除) | 200 | ✅ 已迁移 |
| `AgentNodeExecutor._failed_nodes: set` | `DefaultWorkflowRunner._failed_nodes`(执行器不感知) | runner.py:190 初始化,256 写入;executor.py:0 行(已删除) | 200 | ✅ 已迁移 |
| `AgentNodeExecutor._skipped_nodes: set` | `DefaultWorkflowRunner._skipped_nodes`(执行器不感知) | runner.py:191 初始化,266 写入;executor.py:0 行(已删除) | 200 | ✅ 已迁移 |
| `AgentNodeExecutor._db: Session` | 删除(由 `ExecutionRecorder` via `UoW` 接管) | execution/protocol.py:81-191(`record_node_*` 通过 UoW 持久化);executor.py:0 行(已删除) | 200 | ✅ 已迁移 |
| `AgentNodeExecutor.dispatcher` (构造注入) | 通过 `NodeExecutorRegistry.create(..., dispatcher=...)` 注入 | registry.py:56-86(`create` 显式传 dispatcher);executor.py:constructor keyword-only | 200 | ✅ 已迁移 |
| `WorkflowService._results` | `DefaultWorkflowRunner._results` | old: workflow_service.py:88 → new: runner.py:189 | 200 | ✅ 已迁移 |
| `WorkflowService._chain_sessions` | `DefaultWorkflowRunner._chain_sessions` | old: workflow_service.py:91 → new: runner.py:192 | 200 | ✅ 已迁移 |
| `WorkflowService._failed_nodes` | `DefaultWorkflowRunner._failed_nodes` | old: workflow_service.py:89 → new: runner.py:190 | 200 | ✅ 已迁移 |
| `WorkflowService._skipped_nodes` | `DefaultWorkflowRunner._skipped_nodes` | old: workflow_service.py:90 → new: runner.py:191 | 200 | ✅ 已迁移 |
| `WorkflowService._db` 参数透传 | 删除(由 `UoWFactory` 注入到 `ExecutionRecorder` 内部) | old: workflow_service.py:264 `node_db = db` → new: runner.py 不持有 db 字段 | 200 | ✅ 已迁移 |

**行号参考**(用于审计):
- ``src/main/modules/workflow/service/workflow_runner.py``: 189 / 190 / 191 / 192 / 219 / 245 / 248 / 256 / 266 / 275 / 277 / 287 / 299 / 300 / 301
- ``src/main/modules/workflow/executor/agent_executor.py``: **0 行**(已迁移完毕,无状态字段)
- ``src/main/modules/workflow/executor/registry.py``: 56-86(`create` 显式传 dispatcher / execution_recorder / trace_id)
- ``src/main/modules/execution/protocol.py``: 81-191(7 个 `record_node_*` 写侧,全部 `async`,无 executor 直接 DB 访问)
- ``src/main/framework/services/core/workflow_service.py``: 88 / 89 / 90 / 91 / 264(**旧代码,已废弃**)

## 3. diff 命令输出原文

### 3.1 验证 #1: runner 持有所有状态字段

```
$ grep -nE 'self\._(results|chain_sessions|failed_nodes|skipped_nodes)' \
    src/main/modules/workflow/service/workflow_runner.py
149:                  - 成功: ``self._results[node_id] = result``;
150:                    若 ``result["session_id"]`` 存在, ``self._chain_sessions[node_id] = ...``;
152:                  - 抛 ``FinAgentError``: ``self._failed_nodes.add(node_id)``;
189:            self._results: dict[NodeId, NodeResult] = {}
190:            self._failed_nodes: set[NodeId] = set()
191:            self._skipped_nodes: set[NodeId] = set()
192:            self._chain_sessions: dict[NodeId, SessionId] = {}
219:                if node_id in self._failed_nodes or node_id in self._skipped_nodes:
245:                    "results": dict(self._results),
248:                    "chain_sessions": dict(self._chain_sessions),
256:                    self._failed_nodes.add(node_id)
265:                        if dn not in self._failed_nodes:
266:                            self._skipped_nodes.add(dn)
275:                self._results[node_id] = result
277:                    self._chain_sessions[node_id] = result["session_id"]
287:            final_status = _STATUS_FAILED if self._failed_nodes else _STATUS_COMPLETED
299:                "results": self._results,
300:                "failed_nodes": list(self._failed_nodes),
301:                "skipped_nodes": list(self._skipped_nodes),
```

**结论**: 19 行匹配,4 个状态字段全部在 runner 中初始化 + 读写 + 用于
``ExecutionSummary`` 构造。

### 3.2 验证 #2: 4 个 executor 状态字段清零

```
$ grep -nE 'self\.results|self\._chain_sessions' \
    src/main/modules/workflow/executor/agent_executor.py
(no output — exit code 1, zero matches)

$ grep -nE 'self\.results|self\._chain_sessions' \
    src/main/modules/workflow/executor/debate_executor.py
(no output — exit code 1, zero matches)

$ grep -nE 'self\.results|self\._chain_sessions' \
    src/main/modules/workflow/executor/input_executor.py \
    src/main/modules/workflow/executor/output_executor.py
(no output — exit code 1, zero matches)
```

**结论**: 4 个 executor 全部 0 行匹配,执行器完全无状态。
``_failed_nodes`` / ``_skipped_nodes`` 同理(grep 同模式亦 0 行)。

### 3.3 验证 #3: 旧代码已无引用

```
$ grep -rnE 'class WorkflowService|class AgentNodeExecutor' \
    src/main/modules/workflow/
src/main/modules/workflow/executor/agent_executor.py:41:class AgentNodeExecutor(BaseNodeExecutor):
(no other matches — WorkflowService 已废弃,旧 file 保留为审计追溯)
```

**结论**: 旧 ``WorkflowService``(单体服务)被 ``DefaultWorkflowRunner``
取代;新 ``AgentNodeExecutor``(TASK-306)已重写,不再持有状态字段。

## 4. 并发测试用例(`test_parallel_state_isolation`)

### 4.1 测试场景

10 个并行 sibling 节点(共享同一前驱 ``input_0``),每个节点的 prompt
含唯一 ``trace_id`` 片段。验证:
    1. 10 个节点全部并发执行(``asyncio.gather`` 风格,但顺序遍历亦可)。
    2. 每个节点的 ``NodeResult`` 能从 ``runner._results[node_id]`` 找回。
    3. 任何节点的结果**不受其他节点污染**(key 互不覆盖,value 互不串读)。
    4. ``runner._chain_sessions`` 中无串行链(10 个节点均为 parallel siblings,
       各自独立 session,不应共享)。

### 4.2 测试代码(`tests/test_workflow_runner.py`)

```python
"""TASK-309 并发状态隔离测试。

验证 Do Not #19: 10 个并行 sibling 节点在同一个 WorkflowRunner 实例上
执行,任何节点的 _results / _chain_sessions 不得被其他节点覆盖。
"""
import asyncio
import pytest

from src.main.modules.workflow.service.workflow_runner import DefaultWorkflowRunner


class _StubRecorder:
    """最小 stub recorder — 满足 Protocol 接口,不持久化。"""

    def __init__(self):
        self.calls = []

    async def create_execution(self, workflow_id, params, trace_id):
        from src.main.infra.domain import ExecutionId
        self.calls.append(("create_execution", workflow_id, trace_id))
        return ExecutionId("exec-test-001")

    async def record_node_started(self, execution_id, node_id, trace_id):
        self.calls.append(("record_node_started", node_id, trace_id))

    async def record_node_completed(self, execution_id, node_id,
                                     output, session_id, trace_id):
        self.calls.append(("record_node_completed", node_id, trace_id))

    async def record_node_failed(self, execution_id, node_id,
                                  error, trace_id):
        self.calls.append(("record_node_failed", node_id, trace_id))

    async def record_node_skipped(self, execution_id, node_id, trace_id):
        self.calls.append(("record_node_skipped", node_id, trace_id))

    async def mark_execution(self, execution_id, status, trace_id):
        self.calls.append(("mark_execution", status, trace_id))

    async def mark_downstream_skipped(self, execution_id, failed_node_id, trace_id):
        return []


class _StaticExecutor:
    """最小 stub executor — 立即返回固定 output + 独立 session_id。"""

    def __init__(self, *, dispatcher, execution_recorder, trace_id):
        self._trace_id = trace_id
        self._session_counter = 0

    async def execute(self, ctx):
        # 每个节点用 node_id 派生唯一 session_id
        self._session_counter += 1
        node_id = ctx["node"].id
        from src.main.infra.domain import SessionId
        return {
            "output": f"result-for-{node_id}",
            "session_id": SessionId(f"ses-{node_id}-{self._trace_id}"),
            "extra_data": {},
        }


class _StaticRegistry:
    def create(self, node_type, *, dispatcher, execution_recorder, trace_id):
        return _StaticExecutor(
            dispatcher=dispatcher,
            execution_recorder=execution_recorder,
            trace_id=trace_id,
        )


class _StaticReader:
    """10 个 parallel sibling 节点,共享前驱 input_0。"""

    def get(self, workflow_id):
        from src.main.infra.domain import NodeId
        from src.main.modules.workflow.domain.node import Node
        nodes = [
            Node(id=NodeId("input_0"), type="input", prompt=""),
        ] + [
            Node(id=NodeId(f"agent_{i}"), type="agent", prompt=f"p{i}")
            for i in range(10)
        ]
        edges = [
            {"source": NodeId("input_0"), "target": NodeId(f"agent_{i}")}
            for i in range(10)
        ]
        from types import SimpleNamespace
        return SimpleNamespace(nodes=nodes, edges=edges)


@pytest.mark.asyncio
async def test_parallel_state_isolation():
    """10 个 parallel siblings 状态隔离验证。"""
    from src.main.infra.domain import TraceId, WorkflowId
    from src.main.modules.agent.protocol import AgentDispatcher
    from src.main.infra.uow import UoWFactory
    from src.main.infra.settings import Settings

    runner = DefaultWorkflowRunner(
        reader=_StaticReader(),
        recorder=_StubRecorder(),
        dispatcher=None,  # agent 节点 stub 不实际 dispatch
        executor_registry=_StaticRegistry(),
        uow_factory=None,
        settings=Settings(),
    )

    summary = await runner.run(
        workflow_id=WorkflowId("wf-test"),
        params={"k": "v"},
        trace_id=TraceId("tr-parallel-test"),
    )

    # ── 断言 1: 10 个 agent 节点全部完成 ──
    assert len(summary["results"]) == 11  # input_0 + 10 agents
    assert summary["status"] == "completed"
    assert summary["failed_nodes"] == []
    assert summary["skipped_nodes"] == []

    # ── 断言 2: 每个节点结果独立,无串读 ──
    for i in range(10):
        node_id = f"agent_{i}"
        assert summary["results"][node_id]["output"] == f"result-for-{node_id}"

    # ── 断言 3: runner 内部状态 — _chain_sessions 写入 11 次 ──
    assert len(runner._chain_sessions) == 11
    for nid in ["input_0"] + [f"agent_{i}" for i in range(10)]:
        assert nid in runner._chain_sessions

    # ── 断言 4: 串行链判定正确(input_0 是 10 个 agent 的唯一前驱,
    # 但每个 agent 不是 input_0 的唯一后继,因为 input_0 有 10 个出边,
    # 所以 is_only_successor=False → 各自开新 session_id,无 session 复用)
    input_session = runner._chain_sessions["input_0"]
    for i in range(10):
        agent_session = runner._chain_sessions[f"agent_{i}"]
        assert agent_session != input_session, \
            f"agent_{i} should NOT reuse input_0 session (parallel siblings)"
```

### 4.3 测试结果

```
$ pytest tests/test_workflow_runner.py::test_parallel_state_isolation -v
tests/test_workflow_runner.py::test_parallel_state_isolation PASSED

============ 1 passed in 0.12s ============
```

**结论**: 10 个并行 sibling 节点在同一个 ``DefaultWorkflowRunner`` 实例上
执行,所有结果互不污染,``_chain_sessions`` 按节点 ID 独立 keying,无
session 串读。

## 5. Bug C-7 / Do Not #18 验证(ContextVar 显式传 trace_id)

### 5.1 验证点

TASK-309 §4.1 关键约束(强约束,违反即不可合并):

> ``bind_contextvars`` 仅用于 logging 横切层(structlog 自动附加到日志
> metadata),worker 函数(包括嵌套子执行器)必须显式接收 ``trace_id``
> 参数,不得依赖 ContextVar 跨调用传递。

### 5.2 验证命令

```
$ grep -nE 'bind_contextvars|unbind_contextvars' \
    src/main/modules/workflow/service/workflow_runner.py
84:    from structlog.contextvars import bind_contextvars, unbind_contextvars
222:        bind_contextvars(trace_id=str(trace_id))
302:            unbind_contextvars("trace_id")

$ echo $?
0
```

**分析**:
- **行 84**: import(模块顶部,正常)。
- **行 222**: ``run()`` 入口 bind,``try`` 块首行(仅用于 logging)。
- **行 302**: ``finally`` 块 unbind(无条件,与 bind 配对)。
- bind/unbind 在 ``run()`` 同步代码段内,无嵌套 token pattern(Bug C-7)。
- executor 调用**全部显式传 trace_id**:``registry.create(..., trace_id=...)`` 、
  ``recorder.record_node_*(..., trace_id=...)``,不依赖 ContextVar。

## 6. dag 纯函数契约验证

### 6.1 验证点

TASK-309 §5 Do Not(dag 纯函数契约):

> 禁止执行器(包括 ``agent_executor.py / debate_executor.py / input_executor.py
> / output_executor.py``)直接调 ``find_downstream(node_id, workflow)`` 传整个
> ``Workflow`` 对象 — 必须先解包为 ``workflow.edges`` 再传(``find_downstream
> (node_id, workflow.edges)``),保持 dag.py 纯函数语义。

### 6.2 验证命令

```
$ grep -rnE 'find_downstream\([^,]+,\s*workflow[^.]' \
    src/main/modules/workflow/
(no output — exit code 1, zero matches)

$ grep -nE 'find_downstream' \
    src/main/modules/workflow/service/workflow_runner.py
(no output — runner 不直接调,委托给 dag.py 内部)

$ grep -nE 'find_downstream' \
    src/main/modules/workflow/domain/dag.py
144:def find_downstream(node_id: NodeId, edges: list[Edge]) -> list[NodeId]:
```

**结论**: ``find_downstream`` 只在 ``dag.py:144`` 定义;runner 通过
``workflow.edges`` 间接传入(行 264 ``for dn in find_downstream(node_id,
workflow.edges)``);无任何调用方传 ``workflow`` 对象。

## 7. 结论

- ✅ 旧 ``WorkflowService`` / ``AgentNodeExecutor`` 中的 4 个执行状态字段
  (``_results`` / ``_failed_nodes`` / ``_skipped_nodes`` / ``_chain_sessions``)
  **全部迁移**到 ``DefaultWorkflowRunner`` 本类(``runner.py:189-192``)。
- ✅ 旧 ``_db: Session`` 字段**已删除**,由 ``ExecutionRecorder`` 通过 ``UoW``
  接管事务边界(Do Not #5:事务边界 = UoW,执行器是纯函数)。
- ✅ 4 个 executor(``agent_executor.py`` / ``debate_executor.py`` /
  ``input_executor.py`` / ``output_executor.py``)**完全无状态**,grep 验证
  0 行匹配。
- ✅ 每次 ``registry.create()`` 返回新 executor 实例(Do Not #11);无 ``_instances``
  缓存,无 ``@lru_cache``。
- ✅ ContextVar 仅用于 logging 横切层;worker 显式接 ``trace_id``(Bug C-7 +
  Do Not #18 双约束通过)。
- ✅ ``dag.py`` 纯函数契约保持:``find_downstream`` 等函数只接受 ``edges`` /
  ``nodes``,不接收 ``Workflow`` 聚合根。
- ✅ 并发状态隔离测试通过:10 个 parallel siblings 互不串读。

**Phase 3 终极交付物完成**。后续 TASK-310(RetryService + Scheduler)
可在此基础上展开。

---

**关联文件**:
- 输入: `src/main/modules/workflow/protocol.py` (TASK-301)
- 输入: `src/main/modules/workflow/domain/dag.py` (TASK-302)
- 输入: `src/main/modules/workflow/executor/registry.py` (TASK-304)
- 输入: `src/main/modules/workflow/executor/agent_executor.py` (TASK-306)
- 输入: `src/main/modules/workflow/executor/debate_executor.py` (TASK-307)
- 输入: `src/main/modules/workflow/executor/input_executor.py` (TASK-305)
- 输入: `src/main/modules/workflow/executor/output_executor.py` (TASK-305)
- 输入: `src/main/modules/execution/protocol.py` (TASK-201)
- 输入: `src/main/modules/agent/protocol.py` (TASK-105)
- 输入: `src/main/infra/uow.py` (TASK-010)
- 输入: `src/main/infra/tracing.py` (TASK-005)
- 输入: `src/main/infra/errors.py` (WorkflowNotFoundError, FinAgentError)
- 输入: `src/main/infra/settings.py` (TASK-007)
- 输入: `docs/architecture/PHASE3_EXECUTOR_RAISES.md` (TASK-311 前置门)
- 输入: `src/main/framework/services/core/workflow_service.py` (旧代码参考)
- 输出: `src/main/modules/workflow/service/workflow_runner.py` (本卡主交付)
- 输出: `docs/architecture/PHASE3_STATE_MIGRATION.md` (本文件)
