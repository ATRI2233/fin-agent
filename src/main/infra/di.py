"""DI 单一注册入口 — Registry 实现。

提供线程安全的单例注册、懒加载解析、同步只读解析（resolve_sync）、
shutdown 清理（含 Engine 显式 dispose）以及测试用 override。
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any, Callable

from src.main.infra.errors import RegistryError


class Registry:
    """唯一 DI 入口。无全局变量、无 _SERVICE_MAP、无属性反射。"""

    def __init__(self) -> None:
        self._factories: dict[type, Callable[[Registry], Any]] = {}
        self._instances: dict[type, Any] = {}
        self._lock = threading.RLock()

    def register_singleton(
        self, protocol: type, factory: Callable[[Registry], Any]
    ) -> None:
        if not isinstance(protocol, type):
            raise TypeError(f"protocol must be a type, got {type(protocol).__name__}")
        if protocol in self._factories:
            raise RegistryError(f"{protocol.__name__} already registered")
        self._factories[protocol] = factory

    def resolve(self, protocol: type) -> Any:
        """线程安全懒加载解析。"""
        with self._lock:
            if protocol in self._instances:
                return self._instances[protocol]
            if protocol not in self._factories:
                raise RegistryError(f"{protocol.__name__} not registered")
            instance = self._factories[protocol](self)
            self._instances[protocol] = instance
            return instance

    def resolve_sync(self, protocol: type) -> Any:
        """同步只读解析 — 仅返回已构造实例，不调用 factory。

        Revision T-5: 供同步 Depends 使用（如 Settings），只返回已构造实例。
        """
        with self._lock:
            if protocol in self._instances:
                return self._instances[protocol]
            raise RegistryError(
                f"{protocol.__name__} not pre-constructed; use resolve()"
            )

    def shutdown(self) -> None:
        """逆序关闭所有实例，显式 dispose SQLAlchemy Engine。

        Revision T-11: Engine 显式 dispose 不能仅依赖 close() 链。
        """
        with self._lock:
            # 第 1 步：遍历实例调用 close/cleanup/shutdown/stop
            for inst in list(self._instances.values()):
                for method_name in ("close", "cleanup", "shutdown", "stop"):
                    closer = getattr(inst, method_name, None)
                    if callable(closer):
                        try:
                            closer()
                        except Exception:
                            pass

            # 第 2 步：显式 dispose 所有 SQLAlchemy Engine
            from sqlalchemy.engine import Engine

            for inst in list(self._instances.values()):
                if isinstance(inst, Engine):
                    try:
                        inst.dispose()
                    except Exception:
                        pass

            # 第 3 步：清空实例与工厂
            self._instances.clear()
            self._factories.clear()

    def override(self, protocol: type, instance: Any) -> None:
        """测试用 — 直接覆盖实例。"""
        with self._lock:
            self._instances[protocol] = instance
