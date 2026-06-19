# TASK-107: modules/agent/adapter/serve_backend.py - AgentBackend 实现

> **阶段**: Phase 1 · **估时**: 4h · **优先级**: P1
> **上下文窗口**: 3 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-107` |
| 所属阶段 | Phase 1 / agent adapter |
| 前置任务 | TASK-002, TASK-003, TASK-007, TASK-105 |
| 后置任务 | TASK-108 |
| 输出文件 | `src/main/modules/agent/adapter/serve_backend.py`, `src/main/modules/agent/adapter/__init__.py` |

## 2. 目标

实现 `AgentBackend` Protocol,封装 opencode serve HTTP API。**所有端口/路径从 settings 读**;**所有错误转 FinAgentError 子类**。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §5.1 (opencode 配置), §3.6.1
2. `src/main/session/serve_backend.py`(旧实现,作为参考,但**禁止直接拷贝**)
3. `src/main/modules/agent/protocol.py` (TASK-105)

### 3.2 类型依赖

- `infra.domain.TraceId, AgentReference, SessionId` (TASK-002)
- `infra.settings.Settings` (TASK-007)
- `settings.TRACE_ID_ENV_VAR` (TASK-007)—**不** import `infra.tracing.current_trace_id`(修订 T-7:trace_id 走参数)
- `infra.errors.AgentTimeoutError, AgentHttp5xxError, OpencodeUnavailableError, McpServerError` (TASK-003)
- `modules.agent.protocol.AgentBackend` (TASK-105)

### 3.3 输出文件

1. `src/main/modules/agent/adapter/__init__.py`(空)
2. `src/main/modules/agent/adapter/serve_backend.py` - 含:
   - `class ServeBackend`:
     - `__init__(self, settings: Settings)`
     - 所有方法严格按 AgentBackend Protocol 签名
     - `create_session(agent: AgentReference, trace_id: TraceId) -> SessionId`:**接收 trace_id 参数**,**禁止**内部调 `current_trace_id()` 取(修订 v2.1 §7.6 修订 T-7 — asyncio.gather 并行 worker 继承父 ContextVar,无法 trace 隔离)
     - spawn 子进程时:`env = {**os.environ, settings.TRACE_ID_ENV_VAR: str(trace_id)}`(用参数,不用 ContextVar)
     - 命令:`[settings.OPENCODE_BIN, "serve", "--port", str(settings.OPENCODE_SERVE_PORT)]`
     - HTTP 错误统一 catch 并分类:
       - `httpx.HTTPStatusError`: 若 5xx → `AgentHttp5xxError(status, body)`;若 4xx → `McpServerError(status, body)`
       - `httpx.RequestError` / `httpx.TimeoutException` → `OpencodeUnavailableError`
       - `asyncio.TimeoutError` → `AgentTimeoutError`

## 4. 详细步骤

### 4.0 准备: 创建空 `__init__.py`

```python
# Step 0: 创建空 __init__.py(占位模块入口,后续 import 必备)
import os
os.makedirs("src/main/modules/agent/adapter", exist_ok=True)
with open("src/main/modules/agent/adapter/__init__.py", "w", encoding="utf-8") as f:
    pass
