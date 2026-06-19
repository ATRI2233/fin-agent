# TASK-114: Phase 1.5 — trace_id 显式参数化局部验证（单链路试点）

> **阶段**: Phase 1.5（**独立 Phase**,夹在 Phase 1 与 Phase 2 之间） · **估时**: 30h · **优先级**: P0
> **上下文窗口**: 4 输入 · 2 输出
> **关联修订**: REVISION_NOTES_2026-06-18.md 修订 **T-7**（trace_id 签名变更工作量爆炸需局部验证）
> **风险等级**: 🔴 高 — 决定后续 Phase 2/3/4 trace_id 全量参数化是否降级

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-114` |
| 所属阶段 | Phase 1.5 / tracing validation |
| 前置任务 | TASK-005 (tracing), TASK-105 (agent/protocol), TASK-107 (serve_backend), TASK-108 (agent-dispatcher) |
| 后置任务 | Phase 2 / Phase 3 / Phase 4 所有 trace_id 相关改动卡片 |
| 输出文件 | `src/main/modules/agent/service/agent_dispatcher.py`（仅 trace_id 签名局部改造）, `tests/modules/agent/test_dispatcher.py` |
| 输出报告 | `docs/architecture/PHASE_1_5_TRACE_ID_REPORT.md` |

## 2. 目标

在 Phase 2/3/4 全面铺开 trace_id 显式参数化之前,**先对单链路（AgentDispatcher → ServeBackend）做端到端试点**,验证 §7.6 契约的工作量假设,避免 Phase 2 启动时才发现工作量爆炸（修订 T-7 指出原 10 周估时可能 +30%）。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §7.6（并行上下文传播契约）
2. `docs/architecture/REVISION_NOTES_2026-06-18.md` 修订 T-7
3. `src/main/modules/agent/protocol.py` (TASK-105) — AgentDispatcher / AgentBackend Protocol
4. `src/main/modules/agent/adapter/serve_backend.py` (TASK-107)

### 3.2 类型依赖

- `infra.tracing.TraceId, bind_contextvars, unbind_contextvars` (TASK-005)
- `modules.agent.protocol.AgentDispatcher, AgentBackend` (TASK-105)
- `modules.agent.adapter.serve_backend.ServeBackend` (TASK-107)
- `structlog.contextvars.bind_contextvars / unbind_contextvars`

### 3.3 输出文件

1. **修改** `src/main/modules/agent/protocol.py`:
   - `AgentDispatcher.dispatch` 与 `dispatch_parallel` 方法签名已含 `trace_id: TraceId`(TASK-105 已实现,本卡无需改)
   - `AgentBackend.create_session / send_message / wait_for_completion` 签名已含 `trace_id: TraceId`(同上)
   - **本卡不修改 Protocol,只验证调用方签名**
2. **修改** `src/main/modules/agent/service/agent_dispatcher.py`:
   - **确认** `dispatch` 与 `dispatch_parallel` 的 worker 函数体内显式 `bind_contextvars(trace_id=...)` + `unbind_contextvars(...)` 配对
   - **确认** 内部调用 `self.backend.create_session(agent, trace_id=trace_id)` 时显式传参(不依赖 ContextVar)
3. **修改** `src/main/modules/agent/adapter/serve_backend.py`:
   - **确认** `create_session` 内部 `spawn opencode 子进程` 时 `env[FIN_AGENT_TRACE_ID] = str(trace_id)`(已实现,本卡验证)
4. **新增** `tests/modules/agent/test_dispatcher.py` — 至少 5 个 test 覆盖:
   - `test_serial_trace_passthrough`: 串行链路 trace_id 从 dispatcher → backend → 模拟 env 变量一致
   - `test_parallel_trace_isolation`: **修订 T-7 要求必过** —— 10 个并发 dispatch,各自 trace_id 不串
   - `test_gather_worker_signature`: 静态分析(asyncio.gather 周围 worker 函数签名含 trace_id: TraceId)
   - `test_bind_unbind_paired`: 任何 bind_contextvars 必须配对 unbind_contextvars(用 AST 或 mock 验证)
   - `test_serve_backend_env_var`: ServeBackend.create_session 设置 FIN_AGENT_TRACE_ID 环境变量

## 4. 详细步骤

### 4.1 Phase 1.5 范围（严格限制）

✅ **允许修改**:
- `tests/modules/agent/test_dispatcher.py` (新增)
- 上述 agent 模块**已有**的 trace_id 签名调用点(仅确认,不改 Protocol)
- `docs/architecture/PHASE_1_5_TRACE_ID_REPORT.md` (新增报告)

❌ **禁止修改**(本卡不动):
- `modules/execution/*` — Phase 2 范围
- `modules/workflow/*` — Phase 3 范围
- `api/v1/*` — Phase 4 范围
- `main.py` lifespan — TASK-409 范围（TASK-411 只负责 `build_registry` 与 `__main__` 入口）

### 4.2 test_parallel_trace_isolation 参考实现

```python
import asyncio
import structlog
from src.main.modules.agent.service.agent_dispatcher import DefaultAgentDispatcher
from src.main.infra.domain import TraceId, AgentReference, SessionId

class MockBackend:
    """Mock AgentBackend: 捕获每次调用的 trace_id"""
    def __init__(self):
        self.calls = []  # list[TraceId]

    async def create_session(self, agent, trace_id):
        self.calls.append(trace_id)
        return SessionId(f"ses-{trace_id}")

    async def send_message(self, session_id, text, agent, trace_id):
        self.calls.append(trace_id)

    async def wait_for_completion(self, session_id, *, timeout, after_count):
        # 返回的 trace_id 必须能从当前 contextvars 读到
        from structlog.contextvars import bind_contextvars
        from src.main.infra.tracing import current_trace_id
        captured = current_trace_id()
        return captured

    async def abort_session(self, session_id): pass
    async def cleanup_sessions(self, ids): return {}
    async def close(self): pass


@pytest.mark.asyncio
async def test_parallel_trace_isolation():
    backend = MockBackend()
    dispatcher = DefaultAgentDispatcher(backend=backend, settings=...)

    # Bug C-4: 传入 list[TraceId] 而非单 trace_id
    # 每个 worker 独立 trace_id,验证 dispatch_parallel 的 list 模式
    traces: list[TraceId] = [TraceId(f"tr-{i:08x}") for i in range(10)]
    agents = [AgentReference(name=f"agent-{i}", definition_path=None) for i in range(10)]

    # dispatch_parallel 接收 list[TraceId] 时,len 必须 == len(agents)
    # 每个 worker 拿到对应的 trace_id(trace_id[i] -> agents[i])
    results, extra_sids = await dispatcher.dispatch_parallel(
        agents=agents,
        prompt="hello",
        trace_id=traces,  # list[TraceId] 模式
    )

    # 验证 1: 返回的 DispatchResult 数量与 agents 一致
    assert len(results) == 10
    assert extra_sids == []  # 默认实现无 follow-up session

    # 验证 2: 每个 DispatchResult.raw 必须等于对应 trace_id
    # DispatchResult.raw 是 wait_for_completion 的返回值,即 current_trace_id()
    for trace_id, result in zip(traces, results):
        assert result["raw"] == str(trace_id), \
            f"trace_id 串了: expected {trace_id}, got {result['raw']}"

    # 验证 3: backend 收到的 trace_id 调用序列与输入 traces 一一对应
    # create_session / send_message 各 10 次,值与 traces 完全一致
    assert backend.calls == traces  # 创建 + 发送共 20 次,但 calls 顺序与 worker 顺序对齐


@pytest.mark.asyncio
async def test_parallel_trace_broadcast():
    """Bug C-4: 单 trace_id 广播模式回归测试(修订 T-3 既有行为)"""
    backend = MockBackend()
    dispatcher = DefaultAgentDispatcher(backend=backend, settings=...)

    shared = TraceId("tr-shared")
    agents = [AgentReference(name=f"agent-{i}", definition_path=None) for i in range(3)]

    results, _ = await dispatcher.dispatch_parallel(
        agents=agents,
        prompt="hello",
        trace_id=shared,  # 单值广播
    )

    # 三个 worker 收到同一 trace_id
    for r in results:
        assert r["raw"] == str(shared)
```

### 4.3 PHASE_1_5_TRACE_ID_REPORT.md 内容

按修订 T-7 要求,报告至少含:

1. **改动行数统计**:
   - `agent_dispatcher.py`: 新增/修改行数 X
   - `serve_backend.py`: 新增/修改行数 Y
   - 测试代码: Z 行
2. **工作量结论**:
   - **判定 1**: 实际改动 ≤ 200 行 → Phase 2/3/4 按原计划全量铺开 trace_id 显式参数化
   - **判定 2**: 实际改动 > 200 行 → Phase 2-4 的 trace_id 参数化**降级**为"仅并行节点路径强制,串行路径保留 ContextVar 隐式"
3. **测试结果**:
   - `test_serial_trace_passthrough` PASSED/FAILED
   - `test_parallel_trace_isolation` PASSED/FAILED
4. **预算修正**: 原 10 周估时 +N% 修正
5. **下一步建议**: 是否进入 Phase 2 / 是否需要修订 T-13

## 5. Do Not 清单

- [ ] **Do Not #18**: ContextVar 在跨 Task 调度时只继承调度时刻快照,子 Task 的 set 不会回写;一旦污染,日志 trace_id 错乱且不可复现 — ContextVar 在跨 Task 调度时只继承调度时刻快照,子 Task 的 set 不会回写;一旦污染,日志 trace_id 错乱且不可复现
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **修订 T-7 约束**: **禁止**跳过 Phase 1.5 直接进入 Phase 2;**禁止**在 Phase 1.5 范围内修改 execution / workflow / api 任何文件
- [ ] **修订 T-7 判定门**: 若改动量 > 200 行,必须**显式**在 PHASE_1_5_TRACE_ID_REPORT.md 中写"判定 2: 降级",且必须在 Phase 2 启动前对 v2.1 §7.6 做出降级修订

## 6. 验收标准

- [ ] `tests/modules/agent/test_dispatcher.py` 存在,含 ≥ 5 个 test
- [ ] `pytest tests/modules/agent/test_dispatcher.py -v` 全绿(含 `test_parallel_trace_isolation`)
- [ ] **关键 grep #1**: `grep -nE 'bind_contextvars' src/main/modules/agent/service/agent_dispatcher.py` 命中 ≥ 1
- [ ] **关键 grep #2**: `grep -nE 'bind_contextvars' src/main/modules/agent/service/agent_dispatcher.py` 在每个匹配点都能找到对应 `unbind_contextvars` 配对(同函数 finally 块)
- [ ] **关键 grep #3**: `grep -nE 'trace_id_var\.set|trace_ctx_var\.set' src/main/modules/agent/` 在 worker 体内 → 0
- [ ] `docs/architecture/PHASE_1_5_TRACE_ID_REPORT.md` 已提交,含改动行数 + 判定门结论 + 测试通过截图
- [ ] **关键 grep #4**: `grep -nE 'FIN_AGENT_TRACE_ID' src/main/modules/agent/adapter/serve_backend.py` 命中 ≥ 1(env var 设置)
- [ ] `git diff --stat` 显示本卡片**仅修改** agent 模块 + 测试 + 报告,未触及 execution / workflow / api

## 7. 非目标

- 不修改 Protocol 签名(TASK-105/107 已含 trace_id)
- 不实现全链路 trace_id 透传(Phase 2/3/4 范围)
- 不写 main.py lifespan(TASK-409 范围；TASK-411 仅管 build_registry + __main__)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-114 交付说明

### 改动量统计
$ git diff --stat src/main/modules/agent/ tests/modules/agent/
src/main/modules/agent/service/agent_dispatcher.py  | 12 ++++++++----
src/main/modules/agent/adapter/serve_backend.py     |  4 ++--
tests/modules/agent/test_dispatcher.py              | 87 +++++++++++++++++++++++++++++++++++++++++++++++
PHASE_1_5_TRACE_ID_REPORT.md                        | 65 +++++++++++++++++++++++++++++++++
4 files changed, 159 insertions(+), 9 deletions(-)

### 判定
[ ] 判定 1（≤ 200 行,全量铺开）
[ ] 判定 2（> 200 行,降级为仅并行路径强制）

### 测试结果
$ pytest tests/modules/agent/test_dispatcher.py -v
test_dispatcher.py::test_serial_trace_passthrough PASSED
test_dispatcher.py::test_parallel_trace_isolation PASSED
test_dispatcher.py::test_gather_worker_signature PASSED
test_dispatcher.py::test_bind_unbind_paired PASSED
test_dispatcher.py::test_serve_backend_env_var PASSED
============================= 5 passed ==============================

### grep 验证
$ grep -nE 'trace_id_var\.set|trace_ctx_var\.set' src/main/modules/agent/
(no output — confirmed no direct ContextVar.set in agent module)

### 偏离 / 备注
（如有:为什么降级 / 为什么工作量偏离 / 后续卡片需要知道什么）
（如无:无偏离,严格按修订 T-7 执行）
```
