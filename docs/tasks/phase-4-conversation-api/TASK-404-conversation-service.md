# TASK-404: modules/conversation/service/conversation_service.py

> **阶段**: Phase 4 · **估时**: 3h · **优先级**: P1
> **上下文窗口**: 2 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-404` |
| 所属阶段 | Phase 4 / conversation service |
| 前置任务 | TASK-010, TASK-401, TASK-403 |
| 后置任务 | TASK-410 |
| 输出文件 | `src/main/modules/conversation/service/conversation_service.py`, `service/__init__.py` |

## 2. 目标

实现 `ConversationService` Protocol 的 SQLAlchemy 版本。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.6.5
2. `src/main/modules/conversation/protocol.py` (TASK-401)

### 3.2 类型依赖

- `modules.conversation.protocol.ConversationService` (TASK-401)
- `modules.conversation.repo.conversation_repo.SqlAlchemyConversationRepository` (TASK-403)
- `infra.uow.UoWFactory` (TASK-010)

### 3.3 输出文件

1. `src/main/modules/conversation/service/__init__.py`(空)
2. `src/main/modules/conversation/service/conversation_service.py` - 含:
   - `class DefaultConversationService(ConversationService)`:
     - `__init__(self, repo: SqlAlchemyConversationRepository)`
     - 5 个方法委托给 repo,加日志与 trace_id 字段填充

## 4. 详细步骤

1. `from __future__ import annotations`
2. `from src.main.modules.conversation.protocol import ConversationService`
3. `from src.main.modules.conversation.repo.conversation_repo import SqlAlchemyConversationRepository`
4. `class DefaultConversationService(ConversationService)`:
   - `__init__`: self.repo = repo
   - 每个方法直接调用 repo 对应方法(可加 bind_contextvars)
   - **不**直接操作 Session(由 repo 负责)

## 5. Do Not 清单

- [ ] **Do Not #5**: 事务边界 = UoW;执行器是纯函数
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol

## 6. 验收标准

- [ ] `python -c "from src.main.modules.conversation.service.conversation_service import DefaultConversationService"` 退出码 0
- [ ] `isinstance(DefaultConversationService(mock_repo), ConversationService)` True

## 7. 非目标

- 不实现 HTTP(后续 TASK-408)
- 不实现 chat dispatch(后续可加)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-404 交付说明

$ python -c "
from src.main.modules.conversation.service.conversation_service import DefaultConversationService
from src.main.modules.conversation.protocol import ConversationService
svc = DefaultConversationService(None)
assert isinstance(svc, ConversationService)
print('ok')
"
```
