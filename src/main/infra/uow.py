"""UnitOfWork 协议与 SQLAlchemy 实现 — 事务边界的唯一入口。

所有 Service 层通过 ``UoWFactory`` 获取 ``UnitOfWork``，不得直接操控
``Session`` 或 ``Engine``。
"""

from __future__ import annotations

from typing import Callable, Protocol

from sqlalchemy.orm import Session


class UnitOfWork(Protocol):
    """Unit of Work 协议 — 封装单一数据库事务。

    用法::

        with uow:
            uow.session.add(some_obj)
            uow.session.flush()
            # commit/rollback 由 __exit__ 自动处理
    """

    session: Session

    def __enter__(self) -> UnitOfWork:
        ...

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: object,
    ) -> None:
        ...

    def commit(self) -> None:
        """提交当前事务。"""

    def rollback(self) -> None:
        """回滚当前事务。"""


class UoWFactory(Protocol):
    """UoW 工厂协议 — 每次 ``begin()`` 开启一个全新事务。"""

    def begin(self) -> UnitOfWork:
        """开启并返回一个新的 UnitOfWork。"""


class SqlAlchemyUnitOfWork:
    """SQLAlchemy UnitOfWork 实现。

    通过 ``__exit__`` 自动管理事务边界：

    - 无异常 → 自动 commit()
    - 有异常 → rollback() 并传播异常
    - 无论何种情况均 close() session
    """

    def __init__(self, session: Session) -> None:
        self.session = session

    def __enter__(self) -> SqlAlchemyUnitOfWork:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: object,
    ) -> None:
        if exc_type is None:
            try:
                self.commit()
            except Exception:
                try:
                    self.rollback()
                except Exception:
                    pass
                raise
        else:
            try:
                self.rollback()
            except Exception:
                pass
        self.session.close()

    def commit(self) -> None:
        """提交当前事务。"""
        self.session.commit()

    def rollback(self) -> None:
        """回滚当前事务。"""
        self.session.rollback()


class SqlAlchemyUoWFactory:
    """SqlAlchemyUoWFactory — 每次 ``begin()`` 创建新 Session。"""

    def __init__(self, session_factory: Callable[[], Session]) -> None:
        self._session_factory = session_factory

    def begin(self) -> SqlAlchemyUnitOfWork:
        return SqlAlchemyUnitOfWork(self._session_factory())
