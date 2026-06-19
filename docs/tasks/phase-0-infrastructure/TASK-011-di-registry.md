# TASK-011: infra/di.py - 单一注册入口 Registry（含 resolve_sync + engine dispose）

> **阶段**: Phase 0 · **估时**: 5h · **优先级**: P0
> **上下文窗口**: 1 输入 · 1 输出
> **关联修订**: REVISION_NOTES_2026-06-18.md 修订 **T-5**（resolve_sync）+ 修订 **T-11**（shutdown 显式 dispose engine）

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-011` |
| 所属阶段 | Phase 0 / infra |
| 前置任务 | TASK-002, TASK-003 |
| 后置任务 | TASK-405, TASK-409, TASK-411, TASK-CCC-04, TASK-013 |
| 输出文件 | `src/main/infra/di.py` |

## 2. 目标

DI 容器的**唯一**注册入口 `register_singleton(Protocol, Factory)`,无 `_SERVICE_MAP`、无全局 `_container`、无 `create_message_processor` 等僵尸工厂。同时实现 `resolve_sync()` 给 Settings 等同步依赖使用（修订 T-5）;`shutdown()` 显式 dispose 所有 SQLAlchemy Engine,避免测试间状态泄漏（修订 T-11）。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-18.md` §6.1
2. `docs/architecture/REVISION_NOTES_2026-06-18.md` 修订 T-5 + T-11

### 3.2 类型依赖

- `infra.errors.RegistryError` (TASK-003)
- `sqlalchemy.engine.Engine`（用于 T-11 显式 dispose 探测）

### 3.3 输出文件

1. `src/main/infra/di.py` - 含:
   - `class Registry`
   - 方法严格按设计文档 §6.1 + 修订 T-5/T-11:
     - `__init__(self) -> None`: 初始化 `_factories: dict[type, Callable]`, `_instances: dict[type, Any]`, `_lock: threading.RLock`
     - `register_singleton(self, protocol: type, factory: Callable[[Registry], Any]) -> None`
     - `resolve(self, protocol: type) -> Any`(线程安全,懒加载)
     - **`resolve_sync(self, protocol: type) -> Any`**（修订 T-5: 仅供 Settings / DB engine / Tracer 等无 async 工厂的同步 Depends 使用）
     - `shutdown(self) -> None`: **含 Engine 显式 dispose 步骤**（修订 T-11）
     - `override(self, protocol: type, instance: Any) -> None`(测试用)

## 4. 详细步骤

1. `from __future__ import annotations`
2. `import threading`, `import asyncio`
3. `from typing import Callable, Any`
4. `from src.main.infra.errors import RegistryError`
5. `class Registry`:
   - `__init__`: 三字段初始化
   - `register_singleton`:
     - `assert isinstance(protocol, type), "protocol must be a type"`
     - 若 `protocol in self._factories` raise `RegistryError(f"{protocol.__name__} already registered")`
     - `self._factories[protocol] = factory`
   - `resolve`:
     - with self._lock
     - 若 `protocol in self._instances` return
     - 若 `protocol not in self._factories` raise `RegistryError(f"{protocol.__name__} not registered")`
     - `instance = self._factories[protocol](self)`
     - `self._instances[protocol] = instance`
     - return
   - **`resolve_sync`(修订 T-5)**:
     - 仅返回**已构造**的实例（`protocol in self._instances`）,不再调用 factory
     - 若未构造,抛 `RegistryError(f"{protocol.__name__} not pre-constructed; use resolve()")`
     - 使用 `self._lock` 保证线程安全
     - **使用场景**: FastAPI `Depends(get_settings)` 包装的同步调用,工厂在 lifespan 启动期已经预热好
   - `shutdown`（修订 T-11）:
     - **第 1 步**: 遍历 `_instances`,对每个 instance 试调用 `close/cleanup/shutdown/stop`,**捕获异常但不抛**
     - **第 2 步（修订 T-11 新增）**: 再次遍历 `_instances`,对 `isinstance(inst, Engine)` 的实例调用 `inst.dispose()`,同样捕获异常但不抛
     - **第 3 步**: 清空 `_instances` 与 `_factories`
   - `override`:
     - `self._instances[protocol] = instance`(直接覆盖,即使已注册)
6. **关键**: 严禁添加 `register_factory`(与 `register_singleton` 合并)、`register(name, ...)`、模块级 `_registry = Registry()`

### 4.1 resolve_sync 实现参考

