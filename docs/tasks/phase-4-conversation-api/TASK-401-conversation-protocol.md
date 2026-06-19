# TASK-401: modules/conversation/protocol.py - ConversationService Protocol

> **阶段**: Phase 4 · **估时**: 1h · **优先级**: P1（Protocol 优先）
> **上下文窗口**: 1 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-401` |
| 所属阶段 | Phase 4 / conversation |
| 前置任务 | TASK-002 |
| 后置任务 | TASK-402, TASK-403, TASK-404, TASK-410 |
| 输出文件 | `src/main/modules/conversation/protocol.py` |

## 2. 目标

定义 conversation 模块对外唯一公开 Protocol `ConversationService`。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.6.5

### 3.2 类型依赖

- `infra.domain.ConversationId, TraceId` (TASK-002)
- `infra.domain.AgentReference` (TASK-002)
- `modules.conversation.domain.message.MessageRole`(forward ref,本卡片用字符串)

### 3.3 输出文件

1. `src/main/modules/conversation/protocol.py` - 含:
   - `class ConversationService(Protocol)`: 5 个方法签名照抄设计文档 §3.6.5

## 4. 详细步骤

1. `from __future__ import annotations`
2. `from typing import Protocol, runtime_checkable`
3. `from src.main.infra.domain import ConversationId, AgentReference`
4. 5 个方法:
   - `async def create(self, agent: AgentReference, title: str | None) -> Conversation`
   - `async def list(self, *, limit: int, offset: int) -> list[Conversation]`
   - `async def get(self, conversation_id: ConversationId) -> Conversation | None`
   - `async def append_message(self, conversation_id: ConversationId, role: "MessageRole", content: str) -> Message`
   - `async def get_messages(self, conversation_id: ConversationId, *, limit: int, offset: int) -> list[Message]`
5. 标 `@runtime_checkable`

## 5. Do Not 清单

- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not #2**: 接口没对齐时用反射修补 = 隐藏 bug;改 Protocol

## 6. 验收标准

- [ ] `python -c "from src.main.modules.conversation.protocol import ConversationService"` 退出码 0
- [ ] `ConversationService` 是 `runtime_checkable` Protocol
- [ ] `append_message` 签名含 `role: "MessageRole"`(字符串形式避免循环依赖)

## 7. 非目标

- 不实现具体类

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-401 交付说明

$ python -c "
import inspect
from src.main.modules.conversation.protocol import ConversationService
for m in ('create','list','get','append_message','get_messages'):
    print(m, list(inspect.signature(getattr(ConversationService, m)).parameters.keys()))
"
```
