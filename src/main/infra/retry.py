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
        retry_on: 可重试的异常类型元组。为 None 时按 ``policy.default_retry_on``
            重试（默认为网络/超时类异常），**不会**重试 ``TypeError`` /
            ``KeyError`` / ``ValueError`` 等确定性编程错误。

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
                    effective_retry_on = (
                        retry_on if retry_on is not None else policy.default_retry_on
                    )
                    if not isinstance(exc, effective_retry_on):
                        raise
                    last_exc = exc
                    if attempt < policy.max_attempts - 1:
                        delay = min(
                            policy.base_delay * (policy.backoff ** attempt),
                            policy.max_delay,
                        )
                        await asyncio.sleep(delay)
            if last_exc is None:
                raise RuntimeError(
                    "retry loop exhausted without an exception being captured; "
                    "this should never happen"
                )
            raise last_exc

        return wrapper

    return decorator