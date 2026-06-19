# TASK-108: modules/agent/service/agent_dispatcher.py

> **阶段**: Phase 1 · **估时**: 4h · **优先级**: P1
> **上下文窗口**: 3 输入 · 1 输出
> **关联修订**: REVISION_NOTES_2026-06-18.md 修订 **T-3**（`dispatch_parallel` 返回 `extra_session_ids` 语义澄清）+ **Bug C-4 设计变更**（`dispatch_parallel.trace_id` 扩展为 `TraceId | list[TraceId] | None`）

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-108` |
| 所属阶段 | Phase 1 / agent service |
| 前置任务 | TASK-002, TASK-003, TASK-007, TASK-105, TASK-107 |
| 后置任务 | TASK-310, TASK-408, TASK-410 |
| 输出文件 | `src/main/modules/agent/service/agent_dispatcher.py`, `src/main/modules/agent/service/__init__.py` |

## 2. 目标

实现 `AgentDispatcher` Protocol。**严禁重试**(retry 在 workflow 层);**超时由 settings 决定**;**所有错误转 FinAgentError 子类**。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.6.1, §4.2
2. `src/main/modules/agent/protocol.py` (TASK-105)
3. `src/main/modules/agent/adapter/serve_backend.py` (TASK-107)

### 3.2 类型依赖

- `infra.domain.*` (TASK-002)
- `infra.settings.Settings.NODE_TIMEOUT_SECONDS` (TASK-007)
- `infra.errors.*` (TASK-003)
- `modules.agent.protocol.AgentDispatcher, AgentBackend, DispatchResult` (TASK-105)

### 3.3 输出文件

1. `src/main/modules/agent/service/__init__.py`(空)
2. `src/main/modules/agent/service/agent_dispatcher.py` - 含:
   - `class DefaultAgentDispatcher`:
     - `__init__(self, backend: AgentBackend, settings: Settings)`
     - 实现 `dispatch` 与 `dispatch_parallel`
     - **无 retry 装饰器**;**无内层循环**
     - parse_response: try `json.loads`, except fallback to raw string

## 4. 详细步骤

### 4.0 准备: 创建空 `__init__.py`

```python
# Step 0: 创建空 __init__.py(占位模块入口,后续 import 必备)
import os
os.makedirs("src/main/modules/agent/service", exist_ok=True)
with open("src/main/modules/agent/service/__init__.py", "w", encoding="utf-8") as f:
    pass
