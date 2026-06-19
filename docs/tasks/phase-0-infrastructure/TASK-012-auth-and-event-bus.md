# TASK-012: infra/auth.py + infra/event_bus.py

> **阶段**: Phase 0 · **估时**: 3h · **优先级**: P1
> **上下文窗口**: 1 输入 · 2 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-012` |
| 所属阶段 | Phase 0 / infra |
| 前置任务 | TASK-007, TASK-003 |
| 后置任务 | TASK-411 |
| 输出文件 | `src/main/infra/auth.py`, `src/main/infra/event_bus.py` |

## 2. 目标

实现 API key + localhost 鉴权依赖,与进程内事件总线(用于启动/停止/告警)。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §5.1 (auth 部分) + 设计原则 P9

### 3.2 类型依赖

- `infra.settings.Settings` (TASK-007)
- `infra.errors.ValidationError` (TASK-003)

### 3.3 输出文件

1. `src/main/infra/auth.py` - 含:
   - `def verify_request(request: Request, settings: Settings) -> None`: 检查 `X-API-Key` header == settings.API_KEY,或 settings.AUTH_SKIP_LOCALHOST 且 client 是 127.0.0.1
   - 失败 raise `ValidationError`
   - 不导出 FastAPI Depends(留给 TASK-405)
2. `src/main/infra/event_bus.py` - 含:
   - `class EventBus`:
     - `subscribe(self, event_type: str, handler: Callable) -> None`
     - `publish(self, event_type: str, payload: dict) -> None`(异步 handler 用 asyncio.create_task)
     - `publish_sync(...)` 可选

## 4. 详细步骤

### 4.1 auth.py

1. `from fastapi import Request`
2. `from src.main.infra.settings import Settings`
3. `from src.main.infra.errors import ValidationError`
4. `def verify_request(request: Request, settings: Settings) -> None`:
   - 若 settings.AUTH_SKIP_LOCALHOST 且 `request.client.host in ("127.0.0.1", "::1")`: return
   - 若 `request.headers.get("X-API-Key") == settings.API_KEY`: return
   - 否则 raise ValidationError
5. 不读 `os.environ`

### 4.2 event_bus.py

1. `import asyncio`, `from typing import Callable, Any`
2. `class EventBus`:
   - `__init__`: `self._handlers: dict[str, list[Callable]] = {}`
   - `subscribe(event_type, handler)`: append
   - `publish(event_type, payload)`:
     - handlers = self._handlers.get(event_type, [])
     - for h in handlers: `asyncio.create_task(h(payload))` (异常仅 log,不抛)
3. **关键**: handler 异常用 `infra/logging.py::get_logger().warning(...)` 记录,**禁止** `except Exception: pass` 静默

## 5. Do Not 清单

- [ ] **Do Not #7**: 全部走 `settings.py`(pydantic-settings)
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry

## 6. 验收标准

- [ ] `python -c "from src.main.infra.auth import verify_request"` 退出码 0
- [ ] `python -c "from src.main.infra.event_bus import EventBus"` 退出码 0
- [ ] `Settings(API_KEY="k", AUTH_SKIP_LOCALHOST=False)` 下,无 header 时 `verify_request(mock_request, settings)` 抛 ValidationError
- [ ] `Settings(API_KEY="k")` 下,`X-API-Key: k` 通过
- [ ] `Settings(API_KEY="k", AUTH_SKIP_LOCALHOST=True)` 下,client=127.0.0.1 不需 header
- [ ] EventBus `subscribe("e", lambda p: p); await bus.publish("e", {"x": 1})` 触发 handler
- [ ] EventBus handler 抛异常不传播

## 7. 非目标

- 不实现 OAuth / JWT
- 不实现 EventBus 持久化

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-012 交付说明

$ python -c "
import asyncio
from src.main.infra.event_bus import EventBus
async def main():
    bus = EventBus()
    bus.subscribe('test', lambda p: print('got:', p))
    await bus.publish('test', {'k': 'v'})
asyncio.run(main())
"
got: {'k': 'v'}
```
