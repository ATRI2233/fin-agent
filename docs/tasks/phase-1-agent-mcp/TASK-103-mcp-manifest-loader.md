# TASK-103: modules/mcp/repo/manifest_loader.py - opencode.json 解析

> **阶段**: Phase 1 · **估时**: 3h · **优先级**: P1
> **上下文窗口**: 2 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-103` |
| 所属阶段 | Phase 1 / mcp repo |
| 前置任务 | TASK-007, TASK-102 |
| 后置任务 | TASK-104 |
| 输出文件 | `src/main/modules/mcp/repo/manifest_loader.py`, `src/main/modules/mcp/repo/__init__.py` |

## 2. 目标

解析 `.opencode/opencode.json`,构造不可变 `ToolCatalogSnapshot`。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §1.2 进程拓扑(opencode.json 位置)
2. `.opencode/opencode.json`(实际文件)

### 3.2 类型依赖

- `infra.settings.Settings` (TASK-007)
- `modules.mcp.domain.tool.Tool, ToolServer` (TASK-102)
- `modules.mcp.domain.catalog.ToolCatalogSnapshot` (TASK-102)

### 3.3 输出文件

1. `src/main/modules/mcp/repo/__init__.py`(空)
2. `src/main/modules/mcp/repo/manifest_loader.py` - 含:
   - `class OpencodeManifestLoader`:
     - `__init__(self, settings: Settings)`
     - `def load(self) -> ToolCatalogSnapshot`: 读取 `settings.OPENCODE_MCP_CONFIG`,解析 mcp 与 agent.tools 白名单
     - `def reload(self) -> ToolCatalogSnapshot`
   - **关键**: 解析 `mcp.*.tools` 数组得到 Tool 列表,解析 `agent.*.tools` 白名单 dict 为 `dict[agent_name, frozenset[Tool]]`

## 4. 详细步骤

### 4.0 准备: 创建空 `__init__.py`

```python
# Step 0: 创建空 __init__.py(占位模块入口,后续 import 必备)
import os
os.makedirs("src/main/modules/mcp/repo", exist_ok=True)
with open("src/main/modules/mcp/repo/__init__.py", "w", encoding="utf-8") as f:
    pass
```

### 4.1 manifest_loader.py

1. `from __future__ import annotations`
2. `import json` + `from pathlib import Path`
3. `from src.main.infra.settings import Settings`
4. `from src.main.modules.mcp.domain.tool import Tool, ToolServer`
5. `from src.main.modules.mcp.domain.catalog import ToolCatalogSnapshot`
6. `class OpencodeManifestLoader`:
   - `__init__(self, settings)`: self.settings = settings, self._snapshot = None
   - `_parse_server(name, server_dict) -> ToolServer`: 解析 mcp.* 节点
   - `_parse_tool(server_name, tool_dict) -> Tool`: 解析 tools[*]
   - `_parse_agent_allowlist(config_dict) -> dict[str, frozenset[Tool]]`: 解析 agent.*.tools
   - `def load(self) -> ToolCatalogSnapshot`:
     - 读 JSON,解析,构造 snapshot,**捕获 FileNotFoundError → raise ConfigError**(用 infra.errors)
     - return snapshot
   - `def reload(self)`: 清缓存重新 load

## 5. Do Not 清单

- [ ] **Do Not #7**: 全部走 `settings.py`(pydantic-settings)
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #8**: 全部走 `settings.py` 或 `constants.py`

## 6. 验收标准

- [ ] `python -c "from src.main.modules.mcp.repo.manifest_loader import OpencodeManifestLoader"` 退出码 0
- [ ] 实际 `OpencodeManifestLoader(Settings()).load()` 返回非空 snapshot(含 7 个 server)
- [ ] `list(snapshot.servers)[0].tools` 非空
- [ ] `Settings(OPENCODE_MCP_CONFIG=Path("/nonexistent")).OPENCODE_MCP_CONFIG` 存在;loader 加载时抛 ConfigError
- [ ] snapshot 是 frozen 实例(尝试修改属性会 FrozenInstanceError)

## 7. 非目标

- 不实现 service 层(TASK-104)
- 不实现 hot reload 监听文件变化(只暴露 reload() 方法)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-103 交付说明

$ python -c "
from src.main.infra.settings import Settings
from src.main.modules.mcp.repo.manifest_loader import OpencodeManifestLoader
snap = OpencodeManifestLoader(Settings()).load()
print('servers:', len(snap.servers))
print('tools:', sum(len(s.tools) for s in snap.servers))
"
servers: 7
tools: 70+
```
