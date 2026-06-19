# TASK-004: infra/api_envelope.py - API 响应信封

> **阶段**: Phase 0 · **估时**: 1h · **优先级**: P1
> **上下文窗口**: 1 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-004` |
| 所属阶段 | Phase 0 / infra |
| 前置任务 | TASK-001, TASK-003 |
| 后置任务 | TASK-407, TASK-411, TASK-013 |
| 输出文件 | `src/main/infra/api_envelope.py` |

## 2. 目标

定义所有 HTTP 响应统一格式 `{code, message, data, trace_id}` 的 dataclass 与构造工具。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.4

### 3.2 类型依赖

- `infra.domain.TraceId` (TASK-002)
- `infra.error_codes.ErrorCode` (TASK-003)
- `infra.errors.FinAgentError` (TASK-003)

### 3.3 输出文件

1. `src/main/infra/api_envelope.py` - 含:
   - `@dataclass(frozen=True) class ApiResponse`
   - `ApiResponse.to_dict(self) -> dict` 方法
   - `from_exception(cls, error: FinAgentError, trace_id: TraceId) -> ApiResponse` 类方法
   - `success(data: Any, trace_id: TraceId, message: str = "ok") -> ApiResponse` 类方法

## 4. 详细步骤

1. 顶部 `from __future__ import annotations`
2. `from dataclasses import dataclass` + `from typing import Any`
3. `from src.main.infra.domain import TraceId`
4. `from src.main.infra.error_codes import ErrorCode`
5. `from src.main.infra.errors import FinAgentError`
6. `ApiResponse` dataclass(frozen=True),字段: `code: ErrorCode`, `message: str`, `data: Any | None`, `trace_id: TraceId`
7. `to_dict` 返回 `{code: int(self.code), message, data, trace_id: str(self.trace_id)}`
8. `from_exception` 类方法: `code=err.code`, `message=err.message`, `data=err.details or None`, `trace_id=trace_id`
9. `success` 类方法: `code=ErrorCode.SUCCESS`, `message=message`, `data=data`, `trace_id=trace_id`

## 5. Do Not 清单

- [ ] **Do Not #4**: 异常必须结构化(继承 FinAgentError + ErrorCode) — 必须用 `ErrorCode` 枚举
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol — （本卡片只 import 公开符号）
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry

## 6. 验收标准

- [ ] `python -c "from src.main.infra.api_envelope import ApiResponse"` 退出码 0
- [ ] `ApiResponse.success({"x": 1}, TraceId("tr-abc"))` 返回 `code=ErrorCode.SUCCESS`
- [ ] `ApiResponse.success({"x": 1}, TraceId("tr-abc")).to_dict()` 输出含 `trace_id: "tr-abc"`
- [ ] `ApiResponse.from_exception(WorkflowNotFoundError("foo"), TraceId("tr-xyz"))` 返回 `code=ErrorCode.WORKFLOW_NOT_FOUND`, `data=None`
- [ ] `ApiResponse.from_exception(WorkflowNotFoundError("foo", details={"id": "foo"}), TraceId("tr-xyz")).to_dict()["data"] == {"id": "foo"}`

## 7. 非目标

- 不实现 FastAPI 响应类（task 407 写）
- 不实现 JSON 序列化（dataclass.asdict 即可）

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-004 交付说明

$ python -c "
from src.main.infra.api_envelope import ApiResponse
from src.main.infra.domain import TraceId
from src.main.infra.errors import WorkflowNotFoundError
r = ApiResponse.from_exception(WorkflowNotFoundError('wf-123', details={'id': 'wf-123'}), TraceId('tr-xyz'))
print(r.to_dict())
"
{'code': 1001, 'message': 'wf-123', 'data': {'id': 'wf-123'}, 'trace_id': 'tr-xyz'}
```
