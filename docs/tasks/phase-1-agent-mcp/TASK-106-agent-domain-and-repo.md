# TASK-106: modules/agent/domain + repo (3 文件)

> **阶段**: Phase 1 · **估时**: 4h · **优先级**: P1
> **上下文窗口**: 1 输入 · 3 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-106` |
| 所属阶段 | Phase 1 / agent |
| 前置任务 | TASK-002, TASK-003, TASK-007, TASK-105 |
| 后置任务 | TASK-107, TASK-108, TASK-109 |
| 输出文件 | `src/main/modules/agent/domain/agent_definition.py`, `src/main/modules/agent/domain/session.py`, `src/main/modules/agent/repo/agent_definition_repo.py` |

## 2. 目标

定义 `AgentDefinition` 与 `Session` 值对象,以及读取 `.opencode/agents/*.md` 的 repository。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §2 (agent domain 部分)

### 3.2 类型依赖

- `infra.domain.AgentReference, SessionId, ConversationId` (TASK-002)
- `infra.settings.Settings` (TASK-007)
- `infra.errors.AgentNotFoundError` (TASK-003)

### 3.3 输出文件

1. `src/main/modules/agent/domain/__init__.py`(空)
2. `src/main/modules/agent/domain/agent_definition.py` - 含:
   - `@dataclass(frozen=True) class AgentDefinition`: `name: str`, `path: Path`, `system_prompt: str`(读 .md 文件内容)
   - `classmethod from_path(cls, path: Path) -> AgentDefinition`(读 .md 文件,strip 前后空白)
3. `src/main/modules/agent/domain/session.py` - 含:
   - `@dataclass(frozen=True) class Session`: `session_id: SessionId`, `agent: AgentReference`, `created_at: datetime`, `last_used_at: datetime`
4. `src/main/modules/agent/repo/__init__.py`(空)
5. `src/main/modules/agent/repo/agent_definition_repo.py` - 含:
   - `class FileSystemAgentDefinitionRepository`:
     - `__init__(self, settings: Settings)`
     - `def get(self, name: str) -> AgentDefinition`: 拼 `settings.OPENCODE_AGENTS_DIR / f"{name}.md"`,文件不存在 raise AgentNotFoundError
     - `def list_all(self) -> list[AgentDefinition]`: glob `*.md`

## 4. 详细步骤

### 4.0 准备: 创建空 `__init__.py`(两个)

```python
# Step 0: 创建空 __init__.py(domain/ + repo/ 两个)
import os
for sub in ("src/main/modules/agent/domain", "src/main/modules/agent/repo"):
    os.makedirs(sub, exist_ok=True)
    open(os.path.join(sub, "__init__.py"), "w", encoding="utf-8").close()
```

### 4.1 agent_definition.py

1. `from __future__ import annotations`
2. `from dataclasses import dataclass` + `from pathlib import Path`
3. `AgentDefinition` frozen,字段 `name: str`, `path: Path`, `system_prompt: str`
4. `from_path`: `text = path.read_text(encoding="utf-8"); return cls(name=path.stem, path=path, system_prompt=text.strip())`

### 4.2 session.py

1. `from dataclasses import dataclass` + `from datetime import datetime`
2. `Session` frozen,字段: `session_id: SessionId`, `agent: AgentReference`, `created_at: datetime`, `last_used_at: datetime`

### 4.3 agent_definition_repo.py

1. `from src.main.modules.agent.domain.agent_definition import AgentDefinition`
2. `from src.main.infra.settings import Settings`
3. `from src.main.infra.errors import AgentNotFoundError`
4. `class FileSystemAgentDefinitionRepository`:
   - `__init__`: self.settings = settings
   - `get(name)`:
     - `path = self.settings.OPENCODE_AGENTS_DIR / f"{name}.md"`
     - `if not path.is_file(): raise AgentNotFoundError(f"agent not found: {name}")`
     - `return AgentDefinition.from_path(path)`
   - `list_all()`:
     - return sorted([AgentDefinition.from_path(p) for p in self.settings.OPENCODE_AGENTS_DIR.glob("*.md")], key=lambda d: d.name)

## 5. Do Not 清单

- [ ] **Do Not #7**: 全部走 `settings.py`(pydantic-settings)
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol

## 6. 验收标准

- [ ] `python -c "from src.main.modules.agent.domain.agent_definition import AgentDefinition"` 退出码 0
- [ ] `python -c "from src.main.modules.agent.domain.session import Session"` 退出码 0
- [ ] `python -c "from src.main.modules.agent.repo.agent_definition_repo import FileSystemAgentDefinitionRepository"` 退出码 0
- [ ] 实际 `FileSystemAgentDefinitionRepository(Settings()).list_all()` 返回 12 个 Agent(`.opencode/agents/*.md`)
- [ ] `repo.get("macro-scout").system_prompt` 非空
- [ ] `repo.get("nonexistent")` 抛 AgentNotFoundError

## 7. 非目标

- 不实现 serve_backend(TASK-107)
- 不实现 dispatcher(TASK-108)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-106 交付说明

$ python -c "
from src.main.modules.agent.repo.agent_definition_repo import FileSystemAgentDefinitionRepository
from src.main.infra.settings import Settings
repo = FileSystemAgentDefinitionRepository(Settings())
defs = repo.list_all()
print('count:', len(defs), 'names:', [d.name for d in defs[:3]])
"
count: 12 names: ['conflict-resolver', 'devil-advocate', 'fin-orchestrator']
```
