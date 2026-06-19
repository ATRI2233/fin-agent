# TASK-405: api/deps.py - Depends 工厂

> **阶段**: Phase 4 · **估时**: 2h · **优先级**: P1
> **上下文窗口**: 2 输入 · 2 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-405` |
| 所属阶段 | Phase 4 / api |
| 前置任务 | TASK-011 |
| 后置任务 | TASK-408, TASK-409, TASK-410, TASK-411 |
| 输出文件 | `src/main/api/__init__.py`, `src/main/api/deps.py` |

## 2. 目标

提供 `get_registry` 与 `service_dep(Protocol)` 工厂,使 FastAPI routers 用 `Depends(service_dep(Foo))` 拿服务。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §6.2
2. `src/main/infra/di.py` (TASK-011) - Registry

### 3.2 类型依赖

- `infra.di.Registry` (TASK-011)
- 各 Protocol(由调用方传 Protocol 类型)

### 3.3 输出文件

1. `src/main/api/__init__.py`(空)
2. `src/main/api/deps.py` - 含:
   - `async def get_registry(request: Request) -> Registry`
   - `def service_dep(protocol: type)` 工厂,返回 async callable

## 4. 详细步骤

1. `from __future__ import annotations`
2. `from fastapi import Request, Depends`
3. `from src.main.infra.di import Registry`
4. `async def get_registry(request: Request) -> Registry`:
   - `return request.app.state.registry`
5. `def service_dep(protocol: type)`:
   - `async def _dep(reg: Registry = Depends(get_registry)) -> Any:`
   - `    return reg.resolve(protocol)`
   - `return _dep`

## 5. Do Not 清单

- [ ] **Do Not #14**: 必须 `app.dependency_overrides[service_dep(...)] = lambda: mock` — 用 `app.dependency_overrides[service_dep(...)] = lambda: mock`
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol

## 6. 验收标准

- [ ] `python -c "from src.main.api.deps import get_registry, service_dep"` 退出码 0
- [ ] `service_dep(int)` 返回一个 callable,可作为 `Depends(...)` 使用
- [ ] 用 mock app 测试 `get_registry` 返回 app.state.registry

## 7. 非目标

- 不实现 FastAPI app factory(TASK-409 — 接收外部 registry 与 settings)
- 不实现 routers(TASK-408)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-405 交付说明

$ python -c "
from src.main.api.deps import service_dep, get_registry
print(type(service_dep), callable(service_dep))
dep = service_dep(str)
print(callable(dep))
"
<class 'function'> True
True
```
