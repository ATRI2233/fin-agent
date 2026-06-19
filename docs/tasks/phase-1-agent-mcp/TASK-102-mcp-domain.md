# TASK-102: modules/mcp/domain - tool.py + catalog.py

> **阶段**: Phase 1 · **估时**: 3h · **优先级**: P1
> **上下文窗口**: 1 输入 · 2 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-102` |
| 所属阶段 | Phase 1 / mcp domain |
| 前置任务 | TASK-002, TASK-101 |
| 后置任务 | TASK-103, TASK-104 |
| 输出文件 | `src/main/modules/mcp/domain/tool.py`, `src/main/modules/mcp/domain/catalog.py` |

## 2. 目标

定义工具与服务器的值对象,以及不可变内存目录快照。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §2 (mcp domain 部分)

### 3.2 类型依赖

- `infra.domain.AgentReference` (TASK-002)
- **不可变性约束**:`Tool` / `ToolServer` / `ToolCatalogSnapshot` 均为 `frozen=True`,所有复合字段必须用 `tuple`(不可变);**禁止**在 frozen dataclass 上声明 `dict` / `list` / `set` 等可变字段(frozen 不允许)

### 3.3 输出文件

1. `src/main/modules/mcp/domain/__init__.py`(空)
2. `src/main/modules/mcp/domain/tool.py` - 含:
   - `@dataclass(frozen=True) class Tool`: `name, server, description, category`
   - `@dataclass(frozen=True) class ToolServer`: `name, description, enabled, command: tuple[str, ...], tools: tuple[Tool, ...]`(**删 `env: dict[str, str]` 字段**,实际项目不用 env;`tools` 已为 tuple,frozen 兼容)
3. `src/main/modules/mcp/domain/catalog.py` - 含:
   - `@dataclass(frozen=True) class ToolCatalogSnapshot`: `servers: tuple[ToolServer, ...]`, 加查询方法 `tools_matching(server=, category=, agent=)`

## 4. 详细步骤

### 4.0 准备: 创建空 `__init__.py`

```python
# Step 0: 创建空 __init__.py(占位模块入口,后续 import 必备)
import os
os.makedirs("src/main/modules/mcp/domain", exist_ok=True)
with open("src/main/modules/mcp/domain/__init__.py", "w", encoding="utf-8") as f:
    pass
```

### 4.1 tool.py

1. `from __future__ import annotations`
2. `from dataclasses import dataclass`
3. 定义两个 dataclass 均为 `frozen=True`
4. `Tool` 字段: `name: str`, `server: str`, `description: str`, `category: str`
5. `ToolServer` 字段: `name: str`, `description: str`, `enabled: bool`, `command: tuple[str, ...]`(元组不可变), `tools: tuple[Tool, ...]`(**删除 `env` 字段**,frozen 不允许 `dict` 字段;项目不用 env,后续有需求再加 frozen-compatible 类型)

### 4.2 catalog.py

1. `from src.main.modules.mcp.domain.tool import Tool, ToolServer`
2. `from src.main.infra.domain import AgentReference`
3. `@dataclass(frozen=True) class ToolCatalogSnapshot`
4. 方法:
   - `def tools_matching(self, *, server: str | None = None, category: str | None = None) -> tuple[Tool, ...]`: 返回所有 server 中匹配的 tool 元组
   - `def get_tool(self, server: str, name: str) -> Tool | None`
   - `def list_allowed_for_agent(self, agent: AgentReference) -> tuple[Tool, ...]`: 当前实现可基于 agent.name 启发(具体白名单匹配留给 manifest_loader,TASK-103)

## 5. Do Not 清单

- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not #2**: 接口没对齐时用反射修补 = 隐藏 bug;改 Protocol
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry

## 6. 验收标准

- [ ] `python -c "from src.main.modules.mcp.domain.tool import Tool, ToolServer"` 退出码 0
- [ ] `python -c "from src.main.modules.mcp.domain.catalog import ToolCatalogSnapshot"` 退出码 0
- [ ] `Tool(name="x", server="s", description="d", category="c")` 是 frozen 实例
- [ ] `ToolServer(..., tools=(Tool(...),))` 接受元组
- [ ] `ToolCatalogSnapshot(servers=(...)).tools_matching(server="s")` 返回元组
- [ ] `ToolCatalogSnapshot(servers=()).get_tool("none", "none") is None`

## 7. 非目标

- 不实现 opencode.json 解析(TASK-103)
- 不实现 service 层(TASK-104)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-102 交付说明

$ python -c "
from src.main.modules.mcp.domain.tool import Tool, ToolServer
from src.main.modules.mcp.domain.catalog import ToolCatalogSnapshot
t = Tool(name='ashare_quote', server='ashare', description='A股实时行情', category='行情')
s = ToolServer(name='ashare', description='A股', enabled=True, command=('python','x'), tools=(t,))
snap = ToolCatalogSnapshot(servers=(s,))
print(len(snap.tools_matching(category='行情')))
"
1
```
