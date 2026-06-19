# TASK-101: modules/mcp/protocol.py - ToolCatalog Protocol

> **阶段**: Phase 1 · **估时**: 1h · **优先级**: P0（Protocol 优先）
> **上下文窗口**: 1 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-101` |
| 所属阶段 | Phase 1 / mcp |
| 前置任务 | TASK-002 |
| 后置任务 | TASK-102, TASK-103, TASK-104, TASK-408 |
| 输出文件 | `src/main/modules/mcp/protocol.py` |

## 2. 目标

定义 mcp 模块对外唯一公开接口 `ToolCatalog` Protocol,供 API 层读取工具目录。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.6.4

### 3.2 类型依赖

- `infra.domain.AgentReference` (TASK-002)

### 3.3 输出文件

1. `src/main/modules/mcp/protocol.py` - 含:
   - `ToolDescriptor` TypedDict 或 dataclass: `name, server, description, category`
   - `ToolServerDescriptor` TypedDict: `name, description, enabled, tools: list[ToolDescriptor]`
   - `class ToolCatalog(Protocol)`:
     - `list_tools(self, *, server: str | None = None, category: str | None = None) -> list[ToolDescriptor]`
     - `list_servers(self) -> list[ToolServerDescriptor]`
     - `list_allowed_for_agent(self, agent: AgentReference) -> list[ToolDescriptor]`
     - `get_tool(self, server: str, name: str) -> ToolDescriptor | None`
     - `reload(self) -> None`

## 4. 详细步骤

1. `from __future__ import annotations`
2. `from typing import Protocol`
3. `from src.main.infra.domain import AgentReference`
4. 定义 `ToolDescriptor` 与 `ToolServerDescriptor`(用 `TypedDict` 或 frozen dataclass,二选一保持一致)
5. 定义 `ToolCatalog` Protocol,所有方法签名照抄设计文档
6. **关键**: 此文件**只定义 Protocol**,不引用任何实现

## 5. Do Not 清单

- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not #2**: 接口没对齐时用反射修补 = 隐藏 bug;改 Protocol
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry

## 6. 验收标准

- [ ] `python -c "from src.main.modules.mcp.protocol import ToolCatalog, ToolDescriptor, ToolServerDescriptor"` 退出码 0
- [ ] `ToolCatalog` 是 `Protocol` 实例(`typing.Protocol` 或 `runtime_checkable`)
- [ ] `list_tools` 签名含 `server` 与 `category` keyword-only 参数
- [ ] `list_allowed_for_agent` 接受 `AgentReference`

## 7. 非目标

- 不实现任何具体类（只 Protocol）
- 不写 .opencode/opencode.json 解析

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-101 交付说明

$ python -c "
from src.main.modules.mcp.protocol import ToolCatalog
import inspect
for name in ('list_tools', 'list_servers', 'list_allowed_for_agent', 'get_tool', 'reload'):
    sig = inspect.signature(getattr(ToolCatalog, name))
    print(name, sig)
"
```
