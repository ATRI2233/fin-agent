# TASK-104: modules/mcp/service/tool_query_service.py

> **阶段**: Phase 1 · **估时**: 2h · **优先级**: P1
> **上下文窗口**: 2 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-104` |
| 所属阶段 | Phase 1 / mcp service |
| 前置任务 | TASK-002, TASK-101, TASK-103 |
| 后置任务 | TASK-408 |
| 输出文件 | `src/main/modules/mcp/service/tool_query_service.py`, `src/main/modules/mcp/service/__init__.py` |

## 2. 目标

实现 `ToolCatalog` Protocol,作为 mcp 模块对外服务的唯一入口。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.6.4
2. `src/main/modules/mcp/protocol.py` (TASK-101)

### 3.2 类型依赖

- `modules.mcp.protocol.ToolCatalog, ToolDescriptor, ToolServerDescriptor` (TASK-101)
- `modules.mcp.repo.manifest_loader.OpencodeManifestLoader` (TASK-103) - 公开 API `get_agent_allowlist(agent) -> list[str]`(TASK-103 实现的公开方法,严禁直接读私有 `_agent_allowlist` 成员,违反 Do Not #1)
- `infra.domain.AgentReference` (TASK-002)

### 3.3 输出文件

1. `src/main/modules/mcp/service/__init__.py`(空)
2. `src/main/modules/mcp/service/tool_query_service.py` - 含 `class OpencodeJsonToolCatalog`:
   - `__init__(self, loader: OpencodeManifestLoader)`
   - 实现 ToolCatalog Protocol 所有方法
   - 内部缓存 snapshot(loader 提供 reload)

## 4. 详细步骤

### 4.0 准备: 创建空 `__init__.py`

```python
# Step 0: 创建空 __init__.py(占位模块入口,后续 import 必备)
import os
os.makedirs("src/main/modules/mcp/service", exist_ok=True)
with open("src/main/modules/mcp/service/__init__.py", "w", encoding="utf-8") as f:
    pass
```

### 4.1 tool_query_service.py

1. `from __future__ import annotations`
2. `from src.main.modules.mcp.protocol import ToolCatalog, ToolDescriptor, ToolServerDescriptor`
3. `from src.main.modules.mcp.repo.manifest_loader import OpencodeManifestLoader`
4. `from src.main.infra.domain import AgentReference`
5. `class OpencodeJsonToolCatalog`:
   - `__init__`: self.loader = loader; self._snapshot = loader.load()
   - `list_tools(self, *, server=None, category=None) -> list[ToolDescriptor]`:
     - snap = self._snapshot
     - for s in snap.servers: for t in s.tools: if match: yield ToolDescriptor(...)
   - `list_servers(self) -> list[ToolServerDescriptor]`: yield ToolServerDescriptor(name=..., enabled=..., tools=...)
   - `list_allowed_for_agent(self, agent: AgentReference) -> list[ToolDescriptor]`:
     - 通过 `self.loader.get_agent_allowlist(agent)` 公开 API(TASK-103 实现)拿 allowlist,**禁止**直接读 `loader._agent_allowlist` 私有成员
     - 拿到的 allowlist 配合 snapshot 过滤 tools
   - `get_tool(self, server: str, name: str) -> ToolDescriptor | None`
   - `reload(self)`: self._snapshot = self.loader.reload()

## 5. Do Not 清单

- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not #2**: 接口没对齐时用反射修补 = 隐藏 bug;改 Protocol
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry

## 6. 验收标准

- [ ] `python -c "from src.main.modules.mcp.service.tool_query_service import OpencodeJsonToolCatalog"` 退出码 0
- [ ] 实例是 ToolCatalog Protocol 子类(`isinstance(cat, ToolCatalog)` 或 `runtime_checkable` 检查通过)
- [ ] `cat.list_tools()` 返回非空列表
- [ ] `cat.list_servers()` 返回 7 个 server
- [ ] `cat.list_allowed_for_agent(AgentReference(name='macro-scout', ...))` 返回的工具子集非空
- [ ] `cat.reload()` 不抛异常

## 7. 非目标

- 不实现 HTTP 层(API 卡片负责)
- 不实现缓存失效策略

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-104 交付说明

$ python -c "
from src.main.modules.mcp.protocol import ToolCatalog
from src.main.modules.mcp.service.tool_query_service import OpencodeJsonToolCatalog
from src.main.modules.mcp.repo.manifest_loader import OpencodeManifestLoader
from src.main.infra.settings import Settings
cat = OpencodeJsonToolCatalog(OpencodeManifestLoader(Settings()))
assert isinstance(cat, ToolCatalog)
print('tools:', len(cat.list_tools()), 'servers:', len(cat.list_servers()))
"
```
