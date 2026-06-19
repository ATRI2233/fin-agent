"""FastAPI Depends 工厂。

提供:
    - ``get_registry``: 从 ``request.app.state.registry`` 取出 DI Registry。
    - ``service_dep(protocol)``: 工厂,返回一个 async callable,可作为
      ``Depends(...)`` 注入对应 Protocol 类型的服务实例。

测试约定 (Do Not #14):
    测试时必须用 ``app.dependency_overrides[service_dep(MyProto)] = lambda: mock``,
    不允许单独走 register path。
"""

from __future__ import annotations

from typing import Any, Callable

from fastapi import Depends, Request

from src.main.infra.di import Registry


async def get_registry(request: Request) -> Registry:
    """从 FastAPI app.state 取出 DI Registry。

    Args:
        request: FastAPI 请求对象。

    Returns:
        应用启动时挂载到 ``app.state.registry`` 的 ``Registry`` 实例。
    """
    return request.app.state.registry


def service_dep(protocol: type) -> Callable[..., Any]:
    """构造一个 FastAPI Depends 兼容的 async callable。

    用法::

        @router.get("/items")
        async def list_items(repo = Depends(service_dep(ItemRepo))):
            ...

    Args:
        protocol: 目标服务 Protocol 类型(由调用方传 Protocol 类型)。

    Returns:
        一个 async callable,内部从 ``get_registry`` 拿 Registry 后
        调用 ``reg.resolve(protocol)`` 取回对应服务实例。
    """

    async def _dep(reg: Registry = Depends(get_registry)) -> Any:
        return reg.resolve(protocol)

    return _dep