# TASK-308: prompt_builder.py + workflow_query_service.py (2 文件)

> **阶段**: Phase 3 · **估时**: 4h · **优先级**: P1
> **上下文窗口**: 4 输入 · 2 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-308` |
| 所属阶段 | Phase 3 / workflow service |
| 前置任务 | TASK-301, TASK-302, TASK-303 |
| 后置任务 | TASK-408, TASK-409 |
| 输出文件 | `src/main/modules/workflow/service/prompt_builder.py`, `src/main/modules/workflow/service/workflow_query_service.py`, `service/__init__.py` |

## 2. 目标

模板渲染（PromptBuilder）与 Workflow CRUD 服务。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §2 (workflow service 部分)
2. `src/main/modules/workflow/protocol.py` (TASK-301)
3. `src/main/modules/workflow/domain/*` (TASK-302)
4. `src/main/modules/workflow/repo/workflow_repo.py` (TASK-303)

### 3.2 类型依赖

- 上述全部
- `infra.uow.UoWFactory` (TASK-010)
- `infra.domain.TraceId` (TASK-002)
- `PromptBuilder.build_prompt` 是 **sync 函数**(`def`,非 `async def`):纯字符串处理,无 IO,无 DB;后续若 RetryService 用 `retry_on_failure` 装饰器包它,装饰器包装的就是 sync 调用链(`await` 同步 sync 函数会触发 RuntimeError)。调用方在 async 上下文里可 `result = build_prompt(...)`,**不要**写 `await build_prompt(...)`。
- `WorkflowQueryService` 是 **sync 类**(SQLAlchemy 同步 session 语义):其 `create / get / list / update / delete / trigger` 6 个方法均为 `def`,**不**加 `async`(因为 `repo: SqlAlchemyWorkflowRepository` 是 sync 仓库,session 走 `Session()` 同步上下文管理器,改 `async` 会与 SQLAlchemy 2.0 同步 session 语义冲突)。调用方(router)在 async handler 中可 `result = svc.create(...)`,**不要** `await svc.create(...)`。

### 3.3 输出文件

1. `src/main/modules/workflow/service/__init__.py`(空)
2. `src/main/modules/workflow/service/prompt_builder.py` - 含:
   - `def build_prompt(template: str, *, node, edges, params: dict[str, Any], results, predecessor_ids, node_id) -> str`(**sync 函数**,非 `async def`):
     - 替换 `{{params.x}}`, `{{results.<pred_id>.output}}` 等占位符
     - 解析失败的占位符保留原文本
     - **同步性**:纯字符串处理,无 IO 无 DB,`def` 即可;不要为统一风格而加 `async`(后续 `retry_on_failure` 装饰器包的就是 sync 调用)
     - **类型化说明**: `params: dict[str, Any]`(业务字段在 `ExecutionParams` TypedDict — TASK-002 `infra.domain` 中定义,`build_prompt` 用宽泛类型接收)
3. `src/main/modules/workflow/service/workflow_query_service.py` - 含:
   - `class WorkflowQueryService`(**sync 类**,所有方法**不**加 `async`):
     - `__init__(self, reader: WorkflowReader, repo: SqlAlchemyWorkflowRepository, uow_factory: UoWFactory)`
     - `def create(self, workflow: Workflow, trace_id) -> WorkflowId`(sync,非 `async def`)
     - `def get(self, workflow_id) -> Workflow`(sync)
     - `def list(self, *, limit, offset) -> list[Workflow]`(sync)
     - `def update(self, workflow_id, **kwargs) -> Workflow`(sync)
     - `def delete(self, workflow_id) -> None`(sync)
     - `def trigger(self, workflow_id: WorkflowId, params: dict[str, Any], trace_id: TraceId) -> ExecutionId`(sync,返回 execution_id,实际执行由 WorkflowRunner 异步触发;`trigger` 自身**不**是 async,因为它只创建 Execution 占位记录)
     - **类型化说明**: `params` 字段类型为 `dict[str, Any]`,业务字段在 `ExecutionParams` TypedDict(TASK-002 `infra.domain` 导出)中定义;Service 层用宽泛 `dict[str, Any]` 接收,由调用方契约保证具体字段。

## 4. 详细步骤

### 4.1 prompt_builder.py

1. `from __future__ import annotations`
2. `import re`
3. `_PLACEHOLDER_RE = re.compile(r"\{\{([^}]+)\}\}")`
4. `def build_prompt(template, *, node, edges, params: dict[str, Any], results, predecessor_ids, node_id) -> str`:
   - 对每个 `{{path}}`:
     - 若 `path.startswith("params.")`: 取 `params[path[7:]]`
     - 若 `path.startswith("results.")`: `pred_id, _, rest = path[8:].partition("."); v = results[pred_id]["output"]; resolve v[rest]`
     - 找不到 → 保留原 `{{path}}`
   - return 替换后的字符串

### 4.2 workflow_query_service.py

1. `from src.main.modules.workflow.protocol import WorkflowReader`
2. `from src.main.modules.workflow.repo.workflow_repo import SqlAlchemyWorkflowRepository`
3. `from src.main.modules.workflow.repo.orm import WorkflowORM`
4. `from src.main.infra.uow import UoWFactory`
5. `from src.main.infra.domain import TraceId, WorkflowId`
6. `class WorkflowQueryService`:
   - 每个写操作 with uow_factory.begin() as uow: 操作 WorkflowORM
   - `trigger` 只创建 Execution 占位,实际 run 留给 WorkflowRunner 异步任务

## 5. Do Not 清单

- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #5**: 事务边界 = UoW;执行器是纯函数
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not(协议同步性)**: 禁止把 `PromptBuilder.build_prompt` 改 `async def`(`retry_on_failure` 装饰器包装的是 sync 调用,改 async 后装饰器内 `await` 同步函数会抛 `RuntimeError: object dict can't be used in 'await' expression`;且 build_prompt 是纯字符串处理,无任何 IO 需挂起)
- [ ] **Do Not(协议同步性)**: 禁止把 `WorkflowQueryService` 的 6 个方法(`create / get / list / update / delete / trigger`)改 `async def`(`SqlAlchemyWorkflowRepository` 是 SQLAlchemy 2.0 **同步** session 实现,改 async 会与 `Session()` 同步上下文管理器冲突,需引入 `AsyncSession` + `create_async_engine`,超出本任务范围。Router 在 async handler 中**直接同步调用** `svc.create(...)`,FastAPI 会自动在线程池内执行,不要 `await svc.create(...)`)
- [ ] **Do Not(类型一致性)**: `WorkflowQueryService.trigger` 的 `params` 参数**必须**有类型注解 — 至少 `dict[str, Any]`,业务侧优先用 `ExecutionParams` TypedDict(TASK-002 `infra.domain` 导出);`build_prompt` 的 `params` 形参同理。**禁止**完全无注解的 `params`(避免跨模块传递时类型裸奔)

## 6. 验收标准

- [ ] `python -c "from src.main.modules.workflow.service.prompt_builder import build_prompt"` 退出码 0
- [ ] `python -c "from src.main.modules.workflow.service.workflow_query_service import WorkflowQueryService"` 退出码 0
- [ ] `build_prompt("hello {{params.name}}", params={"name": "world"}, ...)` 返回 `"hello world"`
- [ ] `build_prompt("{{params.missing}}", params={}, ...)` 返回 `"{{params.missing}}"`(保留占位符)
- [ ] `build_prompt("{{results.n1.output}}", results={"n1": {"output": "ok"}}, ...)` 返回 `"ok"`

## 7. 非目标

- 不实现 WorkflowRunner(TASK-309)
- 不实现 RetryService(TASK-310)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-308 交付说明

$ python -c "
from src.main.modules.workflow.service.prompt_builder import build_prompt
ctx = dict(params={'name': 'foo'}, results={'n1': {'output': 'bar'}}, edges=[], predecessor_ids=[], node=None, node_id='x')
print(build_prompt('hi {{params.name}}', **ctx))
print(build_prompt('{{results.n1.output}}', **ctx))
"
hi foo
bar
```
