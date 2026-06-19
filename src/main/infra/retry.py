"""通用重试装饰器。

提供 ``retry_on_failure`` 装饰器，按 ``RetryPolicy`` 调度对 sync / async 函数的重试。
纯 infra 层，无业务依赖。
"""

from __future__ import annotations

import asyncio
import functools
from typing import Any, Awaitable, Callable, ParamSpec, TypeVar

from src.main.infra.domain import RetryPolicy

P = ParamSpec("P")
R = TypeVar("R")


def retry_on_failure(
    policy: RetryPolicy,
    *,
    retry_on: tuple[type[Exception], ...] | None = None,
) -> Callable[[Callable[P, R | Awaitable[R]]], Callable[P, Awaitable[R]]]:
    """装饰器：按 RetryPolicy 重试函数调用。

    Args:
        policy: 重试策略，控制最大尝试次数、初始延迟和退避因子。
        retry_on: 可重试的异常类型元组。为 None 时重试所有 Exception 子类。

    Returns:
        装饰器，将 sync / async 函数包装为异步重试函数。
    """

    def decorator(func: Callable[P, R | Awaitable[R]]) -> Callable[P, Awaitable[R]]:
        is_coro = asyncio.iscoroutinefunction(func)

        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            last_exc: Exception | None = None
            for attempt in range(policy.max_attempts):
                try:
                    result = func(*args, **kwargs)
                    if is_coro:
                        result = await result
                    return result  # type: ignore[return-value]
                except Exception as exc:
                    if retry_on is not None and not isinstance(exc, retry_on):
                        raise
                    last_exc = exc
                    if attempt < policy.max_attempts - 1:
                        delay = policy.base_delay * (policy.backoff**attempt)
                        await asyncio.sleep(delay)
            assert last_exc is not None
            raise last_exc

        return wrapper

    return decorator
