# TASK-014: infra/retry.py - 通用 retry_on_failure 装饰器

> **阶段**: Phase 0 · **估时**: 2h · **优先级**: P1
> **上下文窗口**: 1 输入 · 1 输出
> **抽出原因**: 原在 TASK-310 §3.2 "本卡片可顺带创建",破坏分层（Phase 3 跨阶段创建 infra/）。本卡片将其独立为 Phase 0 infra 卡,TASK-310 改为 import。

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-014` |
| 所属阶段 | Phase 0 / infra |
| 前置任务 | TASK-002 (RetryPolicy), TASK-003 (异常族) |
| 后置任务 | TASK-310 (retry_service), TASK-411 |
| 输出文件 | `src/main/infra/retry.py` |

## 2. 目标

实现通用 `retry_on_failure` 装饰器,支持 sync / async 函数,按 `RetryPolicy` 调度重试,抛出**最后一次**异常(非静默吞掉)。**纯 infra 层,无业务依赖**。

**显式消费者列表**(为以下消费者提供统一 API,防止后续需要 retry 的地方又自己写一套):
- TASK-310 `retry_service.py` — workflow 层 RetryService 包装 dispatcher dispatch
- TASK-306 `agent_executor.py` — agent 节点失败重试(经 TASK-310 调用,间接消费)
- TASK-109 `session_manager.py` — session 启动失败重试 / 后端连接失败重试
- 后续任何需要 retry 的模块(扩展点)

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §4.2 重试策略

### 3.2 类型依赖

- `infra.domain.RetryPolicy` (TASK-002)
- `infra.errors.*` 异常族 (TASK-003, 透传异常用)

**显式消费者**(本卡片对外暴露 API 后,这些卡片将 `from src.main.infra.retry import retry_on_failure`):
- TASK-310 `src/main/modules/workflow/retry/retry_service.py` — workflow 层 RetryService 用 `retry_on_failure` 包装 dispatcher dispatch
- TASK-306 `src/main/modules/workflow/executor/agent_executor.py` — agent 节点失败重试(经 TASK-310 间接消费)
- TASK-109 `src/main/modules/session/manager.py` — session 启动失败重试 / 后端连接失败重试

### 3.3 输出文件

1. `src/main/infra/retry.py` - 含:
   - `def retry_on_failure(policy: RetryPolicy, *, retry_on: tuple[type[Exception], ...] | None = None) -> Callable`: 装饰器
     - 支持 sync (Callable) 与 async (Coroutine) 函数
     - 若 `retry_on` 为 None,默认重试**所有 Exception 子类**;若指定元组,仅重试元组内的异常类型
     - 重试间隔: `policy.base_delay * (policy.backoff ** attempt)`, 支持 `asyncio.sleep` / `time.sleep`
     - 重试上限: `policy.max_attempts`,最后一次失败抛**原异常**(带 `__cause__` 链)
     - **不**静默吞掉异常
     - **不**调用 `trace_id` 相关 ctx（纯基础设施,调用方负责传 trace_id）

## 4. 详细步骤

### 4.1 retry.py 实现

```python
"""通用 retry 装饰器 — 纯 infra 层,无业务依赖。

与 RetryService(workflow 层)的区别:
- 本装饰器是**通用工具**,任何 sync/async 函数都能用
- RetryService(workflow 层)负责 DAG-aware 重试 + 熔断 + ExecutionRecorder 联动

调用方约定:
- 本装饰器不感知 trace_id(纯基础设施)
- 调用方需自行 bind_contextvars + 在 finally unbind
"""
from __future__ import annotations

import asyncio
import functools
import time
from typing import Any, Awaitable, Callable, ParamSpec, TypeVar

from src.main.infra.domain import RetryPolicy

P = ParamSpec("P")
R = TypeVar("R")


def retry_on_failure(
    policy: RetryPolicy,
    *,
    retry_on: tuple[type[Exception], ...] | None = None,
) -> Callable[[Callable[P, R | Awaitable[R]]], Callable[P, Awaitable[R]]]:
    """装饰器:按 RetryPolicy 调度重试,最后一次失败抛原异常。

    Args:
        policy: 重试策略(max_attempts / base_delay / backoff)
        retry_on: 仅重试这些异常类型;None = 重试所有 Exception

    Returns:
        装饰后的 async 函数(sync 函数也会被转为 async 风格返回)

    Raises:
        最后一次失败的异常(带 __cause__ 链)
    """
    def decorator(
        func: Callable[P, R | Awaitable[R]],
    ) -> Callable[P, Awaitable[R]]:
        is_coro = asyncio.iscoroutinefunction(func)

        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            last_exc: Exception | None = None
            for attempt in range(policy.max_attempts):
                try:
                    result = func(*args, **kwargs)
                    if is_coro:
                        result = await result  # type: ignore[union-attr]
                    return result  # type: ignore[return-value]
                except Exception as exc:
                    if retry_on is not None and not isinstance(exc, retry_on):
                        raise  # 不在 retry_on 列表中 → 直接抛
                    last_exc = exc
                    if attempt < policy.max_attempts - 1:
                        delay = policy.base_delay * (policy.backoff ** attempt)
                        await asyncio.sleep(delay)
            assert last_exc is not None
            raise last_exc

        return wrapper
    return decorator
