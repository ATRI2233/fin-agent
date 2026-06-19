# TASK-001: 目录骨架与 __init__.py 占位

> **阶段**: Phase 0 · **估时**: 1h · **优先级**: P2
> **上下文窗口**: 0 输入 · 9 输出文件

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-001` |
| 所属阶段 | Phase 0 / infra 与 modules 骨架 |
| 前置任务 | 无 |
| 后置任务 | TASK-002 ~ TASK-012, TASK-101 ~ TASK-CCC-04（几乎所有卡片） |
| 输出文件 | 6 个 `__init__.py` |
| 修改文件 | 无 |

## 2. 目标

为 `src/main/` 下的新目录树创建空 `__init__.py` 占位,使所有后续卡片可直接 `import` 而不踩 `ModuleNotFoundError`。

## 3. 上下文范围

### 3.1 输入文件

无（这是第 1 张卡,后续卡片依赖本卡片的目录骨架）

### 3.2 输出文件

创建下列文件（每个空文件即可,或加一行模块 docstring）:

1. `src/main/api/__init__.py`
2. `src/main/api/v1/__init__.py`
3. `src/main/infra/__init__.py`
4. `src/main/modules/__init__.py`
5. `src/main/modules/mcp/__init__.py`
6. `src/main/modules/agent/__init__.py`
7. `src/main/modules/execution/__init__.py`
8. `src/main/modules/workflow/__init__.py`
9. `src/main/modules/conversation/__init__.py`

（每个 `modules/*/` 内部还需要 `domain/__init__.py` 等子目录占位,但这些留给相应 TASK 创建,本卡只做顶层骨架。）

## 4. 详细步骤

1. 对每个目录执行: `touch <path>/__init__.py`
2. 每个 `__init__.py` 写入一行 docstring,描述该目录用途（参考设计文档 §2 目录结构）
3. 不要创建任何 Python 源文件,只创建 `__init__.py`
4. 不要创建 `tests/` 下任何文件（跨切卡片 TASK-CCC-02 负责）

## 5. Do Not 清单

- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol — 保持空,避免循环
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry

## 6. 验收标准

- [ ] `python -c "import src.main.api"` 退出码 0
- [ ] `python -c "import src.main.infra"` 退出码 0
- [ ] `python -c "import src.main.modules.mcp"` 退出码 0
- [ ] `python -c "import src.main.modules.agent"` 退出码 0
- [ ] `python -c "import src.main.modules.execution"` 退出码 0
- [ ] `python -c "import src.main.modules.workflow"` 退出码 0
- [ ] `python -c "import src.main.modules.conversation"` 退出码 0
- [ ] `find src/main -name "__init__.py" | sort` 输出 ≥ 9 行

## 7. 非目标

- 不创建任何 Python 源文件
- 不修改 `framework/`（清理留给 TASK-501）
- 不创建 `tests/` 文件

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-001 交付说明

$ find src/main -name "__init__.py" | sort
src/main/api/__init__.py
src/main/api/v1/__init__.py
src/main/infra/__init__.py
src/main/modules/__init__.py
src/main/modules/agent/__init__.py
src/main/modules/conversation/__init__.py
src/main/modules/execution/__init__.py
src/main/modules/mcp/__init__.py
src/main/modules/workflow/__init__.py
```