```python
def resolve_sync(self, protocol: type) -> Any:
    """Synchronous variant for already-constructed singletons.

    Use only for Settings / DB engine / Tracer — objects whose factory
    is pure (no DB connection, no subprocess). For everything else, use
    ``resolve(protocol)``.

    Raises RegistryError if the protocol was registered but never resolved.
    """
    with self._lock:
        if protocol in self._instances:
            return self._instances[protocol]
        raise RegistryError(
            f"{protocol.__name__} not pre-constructed; use resolve() to build first"
        )
```

### 4.2 shutdown Engine dispose 实现参考

```python
def shutdown(self) -> None:
    """Reverse-registration-order teardown for owned resources."""
    # 第 1 步: 关闭按注册顺序的实例（先注册的先关）
    for inst in list(self._instances.values()):
        for method_name in ("close", "cleanup", "shutdown", "stop"):
            closer = getattr(inst, method_name, None)
            if callable(closer):
                try: closer()
                except Exception: pass  # noqa: BLE001

    # 第 2 步（修订 T-11）: 显式 dispose 所有 SQLAlchemy Engine
    from sqlalchemy.engine import Engine
    for inst in list(self._instances.values()):
        if isinstance(inst, Engine):
            try: inst.dispose()
            except Exception: pass  # noqa: BLE001

    # 第 3 步
    self._instances.clear()
    self._factories.clear()
```

## 5. Do Not 清单

- [ ] **Do Not #6**: 重构期一次性切换;不允许共存
- [ ] **Do Not #14**: 必须 `app.dependency_overrides[service_dep(...)] = lambda: mock`
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **修订 T-5 约束**: `resolve_sync` **禁止**调用 factory(只返回已构造实例);测试中若想覆盖 Settings,应在 lifespan 启动期 `resolve(Settings)` 后再用 `resolve_sync`
- [ ] **修订 T-11 约束**: Engine 显式 dispose 不能仅依赖 `close()` 链;**必须**单独遍历一次 `_instances.values()` 用 `isinstance(inst, Engine)` 探测

## 6. 验收标准

- [ ] `python -c "from src.main.infra.di import Registry"` 退出码 0
- [ ] `r = Registry(); r.register_singleton(str, lambda reg: "hello"); r.resolve(str) == "hello"` 验证基本流程
- [ ] `r.register_singleton(str, lambda: "x")` 第二次抛 RegistryError
- [ ] `r.resolve(int)` 抛 RegistryError
- [ ] `r.shutdown()` 清空实例,后续 `r.resolve(str)` 抛 RegistryError
- [ ] 多线程并发 `resolve` 不重复创建(用 threading + counter 验证)
- [ ] `r.override(str, "manual"); r.resolve(str) == "manual"`
- [ ] **修订 T-5 验证 #1**: 未 resolve 前 `r.resolve_sync(str)` 抛 RegistryError
- [ ] **修订 T-5 验证 #2**: `r.resolve(str)` 后 `r.resolve_sync(str) == "hello"`(直接返回,不再调用 factory)
- [ ] **修订 T-11 验证**: 用 in-memory SQLite engine 注册后 `r.shutdown()` 调用,后续 `r._instances` 为空,且 engine 的连接池被 dispose(可用 `engine.pool` 状态或 GC 验证)

## 7. 非目标

- 不实现 FastAPI Depends 工厂(在 TASK-405)
- 不实现 build_registry 全局装配(在 TASK-411)
- 不实现 async resolve

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-011 交付说明

$ python -c "
from src.main.infra.di import Registry
r = Registry()
r.register_singleton(str, lambda reg: 'lazy')
print(r.resolve(str))
r.shutdown()
try: r.resolve(str)
except Exception as e: print('after shutdown:', e)

# 修订 T-5 验证
r2 = Registry()
r2.register_singleton(str, lambda reg: 'lazy2')
try: r2.resolve_sync(str)
except Exception as e: print('resolve_sync before resolve:', e)
r2.resolve(str)
print('resolve_sync after resolve:', r2.resolve_sync(str))
"

# 修订 T-11 验证
$ python -c "
from sqlalchemy import create_engine
from src.main.infra.di import Registry
r = Registry()
e = create_engine('sqlite:///:memory:')
r.register_singleton(object, lambda reg: e)
r.resolve(object)
print('before shutdown:', e.pool.checkedin())
r.shutdown()
print('after shutdown: instances cleared')
"

# 偏离 / 备注
无偏离,严格按设计文档 + 修订 T-5/T-11 执行
```