```

## 5. Do Not 清单

- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol — 纯 infra
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError — 必须 raise 最后一次异常
- [ ] **Do Not #7**: 全部走 `settings.py`(pydantic-settings) — policy 由调用方传入
- [ ] **Do Not #18**: ContextVar 在跨 Task 调度时只继承调度时刻快照,子 Task 的 set 不会回写;一旦污染,日志 trace_id 错乱且不可复现 — 调用方显式传入
- [ ] **Do Not #8**: 全部走 `settings.py` 或 `constants.py` — 全部从 `RetryPolicy` 来

## 6. 验收标准

- [ ] `python -c "from src.main.infra.retry import retry_on_failure"` 退出码 0
- [ ] `callable(retry_on_failure(RetryPolicy()))` 为 True
- [ ] **sync 函数测试**: 用 counter mock,前 2 次 fail 第 3 次 success,函数最终返回 success 值
- [ ] **async 函数测试**: 同上,async 风格
- [ ] **异常透传测试**: 函数抛 `ValueError("boom")`,3 次都失败,装饰器抛 `ValueError("boom")`（不是 None 或被包装）
- [ ] **retry_on 过滤**: 函数抛 `KeyError`,`retry_on=(ValueError,)` 应**直接抛** KeyError 不重试
- [ ] **退避测试**: mock `asyncio.sleep`,验证调用次数 = max_attempts - 1
- [ ] **关键 grep #1**: `grep -nE '^(from|import) (src\.main\.infra\.|src\.main\.modules\.(workflow|execution|agent))' src/main/infra/retry.py` → 0 行(仅检查 import,不看注释/字符串)
- [ ] **关键 grep #2**: `grep -nE 'except Exception: pass' src/main/infra/retry.py` → 0
- [ ] **关键 grep #3**: `grep -nE 'from src\.main\.infra\.retry import retry_on_failure' src/main/main.py` 命中 ≥ 1(由 TASK-411 build_registry 实际引用)

## 7. 非目标

- 不实现熔断器(在 TASK-310 workflow 层)
- 不感知 trace_id(调用方责任)
- 不实现指数退避以外的策略(线性 / 抖动留给后续)
- 不写 sync contextmanager 风格的 retry（统一 async 包装）

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-014 交付说明

### 装饰器行为验证
$ python -c "
import asyncio
from src.main.infra.retry import retry_on_failure
from src.main.infra.domain import RetryPolicy

attempts = []
async def flaky():
    attempts.append(1)
    if len(attempts) < 3:
        raise ValueError('boom')
    return 'ok'

policy = RetryPolicy(max_attempts=5, base_delay=0.01, backoff=1.0)
decorated = retry_on_failure(policy)(flaky)
print(asyncio.run(decorated()))
print('attempts:', len(attempts))
"
ok
attempts: 3

### retry_on 过滤验证
$ python -c "
import asyncio
from src.main.infra.retry import retry_on_failure
from src.main.infra.domain import RetryPolicy

async def strict():
    raise KeyError('not retried')

policy = RetryPolicy(max_attempts=3, base_delay=0.01, backoff=1.0)
decorated = retry_on_failure(policy, retry_on=(ValueError,))(strict)
try: asyncio.run(decorated())
except KeyError as e: print('caught:', e)
"
caught: 'not retried'

### 关键 grep 验证
$ grep -nE 'workflow|execution|agent' src/main/infra/retry.py
(no output — confirmed pure infra)
```

---

## 9. 依赖追踪

- **被依赖**:
  - TASK-310 (`retry_service.py` 用 `retry_on_failure` 包装 dispatcher dispatch)
  - TASK-411 (build_registry 注册时无直接 import,但 `RetryService` 通过 TASK-310 间接用到)
- **不依赖**: 任何业务模块(纯 infra)
