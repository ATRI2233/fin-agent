# TASK-402: modules/conversation/domain - conversation.py + message.py

> **阶段**: Phase 4 · **估时**: 2h · **优先级**: P1
> **上下文窗口**: 1 输入 · 2 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-402` |
| 所属阶段 | Phase 4 / conversation domain |
| 前置任务 | TASK-002, TASK-401 |
| 后置任务 | TASK-403, TASK-404 |
| 输出文件 | `src/main/modules/conversation/domain/conversation.py`, `message.py`, `domain/__init__.py` |

## 2. 目标

定义 `Conversation`, `Message`, `MessageRole` 聚合根。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §2 (conversation domain 部分)

### 3.2 类型依赖

- `infra.domain.ConversationId, AgentReference` (TASK-002)
- `infra.domain.MessageId` (TASK-002,前向引用:实际定义在 TASK-002 合并后落地于 `src/main/infra/domain.py`;本卡只引用符号,不新增 NewType 定义)

### 3.3 输出文件

1. `src/main/modules/conversation/domain/__init__.py`(空)
2. `src/main/modules/conversation/domain/conversation.py` - 含:
   - `@dataclass class Conversation`: `id: ConversationId`, `agent: AgentReference`, `title: str | None`, `created_at: datetime`, `updated_at: datetime`
3. `src/main/modules/conversation/domain/message.py` - 含:
   - `class MessageRole(str, Enum)`: `USER, ASSISTANT, SYSTEM` 3 个值
   - `@dataclass class Message`: `id: MessageId`, `conversation_id: ConversationId`, `role: MessageRole`, `content: str`, `created_at: datetime`

## 4. 详细步骤

### 4.1 conversation.py

1. `from __future__ import annotations`
2. `from dataclasses import dataclass`
3. `from datetime import datetime`
4. `from src.main.infra.domain import ConversationId, AgentReference`

### 4.2 message.py

1. `from enum import Enum`
2. `from dataclasses import dataclass`
3. `from datetime import datetime`
4. `from src.main.infra.domain import ConversationId`
5. `MessageRole(str, Enum)`: USER/ASSISTANT/SYSTEM

## 5. Do Not 清单

- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **Do Not(类型一致性)**: `Message.id` 必须是 `MessageId` (NewType,与 `TraceId/WorkflowId/ExecutionId/NodeId/SessionId/ConversationId` 风格一致),**禁止**裸 `str`

## 6. 验收标准

- [ ] `python -c "from src.main.modules.conversation.domain.conversation import Conversation"` 退出码 0
- [ ] `python -c "from src.main.modules.conversation.domain.message import Message, MessageRole"` 退出码 0
- [ ] `MessageRole.USER.value == "user"`
- [ ] `Conversation` 与 `Message` 是 dataclass

## 7. 非目标

- 不实现 ORM(后续 TASK-403)
- 不实现 service(TASK-404)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-402 交付说明

$ python -c "
from src.main.modules.conversation.domain.message import MessageRole
print(list(MessageRole))
"
[<MessageRole.USER: 'user'>, <MessageRole.ASSISTANT: 'assistant'>, <MessageRole.SYSTEM: 'system'>]
```
