# TASK-008: infra/constants.py - 业务不变量

> **阶段**: Phase 0 · **估时**: 1h · **优先级**: P2
> **上下文窗口**: 1 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-008` |
| 所属阶段 | Phase 0 / infra |
| 前置任务 | TASK-007 |
| 后置任务 | 无（被任意模块引用） |
| 输出文件 | `src/main/infra/constants.py` |

## 2. 目标

定义**业务不变量**（不可通过环境变量覆盖的硬上限与语义常量）。任何能在 .env 改的 → settings.py;需要业务评审的 → 本文件。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §5.2

### 3.2 输出文件

1. `src/main/infra/constants.py` - 含:
   - `MAX_NODES_PER_WORKFLOW: int = 20`
   - `SCHEDULER_MAX_INSTANCES: int = 1`
   - `MAINTENANCE_RETENTION_DAYS: int = 30`
   - `ISO_8601_UTC: str = "%Y-%m-%dT%H:%M:%S.%fZ"`
   - 每个常量加一行 docstring 说明业务含义

## 4. 详细步骤

1. 无 import
2. 按设计文档 §5.2 列出 4 个常量
3. 每个常量上方一行 docstring

## 5. Do Not 清单

- [ ] **Do Not #7**: 全部走 `settings.py`(pydantic-settings)
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry — 仅标量
- [ ] **Do Not #8**: 全部走 `settings.py` 或 `constants.py`

## 6. 验收标准

- [ ] `python -c "from src.main.infra.constants import MAX_NODES_PER_WORKFLOW, SCHEDULER_MAX_INSTANCES, MAINTENANCE_RETENTION_DAYS, ISO_8601_UTC"` 退出码 0
- [ ] 4 个常量值与设计文档一致
- [ ] `import src.main.infra.constants` 不触发任何副作用(无 settings 实例化)

## 7. 非目标

- 不定义枚举(枚举归各模块 domain)
- 不定义异常或协议

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-008 交付说明

$ python -c "from src.main.infra.constants import *; print(MAX_NODES_PER_WORKFLOW, ISO_8601_UTC)"
20 %Y-%m-%dT%H:%M:%S.%fZ
```
