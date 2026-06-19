# TASK-109: modules/agent/service/session_manager.py + output_parser.py

> **阶段**: Phase 1 · **估时**: 3h · **优先级**: P1
> **上下文窗口**: 1 输入 · 2 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-109` |
| 所属阶段 | Phase 1 / agent service |
| 前置任务 | TASK-002, TASK-105 |
| 后置任务 | TASK-410 |
| 输出文件 | `src/main/modules/agent/service/session_manager.py`, `src/main/modules/agent/service/output_parser.py` |

## 2. 目标

实现 `SessionManager` Protocol 与 opencode 输出解析器(`strip_thinking`)。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.6.1

### 3.2 类型依赖

- `infra.domain.SessionId, ConversationId` (TASK-002)
- `modules.agent.protocol.SessionManager` (TASK-105)

### 3.3 输出文件

1. `src/main/modules/agent/service/session_manager.py` - 含:
   - `class InMemorySessionManager`:
     - `__init__`: `self._map: dict[ConversationId, SessionId] = {}`
     - `async def bind(self, conversation_id, session_id)`: `self._map[conversation_id] = session_id`
     - `async def lookup(self, conversation_id) -> SessionId | None`: `return self._map.get(conversation_id)`
     - 加 `async def unbind(self, conversation_id)` 辅助方法(供 cleanup)
2. `src/main/modules/agent/service/output_parser.py` - 含:
   - `def strip_thinking(text: str) -> str`: 用正则去除 `<thinking>...</thinking>` 块(包括 multiline)
   - `def extract_text(opencode_response: dict) -> str`: 从 opencode API 响应提取 part 文本

## 4. 详细步骤

### 4.1 session_manager.py

1. `from __future__ import annotations`
2. `from src.main.infra.domain import SessionId, ConversationId`
3. `from src.main.modules.agent.protocol import SessionManager`
4. `class InMemorySessionManager(SessionManager)`:
   - 注意 `_map` 是可变 dict,但**实例属性**,非模块全局;线程安全本卡片不强制(单进程 FastAPI)

### 4.2 output_parser.py

1. `import re`
2. `_THINKING_RE = re.compile(r"<thinking>.*?</thinking>", re.DOTALL)`
3. `def strip_thinking(text: str) -> str`:
   - `return _THINKING_RE.sub("", text).strip()`
4. `def extract_text(data: dict) -> str`:
   - 遍历 `data.get("parts", [])`,累加 `type == "text"` 的 `text` 字段
   - return `"".join(text_parts)`

## 5. Do Not 清单

- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol

## 6. 验收标准

- [ ] `python -c "from src.main.modules.agent.service.session_manager import InMemorySessionManager"` 退出码 0
- [ ] `python -c "from src.main.modules.agent.service.output_parser import strip_thinking, extract_text"` 退出码 0
- [ ] `isinstance(InMemorySessionManager(), SessionManager)` 为 True
- [ ] `strip_thinking("hi <thinking>x</thinking> bye") == "hi  bye"`
- [ ] `strip_thinking("hi <thinking>multi\nline</thinking> bye") == "hi  bye"`
- [ ] `extract_text({"parts": [{"type": "text", "text": "a"}, {"type": "step-start"}, {"type": "text", "text": "b"}]}) == "ab"`
- [ ] `extract_text({"parts": []}) == ""`

## 7. 非目标

- 不实现持久化 SessionManager(后续卡片可加)
- 不实现 thinking 块解析为单独字段(只 strip)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-109 交付说明

$ python -c "
from src.main.modules.agent.service.output_parser import strip_thinking, extract_text
print(repr(strip_thinking('hi <thinking>x</thinking> bye')))
print(repr(extract_text({'parts': [{'type': 'text', 'text': 'ok'}]})))
"
'hi  bye'
'ok'
```
