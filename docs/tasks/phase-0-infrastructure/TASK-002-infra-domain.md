# TASK-002: infra/domain.py - 共享值对象

> **阶段**: Phase 0 · **估时**: 3h · **优先级**: P0
> **上下文窗口**: 1 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-002` |
| 所属阶段 | Phase 0 / infra |
| 前置任务 | TASK-001, TASK-003（修正：原 §4 step 5 自报依赖 TASK-003 但 §1 元数据漏标） |
| 后置任务 | TASK-005, 101, 105, 201, 301, 401, 402, 014 (新增) |
| 输出文件 | `src/main/infra/domain.py` |

## 2. 目标

定义跨模块共享的 ID 类型与值对象。所有 Protocol/DTO 都引用本文件的基础类型。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.1

### 3.2 类型依赖

无（这是 infra 最早的文件）

### 3.3 输出文件

1. `src/main/infra/domain.py` - 含以下符号:
   - `TraceId`, `WorkflowId`, `ExecutionId`, `NodeId`, `SessionId`, `ConversationId` (均为 `NewType("X", str)`)
   - `@dataclass(frozen=True) class AgentReference`: 字段 `name: str`, `definition_path: Path | None`
   - `@classmethod AgentReference.from_node(cls, node: dict) -> AgentReference`
   - `@dataclass(frozen=True) class RetryPolicy`: 字段 `max_attempts: int = 3`, `base_delay: float = 1.0`, `backoff: float = 2.0`, `circuit_breaker_threshold: int = 5`

## 4. 详细步骤

1. 顶部 `from __future__ import annotations`
2. `from dataclasses import dataclass` + `from pathlib import Path` + `from typing import NewType`
3. 6 个 `NewType` 定义按设计文档 §3.1
4. `AgentReference` dataclass 用 `@dataclass(frozen=True)`
5. `AgentReference.from_node`: 按 `node["agent"] → node["data"]["agentType"] → node["data"]["label"]` 顺序解析,首个非空即返回;全空时 raise `BizError(ErrorCode.AGENT_NOT_SPECIFIED, ...)` — **见步骤 5 解决循环依赖**
6. `RetryPolicy` dataclass 默认值如设计文档

### 步骤 5 的循环依赖处理

`AgentReference.from_node` 需要 `BizError + ErrorCode`,但 BizError 在 TASK-003 产出。两种解决方案:

- **方案 A（推荐）**: 本卡片先 `from src.main.infra.errors import BizError` + `from src.main.infra.error_codes import ErrorCode`,依赖 TASK-003 必须**先完成**或与本卡片并行但**本卡片最后跑**
- **方案 B**: 本卡片先 `raise ValueError(...)` 占位,TASK-003 完成后由 TASK-003 的子代理或后续 PR 替换为 BizError

**强制**: 采用方案 A。本卡片**必须**在 TASK-003 之后开始,不在 INDEX 依赖图里写错。修正: 本卡片**前置任务追加 TASK-003**。

## 5. Do Not 清单

- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol — （本卡片无跨模块 import,自然满足）
- [ ] **Do Not #7**: 全部走 `settings.py`(pydantic-settings) — （domain 不依赖环境）
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **Do Not #新增**: 禁止在 domain.py 内定义 Protocol 或抽象基类（仅值对象）

## 6. 验收标准

- [ ] 文件 `src/main/infra/domain.py` 存在
- [ ] `python -c "from src.main.infra.domain import TraceId, WorkflowId, ExecutionId, NodeId, SessionId, ConversationId, AgentReference, RetryPolicy"` 退出码 0
- [ ] `AgentReference(name="x", definition_path=None)` 是 frozen 实例
- [ ] `AgentReference.from_node({"agent": "foo"})` 返回 `name="foo"`
- [ ] `AgentReference.from_node({"data": {"agentType": "bar"}})` 返回 `name="bar"`
- [ ] `AgentReference.from_node({"data": {"label": "baz"}})` 返回 `name="baz"`
- [ ] `AgentReference.from_node({})` 抛 `BizError`
- [ ] `RetryPolicy()` 默认值符合设计文档

## 7. 非目标

- 不实现 `TraceLostError` 校验（TASK-005）
- 不定义 Protocol（仅值对象）
- 不写 SQLAlchemy ORM

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-002 交付说明

### 验收命令输出
$ python -c "from src.main.infra.domain import AgentReference; ar = AgentReference.from_node({'agent': 'macro-scout'}); print(ar)"
AgentReference(name='macro-scout', definition_path=PosixPath('.opencode/agents/macro-scout.md'))

$ python -c "from src.main.infra.domain import RetryPolicy; print(RetryPolicy())"
RetryPolicy(max_attempts=3, base_delay=1.0, backoff=2.0, circuit_breaker_threshold=5)
```