```

### 4.1 agent_dispatcher.py

1. `from __future__ import annotations`
2. `import json`, `import asyncio`
3. `from src.main.infra.domain import TraceId, AgentReference, SessionId`
4. `from src.main.infra.settings import Settings`
5. `from src.main.modules.agent.protocol import AgentDispatcher, AgentBackend, DispatchResult`
6. `class DefaultAgentDispatcher(AgentDispatcher)`:
   - `__init__`: self.backend = backend; self.settings = settings
   - `async def dispatch(self, agent, prompt, *, timeout=None, session_id=None, reuse_session=False, trace_id)`:
     - `timeout = timeout or self.settings.NODE_TIMEOUT_SECONDS`
     - `created_new = False`
     - `if session_id: await self.backend.send_message(session_id, prompt, agent, trace_id)`
     - `else: session_id = await self.backend.create_session(agent, trace_id); await self.backend.send_message(session_id, prompt, agent, trace_id); created_new = True`
     - `try: raw = await self.backend.wait_for_completion(session_id, timeout=timeout, after_count=0)`
     - `return {"result": self._parse(raw), "session_id": session_id, "raw": raw}`
     - `finally: if created_new and not reuse_session: await self.backend.abort_session(session_id)`
   - **`async def dispatch_parallel(self, agents, prompt, *, timeout=None, trace_id: TraceId | list[TraceId] | None = None)`**（修订 T-3 语义约束 + Bug C-4 设计变更）:
     - **trace_id 解析**(Bug C-4): 入口先归一化 `trace_id` 为 `list[TraceId]`,与 `agents` 一一对应:
       - 若 `trace_id is None` → 自生成 `single = TraceId(uuid4().hex)`,然后 `per_worker = [single] * len(agents)`(广播)
       - 若 `isinstance(trace_id, list)` → 校验 `len(trace_id) == len(agents)`,否则 raise `ValueError("dispatch_parallel: trace_id list length must equal agents length")`;`per_worker = list(trace_id)`
       - 否则(`TraceId` 单值) → `per_worker = [trace_id] * len(agents)`(广播给所有 worker)
     - `tasks = [self.dispatch(a, prompt, timeout=timeout, reuse_session=True, trace_id=t) for a, t in zip(agents, per_worker)]`
     - `results = await asyncio.gather(*tasks, return_exceptions=True)`
     - 把 Exception 包成统一 `DispatchResult`:`{"result": None, "session_id": None, "raw": str(e)}`(错误信息放 `raw`,不引入新 `error` 字段,严格匹配 TypedDict)
     - **返回** `(results, extra_session_ids)`,其中:
       - `results`: 与 `agents` 顺序一一对应,**每个 DispatchResult 已含自己的 primary `session_id`**
       - `extra_session_ids`: **debate-style 辅助 session ID**(例如同一次 dispatch 内打开的 follow-up session);**MUST NOT** 与 `results[i].session_id` 重叠
     - 调用方使用 `extra_session_ids` 填充下游 `NodeResult.extra_data["debate_session_ids"]`
     - 当前默认实现 `extra_session_ids = []`(单 dispatch 不开 follow-up,留接口给后续 debate 场景)
   - `@staticmethod _parse_response(raw: str) -> Any`: json.loads or raw

## 5. Do Not 清单

- [ ] **Do Not #8**（P8 重试只一层）: 全部走 `settings.py` 或 `constants.py` — 重试归 TASK-310
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #4**: 异常必须结构化(继承 FinAgentError + ErrorCode)
- [ ] **Do Not #16**: 任何 agent 层异常必须 catch 后包成 `AgentTimeoutError`/`AgentHttp5xxError`/`McpServerError` 之一
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **Do Not #18**: ContextVar 在跨 Task 调度时只继承调度时刻快照,子 Task 的 set 不会回写;一旦污染,日志 trace_id 错乱且不可复现 — ContextVar 在跨 Task 调度时只继承调度时刻快照,子 Task 的 set 不会回写;一旦污染,日志 trace_id 错乱且不可复现
- [ ] **修订 T-3 约束**: `dispatch_parallel` 返回的 `extra_session_ids` **禁止**与 `results[i].session_id` 重叠(可加断言 `assert all(sid not in [r['session_id'] for r in results] for sid in extra_session_ids)`)

## 6. 验收标准

- [ ] `python -c "from src.main.modules.agent.service.agent_dispatcher import DefaultAgentDispatcher"` 退出码 0
- [ ] `isinstance(DefaultAgentDispatcher(mock_backend, Settings()), AgentDispatcher)` 为 True
- [ ] **关键 grep**: `grep -nE 'for attempt in range|@retry_on_failure|retry' src/main/modules/agent/service/agent_dispatcher.py` → 0 结果(除 `reuse_session` 关键字外)
- [ ] **关键 grep**: `grep -nE 'trace_id' src/main/modules/agent/service/agent_dispatcher.py` 命中 ≥ 4 处(参数 + 调用 backend 时传入)
- [ ] `_parse_response('{"x":1}')` 返回 `{"x":1}`;`_parse_response('not json')` 返回原文
- [ ] **修订 T-3 验证**: `dispatch_parallel` 返回 `(results, [])`,且 `len(results) == len(agents)`;`assert all(sid not in extra for sid, extra in zip([r["session_id"] for r in results], [[]] * len(results)))` 通过

## 7. 非目标

- 不实现 session_manager(TASK-109)
- 不实现 retry(workflow 层)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-108 交付说明

$ grep -nE 'for attempt in range|@retry_on_failure' src/main/modules/agent/service/agent_dispatcher.py
(no output — confirmed no inner retry)

$ grep -nE 'trace_id' src/main/modules/agent/service/agent_dispatcher.py
47: def dispatch(self, ..., trace_id: TraceId):
63: self.backend.send_message(session_id, prompt, agent, trace_id)
65: self.backend.create_session(agent, trace_id)
78: def dispatch_parallel(self, ..., trace_id: TraceId):
```
