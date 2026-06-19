# TASK-105: modules/agent/protocol.py - 所有 Agent Protocol

> **阶段**: Phase 1 · **估时**: 2h · **优先级**: P0（Protocol 优先）
> **上下文窗口**: 1 输入 · 1 输出
> **关联修订**: REVISION_NOTES_2026-06-18.md 修订 **T-3** + **Bug C-4 设计变更**（`dispatch_parallel.trace_id` 扩展为 `TraceId | list[TraceId] | None`,以兼容单 trace_id 广播与每 worker 独立 trace_id 两种场景）

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-105` |
| 所属阶段 | Phase 1 / agent |
| 前置任务 | TASK-002 |
| 后置任务 | TASK-106, TASK-107, TASK-108, TASK-109, TASK-302, TASK-410 |
| 输出文件 | `src/main/modules/agent/protocol.py` |

## 2. 目标

定义 agent 模块对外 Protocol: `AgentDispatcher`, `AgentBackend`, `SessionManager`,以及 `DispatchResult` 类型。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.6.1

### 3.2 类型依赖

- `infra.domain.TraceId, AgentReference, SessionId, ConversationId` (TASK-002)
- `AgentBackend` 全部 `create_session / send_message / wait_for_completion / abort_session` 等方法**含 `trace_id: TraceId` 参数**(审计/追踪传透);等待阶段 (`wait_for_completion`) 也必须含 `trace_id`,不可省略

### 3.3 输出文件

1. `src/main/modules/agent/protocol.py` - 含:
   - `DispatchResult` TypedDict: `result, session_id, raw`
   - `class AgentDispatcher(Protocol)`: `dispatch` + `dispatch_parallel`,签名严格照设计文档
   - `class AgentBackend(Protocol)`: `create_session, send_message, wait_for_completion, abort_session, cleanup_sessions, close`
   - `class SessionManager(Protocol)`: `bind, lookup`

## 4. 详细步骤

1. `from __future__ import annotations`
2. `from typing import Protocol, TypedDict, Any`
3. `from src.main.infra.domain import TraceId, AgentReference, SessionId, ConversationId`
4. `DispatchResult` TypedDict: `result: Any`, `session_id: SessionId`, `raw: str`
5. `AgentDispatcher`:
   - `dispatch(agent, prompt, *, timeout=None, session_id=None, reuse_session=False, trace_id) -> DispatchResult`
   - `dispatch_parallel(agents, prompt, *, timeout=None, trace_id: TraceId | list[TraceId] | None = None) -> tuple[list[DispatchResult], list[SessionId]]`
     - **`trace_id` 模式(Bug C-4 设计变更)**:
       - 单值 `TraceId`: 广播给所有 worker,每个 DispatchResult.raw 都对应同一 trace_id
       - `list[TraceId]`: 一一对应 `agents`,len 必须等于 len(agents);每个 worker 独立 trace_id
       - `None`(默认): dispatcher 自生成单一 trace_id 并广播给所有 worker
     - 设计原因: 修订 T-3 的 `dispatch_parallel` 仅支持单 trace_id 广播,但 Phase 1.5 `test_parallel_trace_isolation` 需要每个 worker 独立 trace_id 以验证 ContextVar 隔离;扩展签名兼容两种场景
6. `AgentBackend`:
   - `create_session(agent: AgentReference, trace_id: TraceId) -> SessionId`
   - `send_message(session_id, text, agent: AgentReference | None, trace_id) -> None`
   - `wait_for_completion(session_id, *, timeout: float, after_count: int, trace_id: TraceId) -> str`
   - `abort_session(session_id) -> None`
   - `cleanup_sessions(ids: list[SessionId]) -> dict[SessionId, str]`
   - `close() -> None`
7. `SessionManager`(**全部方法 `async def`**):
   - `async def bind(conversation_id, session_id) -> None`
   - `async def lookup(conversation_id) -> SessionId | None`
8. 所有 Protocol 标 `@runtime_checkable`

## 5. Do Not 清单

- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not #2**: 接口没对齐时用反射修补 = 隐藏 bug;改 Protocol
- [ ] **Do Not #16**: 任何 agent 层异常必须 catch 后包成 `AgentTimeoutError`/`AgentHttp5xxError`/`McpServerError` 之一
- [ ] **Do Not #17**（新增,A-9）: 迭代历史走 git / CHANGELOG

## 6. 验收标准

- [ ] `python -c "from src.main.modules.agent.protocol import AgentDispatcher, AgentBackend, SessionManager"` 退出码 0
- [ ] 3 个 Protocol 都是 `runtime_checkable`
- [ ] `AgentDispatcher.dispatch` 签名含 `trace_id: TraceId` keyword-only 参数
- [ ] `DispatchResult` 是 TypedDict

## 7. 非目标

- 不实现具体类
- 不写 `ServeBackend` 或 `AgentDispatcher`(其他卡片)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-105 交付说明

$ python -c "
import inspect
from src.main.modules.agent.protocol import AgentDispatcher
sig = inspect.signature(AgentDispatcher.dispatch)
print('params:', list(sig.parameters.keys()))
"
params: ['agent', 'prompt', 'timeout', 'session_id', 'reuse_session', 'trace_id']
```
