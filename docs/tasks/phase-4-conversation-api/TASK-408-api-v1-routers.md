# TASK-408: api/v1/* - 5 个 routers (workflows, executions, agents, mcp, conversations)

> **阶段**: Phase 4 · **估时**: 8h · **优先级**: P1
> **上下文窗口**: 7 输入 · 5 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-408` |
| 所属阶段 | Phase 4 / api v1 |
| 前置任务 | TASK-004, TASK-405, TASK-103, TASK-108, TASK-204, TASK-301, TASK-303, TASK-308 |
| 后置任务 | TASK-411 |
| 输出文件 | `src/main/api/v1/{__init__.py, workflows.py, executions.py, agents.py, mcp.py, conversations.py}` |

## 2. 目标

5 个 FastAPI routers,每个是 thin handler:`Depends(get_service)` → 调 service → 返回 `ApiResponse`。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §6.2
2. `src/main/api/deps.py` (TASK-405)
3. 各模块的 Protocol(TASK-103, 108, 201, 301, 401)

### 3.2 类型依赖

- `api.deps.service_dep, get_registry` (TASK-405)
- `infra.api_envelope.ApiResponse` (TASK-004)
- 各模块 Protocol

### 3.3 输出文件

1. `src/main/api/v1/__init__.py`(空)
2. `src/main/api/v1/workflows.py`:
   - `GET /api/v1/workflows`(list, query limit/offset)
   - `POST /api/v1/workflows`(create, body: WorkflowCreate)
   - `GET /api/v1/workflows/{id}`(get)
   - `PUT /api/v1/workflows/{id}`(update)
   - `DELETE /api/v1/workflows/{id}`(delete)
   - `POST /api/v1/workflows/{id}/trigger`(trigger, returns execution_id)
3. `src/main/api/v1/executions.py`:
   - `GET /api/v1/executions`(list, by workflow_id)
   - `GET /api/v1/executions/{id}`(detail + nodes)
   - `POST /api/v1/executions/{id}/abort`
   - `POST /api/v1/executions/{id}/nodes/{node_id}/retry`
4. `src/main/api/v1/agents.py`:
   - `GET /api/v1/agents`(list available)
   - `GET /api/v1/agents/{name}`(get definition)
5. `src/main/api/v1/mcp.py`:
   - `GET /api/v1/mcp/tools`(list, by server/category)
   - `GET /api/v1/mcp/servers`
   - `GET /api/v1/mcp/agents/{name}/allowed-tools`
6. `src/main/api/v1/conversations.py`:
   - `GET /api/v1/conversations`
   - `POST /api/v1/conversations`(create)
   - `GET /api/v1/conversations/{id}`(detail + messages)
   - `POST /api/v1/conversations/{id}/messages`(append)

## 4. 详细步骤(以 workflows.py 为例,其他类同)

1. `from fastapi import APIRouter, Depends, HTTPException, status`
2. `from pydantic import BaseModel`
3. `from src.main.api.deps import service_dep, get_registry`
4. `from src.main.infra.api_envelope import ApiResponse`
5. `from src.main.infra.tracing import current_trace_id`
6. `router = APIRouter(prefix="/api/v1/workflows", tags=["workflows"])`
7. Pydantic schema:`WorkflowCreate`, `WorkflowUpdate`, `WorkflowTrigger`
8. `async def list_workflows(limit: int = 20, offset: int = 0, svc: WorkflowReader = Depends(service_dep(WorkflowReader))) -> dict`:
   - `data = svc.list(limit=limit, offset=offset)`
   - `return ApiResponse.success([w.to_dict() for w in data], current_trace_id()).to_dict()`
9. trigger 端点触发 `WorkflowRunner.run(...)` 作为 background task

## 5. Do Not 清单

- [ ] **Do Not #4**: 异常必须结构化(继承 FinAgentError + ErrorCode)
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **Do Not #18**: ContextVar 在跨 Task 调度时只继承调度时刻快照,子 Task 的 set 不会回写;一旦污染,日志 trace_id 错乱且不可复现

## 6. 验收标准

- [ ] `python -c "from src.main.api.v1.workflows import router"` 退出码 0
- [ ] 4 个其他 router 同上
- [ ] FastAPI test client:mock registry + override,`GET /api/v1/workflows` 返回 `{"code":0, "message":"ok", "data": [...], "trace_id": "tr-..."}`
- [ ] response header 含 `X-Trace-Id`
- [ ] **关键 grep**: `grep -nE 'try:.*except Exception: pass' src/main/api/v1/*.py` → 0

## 7. 非目标

- 不实现 app factory(TASK-409 范围)
- 不实现 background task 调度(用 FastAPI BackgroundTasks 即可)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-408 交付说明

$ python -c "
from src.main.api.v1 import workflows, executions, agents, mcp, conversations
for m in (workflows, executions, agents, mcp, conversations):
    print(m.router.prefix, len(m.router.routes))
"
/api/v1/workflows 6
/api/v1/executions 4
/api/v1/agents 2
/api/v1/mcp 3
/api/v1/conversations 4
```