```

### 4.1 serve_backend.py

1. `from __future__ import annotations`
2. `import asyncio` + `import os` + `import httpx`
3. `from src.main.infra.domain import TraceId, AgentReference, SessionId`
4. `from src.main.infra.settings import Settings`
5. `from src.main.infra.errors import AgentTimeoutError, AgentHttp5xxError, OpencodeUnavailableError, McpServerError`
6. `from src.main.modules.agent.protocol import AgentBackend`
7. `class ServeBackend(AgentBackend)`:
   - `__init__`: self.settings = settings; self._http = None; self._proc = None; self._ready = False
   - `_ensure_server()`: 检查 _proc 健康,否则 spawn
   - `_spawn(trace_id: TraceId)`: 用 asyncio.create_subprocess_exec, env 含 TRACE_ID(**用参数 trace_id,不是 current_trace_id()**)
   - `_get_http()`: 懒创建 httpx.AsyncClient(base_url=settings.opencode_serve_url, timeout=...)
   - `create_session(agent: AgentReference, trace_id: TraceId) -> SessionId`: POST /session, body `{"agent": agent.name}`(若 agent.name != "opencode");**强制要求**: trace_id 必须**作为入参**传入,函数体内部**禁止** `from src.main.infra.tracing import current_trace_id`(**修订 T-7**:asyncio.gather 并行 worker 全部继承父 ContextVar,无法 trace 隔离,trace_id 会被污染为父值;因此入参是唯一可靠来源)。构造 env 时必须用入参 trace_id,不要从任何 ContextVar 读取:
     ```python
     def create_session(self, agent: AgentReference, trace_id: TraceId) -> SessionId:
         # 关键:trace_id 来自入参,绝对不调 current_trace_id()
         env = {**os.environ, settings.TRACE_ID_ENV_VAR: str(trace_id)}
         ...
     ```
     签名的同步性:**方法体是 sync**(httpx 调用为 `httpx.Client` 同步版本或放入 `_get_http()` 的同步封装),`create_session` 自身**不是** `async def`(修订 T-7 + asyncio.gather 调用方需 sync 入口)。若未来要改 async,需先审计所有 gather 站点,本任务**不做** async 改造。
   - `send_message`: POST /session/{sid}/message;catch HTTPStatusError → AgentHttp5xxError 或 McpServerError
   - `wait_for_completion`: 实际由 send_message 同步等待,这里仅返回 last assistant 文本
   - `abort_session`: POST /session/{sid}/abort
   - `cleanup_sessions`: DELETE /session/{sid}
   - `close`: aclose http + kill proc
8. **关键**: 端口号完全从 `settings.OPENCODE_SERVE_PORT` 读,禁止字面量
9. **关键(修订 T-7)**: trace_id 全部走方法入参,**禁止**任何路径出现 `from src.main.infra.tracing import current_trace_id`(ContextVar 在 asyncio.gather 并行场景下无法 trace 隔离)

## 5. Do Not 清单

- [ ] **Do Not #8**: 全部走 `settings.py` 或 `constants.py` — 全部从 settings
- [ ] **Do Not #4**: 异常必须结构化(继承 FinAgentError + ErrorCode) — 用 `httpx.HTTPStatusError.response.status_code` 范围判断
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError — 必须 raise FinAgentError
- [ ] **Do Not #16**: 任何 agent 层异常必须 catch 后包成 `AgentTimeoutError`/`AgentHttp5xxError`/`McpServerError` 之一 — httpx 异常必须包成 Agent*/Opencode*/McpServer* 之一
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **Do Not(修订 T-7)**: 禁止在 `create_session` 内部用 `current_trace_id()` 取 trace_id — 必须用 `trace_id` 参数。asyncio.gather 并行 worker 全部继承父 ContextVar,无法 trace 隔离,trace 会全部相同,污染日志

## 6. 验收标准

- [ ] `python -c "from src.main.modules.agent.adapter.serve_backend import ServeBackend"` 退出码 0
- [ ] `isinstance(ServeBackend(Settings()), AgentBackend)` 为 True
- [ ] `ServeBackend(Settings()).close()` 不抛(无 spawn 时)
- [ ] **不实际 spawn opencode**(测试只测初始化 + close;集成测试在 TASK-411)
- [ ] `grep -nE '"4096"|4096,' src/main/modules/agent/adapter/serve_backend.py` → 0 结果
- [ ] `grep -nE 'OPENCODE_BIN|OPENCODE_SERVE_PORT' src/main/modules/agent/adapter/serve_backend.py` 命中

## 7. 非目标

- 不集成 retry(TASK-310 workflow 层负责)
- 不写集成测试

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-107 交付说明

$ python -c "
from src.main.modules.agent.adapter.serve_backend import ServeBackend
from src.main.modules.agent.protocol import AgentBackend
from src.main.infra.settings import Settings
b = ServeBackend(Settings())
assert isinstance(b, AgentBackend)
b.close()
print('init + close ok')
"

$ grep -nE '\"4096\"|4096,' src/main/modules/agent/adapter/serve_backend.py
(no output)
```
