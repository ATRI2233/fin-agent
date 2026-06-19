# TASK-003: infra/error_codes.py + infra/errors.py - 异常体系

> **阶段**: Phase 0 · **估时**: 4h · **优先级**: P0
> **上下文窗口**: 1 输入 · 2 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-003` |
| 所属阶段 | Phase 0 / infra |
| 前置任务 | TASK-001 |
| 后置任务 | TASK-004, 010, 105, 108, 201, 407, TASK-CCC-04 |
| 输出文件 | `src/main/infra/error_codes.py`, `src/main/infra/errors.py` |

## 2. 目标

定义全项目统一的异常层级与错误码枚举,作为所有 Protocol 方法签名 `Raises` 部分的依据。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.2, §3.3

### 3.2 类型依赖

- `TraceId`(字符串形式,前向引用 infra.domain.NewType;实际 import 留待 TASK-002 合并后)

### 3.3 输出文件

1. `src/main/infra/error_codes.py` - `class ErrorCode(IntEnum)`,按设计文档 §3.3 定义 14 个值（SUCCESS + 13 个错误码）
2. `src/main/infra/errors.py` - 含:
   - `class FinAgentError(Exception)` (根)
   - `class BizError(FinAgentError)`, `class SystemError(FinAgentError)`, `class InfraError(FinAgentError)` (3 个子类)
   - 12 个具体异常类（按设计文档 §3.2 表格,每个含 `code` 类属性与 `http_status` 类属性）

## 4. 详细步骤

### 4.1 error_codes.py

1. `from enum import IntEnum`
2. `class ErrorCode(IntEnum):` 按设计文档定义 14 个值,使用 `=` 赋值确保数字一致
3. 加 docstring 说明数字分段含义(1xxx=Biz, 2xxx=System, 3xxx=Infra)

### 4.2 errors.py

1. 顶部 `from __future__ import annotations`
2. `from typing import ClassVar, Any` + `TraceId` 用字符串注解(前向引用;实际 import 留待 TASK-002 合并后)
3. `from src.main.infra.error_codes import ErrorCode`
4. `FinAgentError`:
   - `code: ClassVar[ErrorCode]`
   - `http_status: ClassVar[int]`
   - `__init__(self, message: str, *, details: dict | None = None, cause: Exception | None = None)`
   - `to_envelope(self, trace_id: TraceId) -> dict` 方法返回 `{code, message, data, trace_id}`
5. 三个子类继承 FinAgentError,不重写 `__init__`
6. 12 个具体异常类按设计文档表格:
   - `WorkflowNotFoundError(BizError)`, `code=WORKFLOW_NOT_FOUND`, `http_status=404`
   - `ExecutionNotFoundError(BizError)`, `code=EXECUTION_NOT_FOUND`, `http_status=404`
   - `NodeNotFoundError(BizError)`, `code=NODE_NOT_FOUND`, `http_status=404`
   - `AgentNotFoundError(BizError)`, `code=AGENT_NOT_DEFINED`, `http_status=422`
   - `ValidationError(BizError)`, `code=VALIDATION_FAILED`, `http_status=422`
   - `InvalidStateTransitionError(SystemError)`, `code=INVALID_STATE_TRANSITION`, `http_status=500`
   - `ConfigError(SystemError)`, `code=CONFIG_INCONSISTENT`, `http_status=500`
   - `DatabaseError(InfraError)`, `code=DATABASE_FAILURE`, `http_status=500`
   - `AgentTimeoutError(InfraError)`, `code=AGENT_TIMEOUT`, `http_status=504`
   - `AgentHttp5xxError(InfraError)`, `code=AGENT_UPSTREAM_5XX`, `http_status=502`
   - `OpencodeUnavailableError(InfraError)`, `code=OPENCODE_UNAVAILABLE`, `http_status=503`
   - `McpServerError(InfraError)`, `code=MCP_SERVER_FAILURE`, `http_status=502`
   - 额外加 `TraceLostError(InfraError)`, `code=TRACE_LOST`, `http_status=500`（设计文档 §7.5 提到）
   - 额外加 `RegistryError(FinAgentError)`, `code=PROTOCOL_VIOLATION`, `http_status=500`（DI 异常）

## 5. Do Not 清单

- [ ] **Do Not #4**: 异常必须结构化(继承 FinAgentError + ErrorCode) — 所有异常必须继承本文件的具体类
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError — 异常必须显式 raise 本文件中的类
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol — （本卡片无跨模块 import）
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry

## 6. 验收标准

- [ ] `python -c "from src.main.infra.errors import FinAgentError, BizError, SystemError, InfraError, WorkflowNotFoundError"` 退出码 0
- [ ] `python -c "from src.main.infra.error_codes import ErrorCode; print(ErrorCode.WORKFLOW_NOT_FOUND)"` 输出 `ErrorCode.WORKFLOW_NOT_FOUND`
- [ ] `WorkflowNotFoundError("foo").code == ErrorCode.WORKFLOW_NOT_FOUND` 为 True
- [ ] `WorkflowNotFoundError("foo").http_status == 404` 为 True
- [ ] `BizError, SystemError, InfraError` 都是 `FinAgentError` 子类
- [ ] `BizError, SystemError, InfraError` 互不为子类（平级）
- [ ] 12 个表格中的异常类全部存在,无遗漏
- [ ] `TraceId` 在 errors.py 中以字符串注解形式出现(前向引用,TASK-002 合并后即可正常 import)

## 7. 非目标

- 不实现全局异常处理器（在 TASK-407）
- 不写 FastAPI 集成

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-003 交付说明

$ python -c "
from src.main.infra.errors import WorkflowNotFoundError
from src.main.infra.error_codes import ErrorCode
e = WorkflowNotFoundError('wf-123', details={'id': 'wf-123'})
print(e.code, e.http_status, e.message)
"
ErrorCode.WORKFLOW_NOT_FOUND 404 wf-123
```
