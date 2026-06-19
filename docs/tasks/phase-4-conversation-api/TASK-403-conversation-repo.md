# TASK-403: modules/conversation/repo - orm.py + conversation_repo.py

> **阶段**: Phase 4 · **估时**: 3h · **优先级**: P1
> **上下文窗口**: 3 输入 · 2 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-403` |
| 所属阶段 | Phase 4 / conversation repo |
| 前置任务 | TASK-002, TASK-009, TASK-402 |
| 后置任务 | TASK-404 |
| 输出文件 | `src/main/modules/conversation/repo/orm.py`, `conversation_repo.py`, `repo/__init__.py` |

## 2. 目标

定义 `ConversationORM`, `MessageORM` 与 Repository。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §2 (conversation repo 部分)
2. `src/main/modules/conversation/domain/*` (TASK-402)
3. `src/main/infra/db.py` (TASK-009) - 含 `Base`

### 3.2 类型依赖

- `infra.db.Base` (TASK-009)
- `infra.domain.ConversationId` (TASK-002)
- `modules.conversation.domain.conversation.Conversation, message.Message, MessageRole` (TASK-402)

### 3.3 输出文件

1. `src/main/modules/conversation/repo/__init__.py`(空)
2. `src/main/modules/conversation/repo/orm.py` - 含 2 个 ORM 类:
   - `class ConversationORM(Base)`: 字段 `id, agent_name, title, created_at, updated_at`
   - `class MessageORM(Base)`: 字段 `id, conversation_id (FK), role, content, created_at`
3. `src/main/modules/conversation/repo/conversation_repo.py` - 含:
   - `class SqlAlchemyConversationRepository`:
     - `create`, `get`, `list`, `append_message`, `get_messages`, `_to_domain` 转换

## 4. 详细步骤

### 4.1 orm.py

1. `from __future__ import annotations`
2. `from sqlalchemy import String, DateTime, ForeignKey, Text`
3. `from sqlalchemy.orm import Mapped, mapped_column, relationship`
4. `from src.main.infra.db import Base`
5. `ConversationORM` + `MessageORM`(一对多)

### 4.2 conversation_repo.py

1. `from src.main.modules.conversation.protocol import ConversationService`
2. `from src.main.modules.conversation.domain.conversation import Conversation`
3. `from src.main.modules.conversation.domain.message import Message, MessageRole`
4. `from src.main.modules.conversation.repo.orm import ConversationORM, MessageORM`
5. `from src.main.infra.domain import ConversationId, AgentReference`
6. `class SqlAlchemyConversationRepository`:
   - **写方法用 UoW 边界**(与 execution 一致风格)
   - `create(agent, title)`:
     - with uow.begin(): insert ConversationORM,return Conversation(id=...)
   - `append_message(conversation_id, role, content)`:
     - with uow.begin(): insert MessageORM

## 5. Do Not 清单

- [ ] **Do Not #5**: 事务边界 = UoW;执行器是纯函数
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol

## 6. 验收标准

- [ ] `python -c "from src.main.modules.conversation.repo.orm import ConversationORM, MessageORM"` 退出码 0
- [ ] `python -c "from src.main.modules.conversation.repo.conversation_repo import SqlAlchemyConversationRepository"` 退出码 0
- [ ] `ConversationORM.__tablename__ == "conversations"`
- [ ] `MessageORM.conversation_id` 是 ForeignKey
- [ ] `_to_domain(orm_row)` 返回 domain.Conversation(测试可手动 mock)

## 7. 非目标

- 不实现 service(TASK-404)
- 不实现 HTTP API(后续 TASK-408)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-403 交付说明

$ python -c "
from src.main.modules.conversation.repo.orm import ConversationORM, MessageORM
for c in (ConversationORM, MessageORM):
    print(c.__name__, c.__tablename__, 'cols:', [x.name for x in c.__table__.columns])
"
```
