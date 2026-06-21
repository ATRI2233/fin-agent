# Portfolio 模块实现手册

> 生成日期: 2026-06-21
> 定位: 本文件是"可执行的施工图"，精确到文件路径、方法签名、代码骨架、装配行位。
> 设计理由见 `docs/plans/portfolio-design-philosophy.md`，
> 决策溯源见 `docs/refactor-decisions/portfolio-decisions-qa.md`。

---

## 0. 施工总览

### 0.1 目录结构（新建）

```
project/src/main/modules/portfolio/
├── __init__.py
├── domain/
│   ├── __init__.py
│   ├── transaction.py        # TransactionAction / Transaction / TransactionView
│   ├── position.py           # InstrumentKind / Position / PositionView
│   ├── decision.py           # Decision（占位 dataclass）
│   └── risk.py               # TradeIntent / RiskVerdict（防腐层值对象）
├── protocol.py               # 对外唯一接口：4 个 Protocol
├── repo/
│   ├── __init__.py
│   ├── orm.py                # TransactionORM / PositionORM / DecisionORM
│   └── portfolio_repo.py     # SqlAlchemyPortfolioRepository（写） + SqlAlchemyPositionReader（读）
└── service/
    ├── __init__.py
    ├── portfolio_service.py  # DefaultPortfolioService（实现 PortfolioService）
    └── risk_service.py       # PassThroughRiskService（空实现）
```

### 0.2 改动现有文件清单（最小侵入）

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/main/infra/error_codes.py` | 追加枚举 | 4 个新 ErrorCode（1xxx BizError 段） |
| `src/main/infra/errors.py` | 追加类 | 4 个新 BizError 子类 |
| `src/main/api/v1/portfolio.py` | **新建** | portfolio router |
| `src/main/main.py` | 追加段 | build_registry() 注册 portfolio 4 个 Protocol |
| `src/main/api/app.py` | 追加 2 行 | import + include_router |
| `alembic/env.py` | 追加 3 行 import | 让 autogenerate 感知新 ORM |
| `alembic/versions/002_add_portfolio.py` | **新建** | 建表迁移 |

### 0.3 施工顺序（依赖敏感）

```
A. domain 层（无依赖）
   └─ A1 __init__ → A2 transaction → A3 position → A4 decision → A5 risk
B. Protocol 层（依赖 A）
   └─ B1 protocol.py
C. infra 改动（独立）
   └─ E2 error_codes → E3 errors
D. repo 层（依赖 A + B + C）
   └─ C1 orm → C2 portfolio_repo
E. service 层（依赖 A + B + D）
   └─ D1 portfolio_service → D2 position_reader → D3 risk_service
F. API 层（依赖 B + E）
   └─ F1 __init__ → F2 portfolio router
G. 装配（依赖全部）
   └─ G1 main.py → G2 app.py
H. Alembic 迁移（依赖 C1）
   └─ H1 env.py → H2 002_add_portfolio.py
I. 测试
```

---

## Part A：domain 层

### A1. `modules/portfolio/domain/__init__.py`

空文件（包标识）。

### A2. `modules/portfolio/domain/transaction.py`

**职责**: 定义流水聚合根 + action 枚举 + 读侧视图 DTO。

```python
"""Transaction 聚合根 + TransactionAction 枚举 + TransactionView 读侧 DTO。

流水是 portfolio 模块的 source of truth，append-only，不可改不可删。
纠错通过红冲（reversal_of 指向原交易）完成。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum

from src.main.infra.domain import TraceId


class TransactionAction(str, Enum):
    """交易动作枚举。

    仅 2 种（Q-3 决策取消 ADJUST）。继承 str 以便与 JSON/字符串接口直接互通。
    红冲笔使用反向动作（原 BUY → 红 SELL；原 SELL → 红 BUY）。
    """

    BUY = "buy"
    SELL = "sell"


@dataclass(frozen=True)
class Transaction:
    """流水聚合根（append-only 真相）。

    Attributes:
        id: 流水 ID（UUID4 字符串）。
        symbol: 标的代码（裸字符串，portfolio 不解释含义）。
        kind: 标的类别（stock/fund/crypto）。
        action: 交易动作（BUY/SELL）。
        quantity: 数量，恒正（方向由 action 决定）。
        price: 成交单价。
        occurred_at: 业务发生时间（非写入时间）。
        trace_id: 审计追踪 ID。
        decision_id: 可选外键 → decisions.id（可后续回填）。
        reversal_of: 可选，红冲指向的原 transaction_id。
        memo: 备注（如"初始导入"/"红冲 transaction_id=xxx"）。
        created_at: 写入时间。
    """

    id: str
    symbol: str
    kind: "InstrumentKind"
    action: TransactionAction
    quantity: float
    price: float
    occurred_at: datetime
    trace_id: TraceId
    decision_id: str | None
    reversal_of: str | None
    memo: str | None
    created_at: datetime


@dataclass(frozen=True)
class TransactionView:
    """读侧视图 DTO（list_transactions 返回）。

    与 Transaction 的区别：SELL 笔附带 realized_pnl（该笔产生的已实现盈亏），
    BUY 笔 realized_pnl 为 None。realized_pnl 是纯记账，不依赖行情。

    Attributes:
        realized_pnl: 该笔产生的已实现盈亏（仅 SELL 笔非 None）。
    """

    id: str
    symbol: str
    kind: "InstrumentKind"
    action: TransactionAction
    quantity: float
    price: float
    occurred_at: datetime
    decision_id: str | None
    reversal_of: str | None
    memo: str | None
    realized_pnl: float | None
    created_at: datetime
```

**对照点**:
- 枚举风格对标 `MessageRole(str, Enum)`（conversation/domain/message.py）。
- dataclass 风格对标 `Conversation`（frozen + 带类型注解 + docstring）。
- forward ref `"InstrumentKind"` 避免 circular import（A3 定义）。

### A3. `modules/portfolio/domain/position.py`

**职责**: 持仓物化缓存聚合根 + kind 枚举 + 读侧视图 DTO。

```python
"""Position 物化缓存 + InstrumentKind 枚举 + PositionView 读侧 DTO。

持仓是 transactions 的投影。**永不输出 last_price**（Q-盈亏-1 决策）：
PositionView 含 unrealized_pnl（计算结果），但不含 last_price（输入参数）。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class InstrumentKind(str, Enum):
    """标的类别枚举（Q-6 决策：轻量字段，不建 instruments 表）。

    枚举值可扩展（未来加 bond/option 等）。
    """

    STOCK = "stock"
    FUND = "fund"
    CRYPTO = "crypto"


@dataclass
class Position:
    """持仓物化缓存聚合根（从 transactions 投影）。

    Attributes:
        id: 持仓行 ID（UUID4 字符串）。
        symbol: 标的代码（UNIQUE，一标的一行）。
        kind: 标的类别。
        quantity: 当前持有数量（0 = 已清仓，行不删除）。
        cost_price: 移动加权平均成本（BUY 时重算，SELL 时不变）。
        realized_pnl: 累计已实现盈亏（SELL 时累加，纯记账）。
        unrealized_pnl: 浮盈快照（方案 II：交易时刷 + refresh_pnl 刷，可 None）。
        opened_at: 首次建仓时间。
        last_transaction_at: 最近一笔交易时间。
        pnl_updated_at: 盈亏刷新时间（标注新鲜度）。
        closed_at: 清仓时间（quantity 归零时填，重新建仓时清空）。
        updated_at: 行更新时间。
    """

    id: str
    symbol: str
    kind: InstrumentKind
    quantity: float
    cost_price: float
    realized_pnl: float
    unrealized_pnl: float | None
    opened_at: datetime
    last_transaction_at: datetime
    pnl_updated_at: datetime | None
    closed_at: datetime | None
    updated_at: datetime


@dataclass(frozen=True)
class PositionView:
    """读侧视图 DTO（list_positions / get_position 返回）。

    **不含 last_price**（Q-盈亏-1）。调用方需要现价时自己找行情模块要。
    unrealized_pnl 是计算结果快照（持久化的，非实时算），
    新鲜度由 pnl_updated_at 标注。

    Attributes:
        unrealized_pnl: 浮盈快照（None 表示从未刷新过）。
        pnl_updated_at: 盈亏刷新时间（None 表示从未刷新）。
    """

    id: str
    symbol: str
    kind: InstrumentKind
    quantity: float
    cost_price: float
        # 成本总额 = quantity * cost_price（查询时算，不冗余存储）
    realized_pnl: float
    unrealized_pnl: float | None
    opened_at: datetime
    last_transaction_at: datetime
    pnl_updated_at: datetime | None
    closed_at: datetime | None
```

### A4. `modules/portfolio/domain/decision.py`

**职责**: 决策占位 dataclass（无 service/router，未来模块负责）。

```python
"""Decision 占位聚合根（Q-4 决策：只占表 + dataclass，无 service）。

未来决策模块落地时：
- 写入本表（service 待开发）
- 通过 transactions.decision_id 外键关联执行结果
- 通过 PortfolioService.link_decision() 回填已存在的流水
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from src.main.infra.domain import TraceId


@dataclass(frozen=True)
class Decision:
    """决策记录（占位，本次不实现 service）。

    Attributes:
        id: 决策 ID（UUID4 字符串）。
        agent_name: 产出该决策的 Agent 名称（对标 conversations.agent_name）。
        intent: 决策意图摘要（人类可读）。
        payload: 结构化决策内容（JSON 字符串，具体 schema 由未来决策模块定义）。
        trace_id: 审计追踪 ID。
        created_at: 创建时间。
    """

    id: str
    agent_name: str
    intent: str
    payload: str
    trace_id: TraceId
    created_at: datetime
```

### A5. `modules/portfolio/domain/risk.py`

**职责**: 风控审查对象 + 输出（防腐层值对象，让 RiskService 接口稳定）。

```python
"""风控防腐层值对象：TradeIntent / RiskVerdict。

风控审查的"对象"用中立的 TradeIntent 抽象，既不绑定"订单"语义也不绑定
"建议"语义。未来决策模块落地后，把决策转成 TradeIntent 喂给 RiskService 即可，
不动 RiskService 接口。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from src.main.modules.portfolio.domain.transaction import TransactionAction
from src.main.modules.portfolio.domain.position import InstrumentKind


@dataclass(frozen=True)
class TradeIntent:
    """风控审查对象（防腐层抽象）。

    中立于"订单"与"建议"语义。字段足够表达一次交易意图，但不绑死业务形态。

    Attributes:
        symbol: 目标标的。
        kind: 标的类别。
        action: 意图动作（BUY/SELL）。
        quantity: 意图数量。
        price: 意图价格（可选，建议类意图可能无精确价）。
    """

    symbol: str
    kind: InstrumentKind
    action: TransactionAction
    quantity: float
    price: float | None = None


@dataclass(frozen=True)
class RiskVerdict:
    """风控审查输出。

    Attributes:
        approved: 是否通过。
        violations: 违反的规则列表（空列表 = 全通过）。
        intent: 被审查的原始意图（回链）。
    """

    approved: bool
    violations: list[str] = field(default_factory=list)
    intent: "TradeIntent | None" = None
```

---

## Part B：Protocol 层（对外唯一接口）

### B1. `modules/portfolio/protocol.py`

**职责**: portfolio 模块对其他模块暴露的唯一接口文件。4 个 Protocol。

```python
"""Portfolio 模块对外 Protocol 集合。

本文件是 ``modules/portfolio`` 对其他模块暴露的唯一接口文件，符合
TARGET_ARCHITECTURE_v2 §0 P2（对外只暴露 Protocol）。

包含的 Protocol:
    - ``PortfolioService``: 写侧（4 个 async 方法，持久化/IO）。
    - ``PositionReader``: 读侧（3 个 sync 方法，纯查询）。
    - ``RiskService``: 风控审查（1 个 async 方法，本次为空实现占位）。

设计契约:
    - 写侧 async（对标 ExecutionRecorder）；读侧 sync（对标 ExecutionStateReader）。
    - ``trace_id`` 贯穿每个写侧方法；读侧不写审计。
    - **永不输出 last_price**（Q-盈亏-1）：PositionView 不含现价字段。
    - decisions 表本次无 service/router，仅占位。

Do Not:
    - Do Not #1: 禁止跨模块 ``from X import _xxx``。
    - Do Not #2: 接口未对齐时禁止反射修补；须改 Protocol。
    - 禁止 PositionReader 返回 last_price 字段。
    - 禁止 PortfolioService 提供 update/delete transaction 方法（append-only）。
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from src.main.infra.domain import TraceId
from src.main.modules.portfolio.domain.position import InstrumentKind, PositionView
from src.main.modules.portfolio.domain.risk import RiskVerdict, TradeIntent
from src.main.modules.portfolio.domain.transaction import (
    TransactionAction,
    TransactionView,
)


@runtime_checkable
class PortfolioService(Protocol):
    """仓位写侧接口（4 个 async 方法）。

    实现约束:
        - 全部方法为 ``async def``（写侧持久化/IO）。
        - ``trace_id`` 为必传位置参数，贯穿审计。
        - ``record_transaction`` 内部双写（流水 + 持仓）在同一个 UoW 事务内。
        - 不提供 update / delete transaction（append-only，纠错用红冲）。
    """

    async def record_transaction(
        self,
        symbol: str,
        kind: InstrumentKind,
        action: TransactionAction,
        quantity: float,
        price: float,
        *,
        occurred_at: Any | None = None,
        decision_id: str | None = None,
        reversal_of: str | None = None,
        memo: str | None = None,
        trace_id: TraceId,
    ) -> TransactionView:
        """记录一笔交易（append 流水 + 更新持仓 + 刷新 unrealized_pnl）。

        Args:
            symbol: 标的代码。
            kind: 标的类别。
            action: 交易动作（BUY/SELL）。
            quantity: 数量（恒正）。
            price: 成交单价。
            occurred_at: 业务时间；None 表示用 now()。
            decision_id: 可选，关联决策；可在后续用 link_decision 回填。
            reversal_of: 可选，红冲指向的原 transaction_id。
            memo: 可选备注。

        Returns:
            新建的 TransactionView（SELL 笔含 realized_pnl）。

        Raises:
            InvalidTransactionActionError: action 不合法。
            ReversalAlreadyExistsError: reversal_of 已被红冲过。
            DatabaseError: DB 故障。
        """
        ...

    async def link_decision(
        self,
        transaction_id: str,
        decision_id: str,
        *,
        trace_id: TraceId,
    ) -> None:
        """回填 transaction.decision_id（仅此一字段可改，其他不可动）。

        Args:
            transaction_id: 目标流水 ID。
            decision_id: 要关联的决策 ID。
            trace_id: 审计追踪 ID。

        Raises:
            TransactionNotFoundError: 流水不存在。
            DatabaseError: DB 故障。
        """
        ...

    async def rebuild_positions(
        self,
        *,
        trace_id: TraceId,
    ) -> dict[str, int]:
        """维护接口：按 transactions 全量重算 positions。

        危险操作（核武器），仅在 positions 与流水脱节时手动调。
        会清空并重建整个 positions 表。

        Returns:
            统计字典，如 ``{"rebuilt": 5, "deleted": 2}``。

        Raises:
            DatabaseError: DB 故障。
        """
        ...

    async def refresh_pnl(
        self,
        market_prices: dict[str, float],
        *,
        trace_id: TraceId,
    ) -> int:
        """用外部市场价刷新 unrealized_pnl（未来行情模块调用）。

        不写流水，只更新 positions.unrealized_pnl + pnl_updated_at。
        symbol 不在 market_prices 中的持仓跳过。

        Args:
            market_prices: ``{symbol: 当前市场价}`` 映射。
            trace_id: 审计追踪 ID。

        Returns:
            实际刷新的持仓行数。

        Raises:
            DatabaseError: DB 故障。
        """
        ...


@runtime_checkable
class PositionReader(Protocol):
    """持仓读侧接口（3 个 sync 方法，纯查询，不阻塞事件循环）。

    实现约束:
        - 全部方法为 ``def``（读侧同步）。
        - **永不返回 last_price**（Q-盈亏-1）。
        - unrealized_pnl 是持久化快照，新鲜度由 pnl_updated_at 标注。
    """

    def list_positions(
        self,
        *,
        open_only: bool = True,
    ) -> list[PositionView]:
        """列出持仓（可过滤已关闭）。

        Args:
            open_only: True 仅返回 quantity>0 的；False 含已清仓的。

        Returns:
            PositionView 列表（按 symbol 排序）。
        """
        ...

    def get_position(self, symbol: str) -> PositionView | None:
        """查询单标的当前持仓。

        Args:
            symbol: 标的代码。

        Returns:
            PositionView；不存在返回 None。
        """
        ...

    def list_transactions(
        self,
        symbol: str | None = None,
        *,
        limit: int = 100,
        offset: int = 0,
    ) -> list[TransactionView]:
        """查询历史流水（含每笔 realized_pnl）。

        Args:
            symbol: 可选，按标的过滤；None 表示全量。
            limit: 返回条数上限。
            offset: 分页偏移。

        Returns:
            TransactionView 列表（按 occurred_at 倒序）。
        """
        ...


@runtime_checkable
class RiskService(Protocol):
    """风控审查接口（1 个 async 方法，本次为空实现占位）。

    本次实现 ``PassThroughRiskService``（永远返回 approved=True）。
    未来填业务规则时，替换 DI 注册的实现类即可，不动调用方。
    """

    async def review(
        self,
        intent: TradeIntent,
        *,
        trace_id: TraceId,
    ) -> RiskVerdict:
        """审查一个交易意图。

        Args:
            intent: 待审查的意图（防腐层抽象）。
            trace_id: 审计追踪 ID。

        Returns:
            RiskVerdict（approved + violations 列表）。
        """
        ...
```

---

## Part C（=E）：infra 改动

### E2. `src/main/infra/error_codes.py` 追加

在 1xxx BizError 段追加（紧跟现有 VALIDATION_FAILED = 1100 之后）：

```python
    # ── 1xxx: portfolio ──
    TRANSACTION_NOT_FOUND = 1201
    POSITION_NOT_FOUND = 1202
    REVERSAL_ALREADY_EXISTS = 1203
    INVALID_TRANSACTION_ACTION = 1204
```

**段位约定**: 1xxx BizError。1100 是通用 VALIDATION_FAILED，portfolio 用 12xx 子段。

### E3. `src/main/infra/errors.py` 追加

在 BizError 段追加（紧跟 ValidationError 之后）：

```python
class TransactionNotFoundError(BizError):
    code = ErrorCode.TRANSACTION_NOT_FOUND
    http_status = 404


class PositionNotFoundError(BizError):
    code = ErrorCode.POSITION_NOT_FOUND
    http_status = 404


class ReversalAlreadyExistsError(BizError):
    code = ErrorCode.REVERSAL_ALREADY_EXISTS
    http_status = 409


class InvalidTransactionActionError(BizError):
    code = ErrorCode.INVALID_TRANSACTION_ACTION
    http_status = 422
```

---

## Part D（=C）：repo 层

### D1. `modules/portfolio/repo/orm.py`

**职责**: 3 个 ORM，字段严格对照 schema 最终版（见 QA 文档）。

```python
"""SQLAlchemy ORM models for the portfolio module.

3 个 ORM:
    - ``TransactionORM``: 流水（append-only，不可改不可删）。
    - ``PositionORM``: 持仓物化缓存（从流水投影）。
    - ``DecisionORM``: 决策占位（本次无 service/router）。

继承 ``src.main.infra.db.Base``，UUID4 字符串主键，与项目其他 ORM 约定一致。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.main.infra.db import Base


class TransactionORM(Base):
    """流水 ORM（source of truth，append-only）。"""

    __tablename__ = "transactions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    symbol: Mapped[str] = mapped_column(String, nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    action: Mapped[str] = mapped_column(String, nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    trace_id: Mapped[str] = mapped_column(String, nullable=False)
    decision_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("decisions.id"), nullable=True, index=True
    )
    reversal_of: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class PositionORM(Base):
    """持仓物化缓存 ORM（从流水投影）。"""

    __tablename__ = "positions"
    __table_args__ = (UniqueConstraint("symbol", name="uq_positions_symbol"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    symbol: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    cost_price: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    realized_pnl: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    unrealized_pnl: Mapped[float | None] = mapped_column(Float, nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_transaction_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    pnl_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class DecisionORM(Base):
    """决策占位 ORM（本次无 service/router）。"""

    __tablename__ = "decisions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    agent_name: Mapped[str] = mapped_column(String, nullable=False)
    intent: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    trace_id: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
```

**关键约束**:
- `TransactionORM.decision_id` 是 FK → `decisions.id`（建表顺序：decisions 先于 transactions）。
- `positions.symbol` UNIQUE 约束（一标的一行）。
- 索引：transactions.symbol / occurred_at / decision_id / reversal_of 都加索引（读侧查询模式需要）。

### D2. `modules/portfolio/repo/portfolio_repo.py`

**职责**: 写仓储（双写 + 算法）+ 读仓储。这是核心文件，**所有账本逻辑都在这里**。

```python
"""SQLAlchemy 实现 PortfolioService + PositionReader。

核心逻辑:
    - record_transaction: 双写（流水 + 持仓）在同一个 UoW 事务内。
      - BUY: 重算 cost_price（移动加权平均）+ 刷新 unrealized_pnl。
      - SELL: 累加 realized_pnl + 刷新 unrealized_pnl + quantity 归零时填 closed_at。
      - 红冲笔: reversal_of 唯一性校验 + 反向动作天然抵消。
    - refresh_pnl: 用外部市场价重算 unrealized_pnl。
    - rebuild_positions: 全量重建（清空 positions 表 + 从 transactions 重放）。

异常分层（Do Not #16）: 所有 SQLAlchemyError → DatabaseError。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from src.main.infra.domain import TraceId
from src.main.infra.errors import (
    DatabaseError,
    InvalidTransactionActionError,
    ReversalAlreadyExistsError,
    TransactionNotFoundError,
)
from src.main.infra.uow import UoWFactory
from src.main.modules.portfolio.domain.position import (
    InstrumentKind,
    Position,
    PositionView,
)
from src.main.modules.portfolio.domain.transaction import (
    Transaction,
    TransactionAction,
    TransactionView,
)
from src.main.modules.portfolio.repo.orm import (
    DecisionORM,
    PositionORM,
    TransactionORM,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return str(uuid.uuid4())


# ── domain 转换 ──

def _to_transaction(row: TransactionORM) -> Transaction:
    return Transaction(
        id=row.id,
        symbol=row.symbol,
        kind=InstrumentKind(row.kind),
        action=TransactionAction(row.action),
        quantity=row.quantity,
        price=row.price,
        occurred_at=row.occurred_at,
        trace_id=TraceId(row.trace_id),
        decision_id=row.decision_id,
        reversal_of=row.reversal_of,
        memo=row.memo,
        created_at=row.created_at,
    )


def _to_transaction_view(row: TransactionORM, realized_pnl: float | None) -> TransactionView:
    return TransactionView(
        id=row.id,
        symbol=row.symbol,
        kind=InstrumentKind(row.kind),
        action=TransactionAction(row.action),
        quantity=row.quantity,
        price=row.price,
        occurred_at=row.occurred_at,
        decision_id=row.decision_id,
        reversal_of=row.reversal_of,
        memo=row.memo,
        realized_pnl=realized_pnl,
        created_at=row.created_at,
    )


def _to_position_view(row: PositionORM) -> PositionView:
    return PositionView(
        id=row.id,
        symbol=row.symbol,
        kind=InstrumentKind(row.kind),
        quantity=row.quantity,
        cost_price=row.cost_price,
        realized_pnl=row.realized_pnl,
        unrealized_pnl=row.unrealized_pnl,
        opened_at=row.opened_at,
        last_transaction_at=row.last_transaction_at,
        pnl_updated_at=row.pnl_updated_at,
        closed_at=row.closed_at,
    )


# ── 核心算法（纯函数，便于单测）──

def _apply_buy(pos: PositionORM, qty: float, price: float, now: datetime) -> None:
    """BUY: 移动加权平均成本重算。

    new_cost = (old_qty * old_cost + buy_qty * buy_price) / (old_qty + buy_qty)
    """
    old_total = pos.quantity * pos.cost_price
    new_qty = pos.quantity + qty
    pos.cost_price = (old_total + qty * price) / new_qty if new_qty > 0 else price
    pos.quantity = new_qty
    # 重新建仓时清空 closed_at
    if pos.closed_at is not None and pos.quantity > 0:
        pos.closed_at = None
    # 刷新 unrealized_pnl（用成交价当现价，刚买入 ≈ 0）
    pos.unrealized_pnl = (price - pos.cost_price) * pos.quantity
    pos.pnl_updated_at = now


def _apply_sell(
    pos: PositionORM, qty: float, price: float, now: datetime
) -> float:
    """SELL: 累加 realized_pnl + 减数量 + 归零填 closed_at。

    Returns:
        本次产生的 realized_pnl（供 TransactionView 用）。
    """
    if qty > pos.quantity:
        raise InvalidTransactionActionError(
            f"SELL {qty} exceeds position {pos.quantity} for {pos.symbol}",
            details={"symbol": pos.symbol, "held": pos.quantity, "requested": qty},
        )
    realized = (price - pos.cost_price) * qty
    pos.realized_pnl += realized
    pos.quantity -= qty
    if pos.quantity == 0:
        pos.closed_at = now
    # 刷新 unrealized_pnl（按成交价算剩余持仓浮盈）
    pos.unrealized_pnl = (price - pos.cost_price) * pos.quantity
    pos.pnl_updated_at = now
    return realized


# ── 写仓储 ──

class SqlAlchemyPortfolioRepository:
    """实现 PortfolioService。双写在 UoW 内。"""

    def __init__(self, uow_factory: UoWFactory) -> None:
        self._uow = uow_factory

    def _wrap(self, exc: SQLAlchemyError, op: str, **details: Any) -> DatabaseError:
        return DatabaseError(
            f"portfolio repo failed: {op}", details=details, cause=exc
        )

    async def record_transaction(
        self,
        symbol: str,
        kind: InstrumentKind,
        action: TransactionAction,
        quantity: float,
        price: float,
        *,
        occurred_at: datetime | None = None,
        decision_id: str | None = None,
        reversal_of: str | None = None,
        memo: str | None = None,
        trace_id: TraceId,
    ) -> TransactionView:
        if action not in (TransactionAction.BUY, TransactionAction.SELL):
            raise InvalidTransactionActionError(
                f"invalid action: {action}",
                details={"action": str(action)},
            )
        now = occurred_at or _now()
        realized: float | None = None

        with self._uow.begin() as uow:
            try:
                # 1. 红冲唯一性校验
                if reversal_of is not None:
                    existing = (
                        uow.session.query(TransactionORM)
                        .filter(TransactionORM.reversal_of == reversal_of)
                        .one_or_none()
                    )
                    if existing is not None:
                        raise ReversalAlreadyExistsError(
                            f"transaction {reversal_of} already reversed",
                            details={"reversal_of": reversal_of},
                        )

                # 2. append 流水
                txn_id = _new_id()
                txn_row = TransactionORM(
                    id=txn_id,
                    symbol=symbol,
                    kind=kind.value,
                    action=action.value,
                    quantity=quantity,
                    price=price,
                    occurred_at=now,
                    trace_id=str(trace_id),
                    decision_id=decision_id,
                    reversal_of=reversal_of,
                    memo=memo,
                    created_at=_now(),
                )
                uow.session.add(txn_row)

                # 3. 更新持仓（双写第二步，同一事务）
                pos_row = (
                    uow.session.query(PositionORM)
                    .filter(PositionORM.symbol == symbol)
                    .one_or_none()
                )
                if pos_row is None:
                    # 首次建仓（含 SELL 0 持仓的边界：pos.quantity=0, cost_price=0）
                    pos_row = PositionORM(
                        id=_new_id(),
                        symbol=symbol,
                        kind=kind.value,
                        quantity=0.0,
                        cost_price=0.0,
                        realized_pnl=0.0,
                        unrealized_pnl=None,
                        opened_at=now,
                        last_transaction_at=now,
                        pnl_updated_at=None,
                        closed_at=None,
                        updated_at=now,
                    )
                    uow.session.add(pos_row)

                pos_row.kind = kind.value  # 允许 kind 更新（万一首次录入错）
                pos_row.last_transaction_at = now
                pos_row.updated_at = now

                if action == TransactionAction.BUY:
                    _apply_buy(pos_row, quantity, price, now)
                else:  # SELL
                    realized = _apply_sell(pos_row, quantity, price, now)

            except (InvalidTransactionActionError, ReversalAlreadyExistsError):
                raise
            except SQLAlchemyError as exc:
                raise self._wrap(
                    exc, "record_transaction",
                    symbol=symbol, action=action.value, trace_id=str(trace_id),
                ) from exc

        return _to_transaction_view(txn_row, realized)

    async def link_decision(
        self, transaction_id: str, decision_id: str, *, trace_id: TraceId
    ) -> None:
        with self._uow.begin() as uow:
            try:
                row = (
                    uow.session.query(TransactionORM)
                    .filter(TransactionORM.id == transaction_id)
                    .one_or_none()
                )
                if row is None:
                    raise TransactionNotFoundError(
                        f"transaction {transaction_id} not found",
                        details={"transaction_id": transaction_id},
                    )
                row.decision_id = decision_id  # 仅此一字段可改
            except TransactionNotFoundError:
                raise
            except SQLAlchemyError as exc:
                raise self._wrap(
                    exc, "link_decision",
                    transaction_id=transaction_id, trace_id=str(trace_id),
                ) from exc

    async def rebuild_positions(self, *, trace_id: TraceId) -> dict[str, int]:
        """全量重建 positions：清空 + 按 transactions 时间序重放。"""
        with self._uow.begin() as uow:
            try:
                deleted = uow.session.query(PositionORM).delete()
                # 按 occurred_at 升序重放
                txns = (
                    uow.session.query(TransactionORM)
                    .order_by(TransactionORM.occurred_at.asc())
                    .all()
                )
                positions: dict[str, PositionORM] = {}
                for t in txns:
                    pos = positions.get(t.symbol)
                    if pos is None:
                        pos = PositionORM(
                            id=_new_id(),
                            symbol=t.symbol,
                            kind=t.kind,
                            quantity=0.0,
                            cost_price=0.0,
                            realized_pnl=0.0,
                            unrealized_pnl=None,
                            opened_at=t.occurred_at,
                            last_transaction_at=t.occurred_at,
                            pnl_updated_at=None,
                            closed_at=None,
                            updated_at=t.occurred_at,
                        )
                        positions[t.symbol] = pos
                    pos.last_transaction_at = t.occurred_at
                    action = TransactionAction(t.action)
                    if action == TransactionAction.BUY:
                        _apply_buy(pos, t.quantity, t.price, t.occurred_at)
                    else:
                        _apply_sell(pos, t.quantity, t.price, t.occurred_at)
                for pos in positions.values():
                    uow.session.add(pos)
                return {"rebuilt": len(positions), "deleted": int(deleted)}
            except SQLAlchemyError as exc:
                raise self._wrap(exc, "rebuild_positions", trace_id=str(trace_id)) from exc

    async def refresh_pnl(
        self, market_prices: dict[str, float], *, trace_id: TraceId
    ) -> int:
        now = _now()
        refreshed = 0
        with self._uow.begin() as uow:
            try:
                rows = (
                    uow.session.query(PositionORM)
                    .filter(PositionORM.symbol.in_(list(market_prices.keys())))
                    .all()
                )
                for row in rows:
                    mp = market_prices.get(row.symbol)
                    if mp is None:
                        continue
                    row.unrealized_pnl = (mp - row.cost_price) * row.quantity
                    row.pnl_updated_at = now
                    row.updated_at = now
                    refreshed += 1
                return refreshed
            except SQLAlchemyError as exc:
                raise self._wrap(
                    exc, "refresh_pnl", trace_id=str(trace_id)
                ) from exc


# ── 读仓储 ──

class SqlAlchemyPositionReader:
    """实现 PositionReader（sync，纯查询）。"""

    def __init__(self, session_factory: sessionmaker[Session] | Any) -> None:
        self._sf = session_factory

    def list_positions(self, *, open_only: bool = True) -> list[PositionView]:
        with self._sf() as session:
            q = select(PositionORM)
            if open_only:
                q = q.where(PositionORM.quantity > 0)
            q = q.order_by(PositionORM.symbol.asc())
            return [_to_position_view(r) for r in session.scalars(q).all()]

    def get_position(self, symbol: str) -> PositionView | None:
        with self._sf() as session:
            row = session.scalars(
                select(PositionORM).where(PositionORM.symbol == symbol)
            ).one_or_none()
            return _to_position_view(row) if row else None

    def list_transactions(
        self, symbol: str | None = None, *, limit: int = 100, offset: int = 0
    ) -> list[TransactionView]:
        with self._sf() as session:
            q = select(TransactionORM)
            if symbol is not None:
                q = q.where(TransactionORM.symbol == symbol)
            q = q.order_by(TransactionORM.occurred_at.desc()).limit(limit).offset(offset)
            rows = session.scalars(q).all()
            # realized_pnl 需要从 position 反查累计值不可行（那是累计的），
            # 单笔 realized 只能重算。简化：BUY 笔 None，SELL 笔重算。
            result: list[TransactionView] = []
            for r in rows:
                rpnl: float | None = None
                if TransactionAction(r.action) == TransactionAction.SELL:
                    # 重算该笔 realized = (price - 当时成本) * qty
                    # 注意：成本是 SELL 时刻的成本，不是当前。
                    # 简化实现：取当前 cost_price 近似（精确版本需历史成本快照）。
                    # TODO: 未来若需精确，加 transaction-level cost_price_snapshot 字段。
                    pos = session.scalars(
                        select(PositionORM).where(PositionORM.symbol == r.symbol)
                    ).one_or_none()
                    if pos is not None:
                        rpnl = (r.price - pos.cost_price) * r.quantity
                result.append(_to_transaction_view(r, rpnl))
            return result
```

**重要 TODO 标注**: `list_transactions` 里 SELL 笔的 realized_pnl 用"当前成本"近似，
精确版需要 transaction 级 cost_price 快照。本次接受近似（cost_price 在 SELL 后不变，
所以多数场景准确；只有多次部分卖出后才可能偏差）。手册中明确标注此简化。

---

## Part E（=D3）：service 层

### E1. `modules/portfolio/service/risk_service.py`

**职责**: RiskService 空实现（永远通过）。

```python
"""RiskService 空实现（本次占位，未来填规则）。

替换方式：未来在 main.py:build_registry() 把 PassThroughRiskService 换成
真实实现即可，不动调用方。
"""

from __future__ import annotations

from src.main.infra.domain import TraceId
from src.main.modules.portfolio.domain.risk import RiskVerdict, TradeIntent
from src.main.modules.portfolio.protocol import RiskService


class PassThroughRiskService(RiskService):
    """永远返回 approved=True 的空实现。"""

    async def review(
        self, intent: TradeIntent, *, trace_id: TraceId
    ) -> RiskVerdict:
        return RiskVerdict(approved=True, violations=[], intent=intent)
```

**注**: `DefaultPortfolioService` 直接复用 `SqlAlchemyPortfolioRepository`，
无需独立 service 文件（repo 已实现 Protocol）。但为保持分层一致，可加一层薄封装：

### E2. `modules/portfolio/service/portfolio_service.py`（可选薄封装）

```python
"""PortfolioService 的薄封装（直接委托 SqlAlchemyPortfolioRepository）。

保持 service/repo 分层一致。若偏好极简，可直接在 build_registry 里把
SqlAlchemyPortfolioRepository 注册为 PortfolioService（它已实现 Protocol）。
"""

from __future__ import annotations

from src.main.infra.uow import UoWFactory
from src.main.modules.portfolio.repo.portfolio_repo import SqlAlchemyPortfolioRepository


class DefaultPortfolioService(SqlAlchemyPortfolioRepository):
    """薄封装，仅为命名一致。"""

    def __init__(self, uow_factory: UoWFactory) -> None:
        super().__init__(uow_factory)
```

---

## Part F：API 层

### F1/F2. `src/main/api/v1/portfolio.py`

**职责**: portfolio router（POST 录入 + GET 查询）。

```python
"""API v1 portfolio router — transactions + positions endpoints.

端点:
    - POST /api/v1/portfolio/transactions        录入交易
    - GET  /api/v1/portfolio/transactions        查询流水
    - GET  /api/v1/portfolio/transactions/{id}/decision  回填 decision_id
    - GET  /api/v1/portfolio/positions           查询持仓
    - POST /api/v1/portfolio/positions/rebuild   维护：重建持仓
    - POST /api/v1/portfolio/positions/refresh-pnl  刷新浮盈（未来行情模块用）

底层服务: PortfolioService（写，async）+ PositionReader（读，sync）。
约定对标 conversations.py。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from src.main.api.deps import service_dep
from src.main.infra.api_envelope import ApiResponse
from src.main.infra.tracing import current_trace_id
from src.main.modules.portfolio.domain.position import InstrumentKind, PositionView
from src.main.modules.portfolio.domain.transaction import (
    TransactionAction,
    TransactionView,
)
from src.main.modules.portfolio.protocol import PortfolioService, PositionReader

router = APIRouter(prefix="/api/v1/portfolio", tags=["portfolio"])


# ── Pydantic 请求模型 ──

class TransactionCreate(BaseModel):
    symbol: str
    kind: str = Field(description="stock | fund | crypto")
    action: str = Field(description="buy | sell")
    quantity: float = Field(gt=0)
    price: float = Field(gt=0)
    occurred_at: datetime | None = None
    decision_id: str | None = None
    reversal_of: str | None = None
    memo: str | None = None


class DecisionLink(BaseModel):
    decision_id: str


class PnlRefresh(BaseModel):
    market_prices: dict[str, float]


# ── 序列化 helpers ──

def _txn_to_dict(t: TransactionView) -> dict:
    return {
        "id": t.id,
        "symbol": t.symbol,
        "kind": t.kind.value,
        "action": t.action.value,
        "quantity": t.quantity,
        "price": t.price,
        "occurred_at": t.occurred_at.isoformat(),
        "decision_id": t.decision_id,
        "reversal_of": t.reversal_of,
        "memo": t.memo,
        "realized_pnl": t.realized_pnl,
        "created_at": t.created_at.isoformat(),
    }


def _pos_to_dict(p: PositionView) -> dict:
    return {
        "id": p.id,
        "symbol": p.symbol,
        "kind": p.kind.value,
        "quantity": p.quantity,
        "cost_price": p.cost_price,
        "cost_total": p.quantity * p.cost_price,
        "realized_pnl": p.realized_pnl,
        "unrealized_pnl": p.unrealized_pnl,
        "opened_at": p.opened_at.isoformat(),
        "last_transaction_at": p.last_transaction_at.isoformat(),
        "pnl_updated_at": p.pnl_updated_at.isoformat() if p.pnl_updated_at else None,
        "closed_at": p.closed_at.isoformat() if p.closed_at else None,
    }


# ── Endpoints ──

@router.post("/transactions", status_code=status.HTTP_201_CREATED)
async def create_transaction(
    body: TransactionCreate,
    svc: PortfolioService = Depends(service_dep(PortfolioService)),
) -> dict:
    try:
        kind = InstrumentKind(body.kind)
        action = TransactionAction(body.action)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    txn = await svc.record_transaction(
        symbol=body.symbol,
        kind=kind,
        action=action,
        quantity=body.quantity,
        price=body.price,
        occurred_at=body.occurred_at,
        decision_id=body.decision_id,
        reversal_of=body.reversal_of,
        memo=body.memo,
        trace_id=current_trace_id(),
    )
    return ApiResponse.success(_txn_to_dict(txn), current_trace_id()).to_dict()


@router.get("/transactions")
async def list_transactions(
    symbol: str | None = Query(default=None),
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    reader: PositionReader = Depends(service_dep(PositionReader)),
) -> dict:
    items = reader.list_transactions(symbol=symbol, limit=limit, offset=offset)
    return ApiResponse.success(
        [_txn_to_dict(t) for t in items], current_trace_id()
    ).to_dict()


@router.post("/transactions/{transaction_id}/decision")
async def link_decision(
    transaction_id: str,
    body: DecisionLink,
    svc: PortfolioService = Depends(service_dep(PortfolioService)),
) -> dict:
    await svc.link_decision(
        transaction_id, body.decision_id, trace_id=current_trace_id()
    )
    return ApiResponse.success(
        {"transaction_id": transaction_id, "decision_id": body.decision_id},
        current_trace_id(),
    ).to_dict()


@router.get("/positions")
async def list_positions(
    open_only: bool = Query(default=True),
    reader: PositionReader = Depends(service_dep(PositionReader)),
) -> dict:
    items = reader.list_positions(open_only=open_only)
    return ApiResponse.success(
        [_pos_to_dict(p) for p in items], current_trace_id()
    ).to_dict()


@router.post("/positions/rebuild")
async def rebuild_positions(
    svc: PortfolioService = Depends(service_dep(PortfolioService)),
) -> dict:
    stats = await svc.rebuild_positions(trace_id=current_trace_id())
    return ApiResponse.success(stats, current_trace_id()).to_dict()


@router.post("/positions/refresh-pnl")
async def refresh_pnl(
    body: PnlRefresh,
    svc: PortfolioService = Depends(service_dep(PortfolioService)),
) -> dict:
    count = await svc.refresh_pnl(body.market_prices, trace_id=current_trace_id())
    return ApiResponse.success({"refreshed": count}, current_trace_id()).to_dict()
```

---

## Part G：装配（单一入口）

### G1. `src/main/main.py:build_registry()` 追加

**位置**: 在 `# ── conversation ──` 段之后、`# ── monitoring ──` 段之前追加。

```python
    # ── portfolio ──
    from src.main.modules.portfolio.protocol import (
        PortfolioService,
        PositionReader,
        RiskService,
    )
    from src.main.modules.portfolio.repo.portfolio_repo import (
        SqlAlchemyPortfolioRepository,
        SqlAlchemyPositionReader,
    )
    from src.main.modules.portfolio.service.risk_service import PassThroughRiskService

    reg.register_singleton(PortfolioService, lambda r: SqlAlchemyPortfolioRepository(
        uow_factory=r.resolve(UoWFactory)))
    reg.register_singleton(PositionReader, lambda r: SqlAlchemyPositionReader(session_local))
    reg.register_singleton(RiskService, lambda r: PassThroughRiskService())
```

**顶部 import 段追加**（与其他 Protocol 并列）:

```python
from src.main.modules.portfolio.protocol import PortfolioService, PositionReader, RiskService
```

### G2. `src/main/api/app.py:create_app()` 追加

**改动 1**: v1 import 列表追加（与 conversations 并列）:

```python
    from src.main.api.v1 import (
        agents,
        config,
        conversations,
        executions,
        mcp,
        portfolio,          # ← 新增
        skills,
        workflows,
        rules,
        providers,
        permissions,
        tools,
    )
```

**改动 2**: include_router 段追加（在 conversations 之后）:

```python
    app.include_router(conversations.router)
    app.include_router(portfolio.router)   # ← 新增
```

---

## Part H：Alembic 迁移

### H1. `alembic/env.py` 追加 import

**位置**: 在现有 ORM import 段追加（让 autogenerate 感知新表）:

```python
from src.main.modules.portfolio.repo.orm import (  # noqa: E402
    TransactionORM,
    PositionORM,
    DecisionORM,
)
```

### H2. `alembic/versions/002_add_portfolio.py`（新建）

```python
"""Add portfolio module: transactions, positions, decisions tables.

Tables:
- decisions (placeholder, no service this iteration)
- transactions (append-only ledger, FK to decisions)
- positions (materialized cache projected from transactions)

Revision ID: 002_add_portfolio
Revises: 001_initial_baseline
Create Date: 2026-06-21 00:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "002_add_portfolio"
down_revision: Union[str, None] = "001_initial_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. decisions（先建，transactions.decision_id 是 FK）
    op.create_table(
        "decisions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("agent_name", sa.String(), nullable=False),
        sa.Column("intent", sa.Text(), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("trace_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    # 2. transactions（流水真相）
    op.create_table(
        "transactions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("symbol", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("trace_id", sa.String(), nullable=False),
        sa.Column("decision_id", sa.String(), nullable=True),
        sa.Column("reversal_of", sa.String(), nullable=True),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["decision_id"], ["decisions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_transactions_symbol", "transactions", ["symbol"])
    op.create_index("ix_transactions_occurred_at", "transactions", ["occurred_at"])
    op.create_index("ix_transactions_decision_id", "transactions", ["decision_id"])
    op.create_index("ix_transactions_reversal_of", "transactions", ["reversal_of"])

    # 3. positions（物化缓存）
    op.create_table(
        "positions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("symbol", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("cost_price", sa.Float(), nullable=False),
        sa.Column("realized_pnl", sa.Float(), nullable=False),
        sa.Column("unrealized_pnl", sa.Float(), nullable=True),
        sa.Column("opened_at", sa.DateTime(), nullable=False),
        sa.Column("last_transaction_at", sa.DateTime(), nullable=False),
        sa.Column("pnl_updated_at", sa.DateTime(), nullable=True),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("symbol", name="uq_positions_symbol"),
    )


def downgrade() -> None:
    op.drop_table("positions")
    op.drop_table("transactions")
    op.drop_table("decisions")
```

---

## Part I：测试矩阵

**测试目录**: `project/src/tests/modules/portfolio/`
**约定**: pytest + in-memory SQLite（`sqlite:///:memory:`）+ `Base.metadata.create_all`
（对标 `src/tests/test_conversation_service.py`）。

### I1. `test_portfolio_service.py`（写侧核心）

| 测试用例 | 验证点 |
|---------|--------|
| `test_single_buy_creates_position` | 首次 BUY → positions 新建行，cost_price = 买入价，unrealized_pnl ≈ 0 |
| `test_multiple_buy_weighted_average` | 两次 BUY 不同价 → cost_price = 移动加权平均 |
| `test_sell_reduces_quantity` | SELL → quantity 减少，cost_price 不变 |
| `test_sell_accumulates_realized_pnl` | 多次 SELL → realized_pnl 累加正确 |
| `test_sell_more_than_held_raises` | SELL qty > 持仓 → InvalidTransactionActionError |
| `test_sell_to_zero_sets_closed_at` | 全部卖出 → closed_at 填充，行不删除 |
| `test_rebuy_clears_closed_at` | 清仓后再 BUY → closed_at 清空 |
| `test_double_write_atomicity` | 模拟持仓更新失败 → 流水也不写入（同一 UoW 回滚） |
| `test_transaction_view_realized_pnl` | SELL 笔 TransactionView.realized_pnl 非 None；BUY 笔为 None |

### I2. `test_reversal.py`（红冲）

| 测试用例 | 验证点 |
|---------|--------|
| `test_reversal_creates_opposite_transaction` | 红冲 BUY → 新增一笔 SELL，reversal_of 指向原 ID |
| `test_reversal_of_unique` | 同一 transaction 被红冲两次 → ReversalAlreadyExistsError |
| `test_reversal_restores_position` | 红冲后持仓回到红冲前状态 |

### I3. `test_position_reader.py`（读侧）

| 测试用例 | 验证点 |
|---------|--------|
| `test_list_positions_open_only` | open_only=True 不返回 quantity=0 的行 |
| `test_list_positions_all` | open_only=False 含已清仓行 |
| `test_get_position_not_found` | 不存在 symbol → None |
| `test_list_transactions_pagination` | limit/offset 分页正确 |
| `test_list_transactions_filter_by_symbol` | symbol 过滤正确 |

### I4. `test_refresh_pnl.py`（盈亏刷新）

| 测试用例 | 验证点 |
|---------|--------|
| `test_refresh_pnl_updates_unrealized` | 传入市场价 → unrealized_pnl 重算，pnl_updated_at 更新 |
| `test_refresh_pnl_skips_unknown_symbol` | market_prices 不含的 symbol → 跳过 |
| `test_refresh_pnl_returns_count` | 返回值 = 实际刷新行数 |

### I5. `test_rebuild_positions.py`（维护接口）

| 测试用例 | 验证点 |
|---------|--------|
| `test_rebuild_clears_and_repopulates` | 手动改坏 positions → rebuild 后与流水一致 |
| `test_rebuild_returns_stats` | 返回 {rebuilt, deleted} 统计 |

### I6. `test_link_decision.py`（决策回填）

| 测试用例 | 验证点 |
|---------|--------|
| `test_link_decision_updates_field` | 回填后 transaction.decision_id 正确 |
| `test_link_decision_not_found` | 不存在 transaction → TransactionNotFoundError |
| `test_link_decision_only_changes_decision_id` | 其他字段不变（对比快照） |

### I7. `test_protocol_contract.py`（Protocol 契约）

| 测试用例 | 验证点 |
|---------|--------|
| `test_portfolio_service_is_runtime_checkable` | isinstance(repo, PortfolioService) 为 True |
| `test_position_reader_is_runtime_checkable` | isinstance(reader, PositionReader) 为 True |
| `test_risk_service_passthrough_approved` | PassThroughRiskService.review 返回 approved=True |

### I8. `test_risk_service.py`（空实现）

| 测试用例 | 验证点 |
|---------|--------|
| `test_passthrough_returns_approved` | 任意 intent → approved=True, violations=[] |

### I9. `test_api_portfolio.py`（API 层）

| 测试用例 | 验证点 |
|---------|--------|
| `test_post_transaction_201` | POST /transactions → 201 + 信封 |
| `test_get_positions_envelope` | GET /positions → ApiResponse 信封格式 |
| `test_invalid_kind_422` | kind="invalid" → 422 |
| `test_invalid_action_422` | action="adjust" → 422（ADJUST 已取消） |

---

## Part J：已知约束与 TODO（写入代码注释）

### J1. 已知约束（设计层面，本次接受）

1. **并发写 positions**: record_transaction 和 refresh_pnl 都是写入者。SQLite WAL 模式
   下天然单写者序列化，单行 `WHERE symbol=?` 更新足够。未来迁移 PostgreSQL 再考虑行锁。
2. **unrealized_pnl 过时**: 行情模块接入前，unrealized_pnl 停在"最后一笔交易时的价格"。
   靠 `pnl_updated_at` 标注新鲜度。
3. **list_transactions 的 realized_pnl 近似**: SELL 笔用当前 cost_price 近似算单笔
   realized_pnl。多次部分卖出后才可能偏差。精确版需 transaction 级 cost_price 快照字段。

### J2. 未来 TODO（不阻塞本次）

1. decisions 表的 service/router（决策模块负责）
2. RiskService 的真实规则实现（风控模块负责）
3. refresh_pnl 的真实行情源（行情模块负责）
4. 定期对账 job（reconciliation，可选）
5. transaction 级 cost_price_snapshot（若 realized_pnl 精确性需求出现）

---

## Part K：验收清单（Definition of Done）

实现完成后，逐项核验：

- [ ] `modules/portfolio/` 目录结构完整（domain/protocol/repo/service 四层）
- [ ] 4 个 Protocol 在 protocol.py 中定义且 `@runtime_checkable`
- [ ] 3 张表通过 Alembic 迁移创建（002_add_portfolio.py）
- [ ] `alembic/env.py` 追加 3 个 ORM import
- [ ] 4 个新 ErrorCode + 4 个新 BizError 子类
- [ ] `build_registry()` 注册 PortfolioService / PositionReader / RiskService
- [ ] `app.py` include portfolio router
- [ ] 6 个 API 端点可用（POST/GET transactions、GET positions、link decision、rebuild、refresh-pnl）
- [ ] PositionView 不含 last_price 字段（核心约束）
- [ ] 所有写操作走 UoW（无直接 Session 操控）
- [ ] 所有异常落在 FinAgentError 树（无裸 SQLAlchemyError 泄漏）
- [ ] 测试矩阵 I1-I9 全绿
- [ ] `from src.main.modules.portfolio import _xxx` 在其他模块中无命中（Do Not #1）

---

## 附录：与现有约定的逐条对照

| 现有约定 | portfolio 实现 | 对照文件 |
|---------|---------------|---------|
| 对外只暴露 Protocol | `modules/portfolio/protocol.py` 唯一接口 | execution/protocol.py |
| 写侧 async 读侧 sync | PortfolioService async / PositionReader sync | ExecutionRecorder / ExecutionStateReader |
| `@runtime_checkable` Protocol | 4 个 Protocol 都加 | 所有现有 protocol.py |
| UoW 事务边界 | `with self._uow.begin() as uow:` | execution_service.py |
| SQLAlchemyError → DatabaseError | `_wrap()` helper | execution_service.py |
| `ApiResponse.success().to_dict()` | router 返回 | conversations.py |
| `service_dep(Protocol)` 注入 | router Depends | conversations.py |
| `current_trace_id()` | router 取 trace_id | conversations.py |
| Protocol 顶部 import + 实现类函数内 import | main.py 装配 | main.py build_registry |
| Alembic 管理 schema | 002_add_portfolio.py | 001_initial_baseline.py |
| UUID4 字符串主键 | 所有 ORM | 所有现有 ORM |
| `Base` 继承 | 所有 ORM | infra/db.py |
| str Enum 风格 | TransactionAction / InstrumentKind | MessageRole |
| frozen dataclass + 类型注解 + docstring | 所有 domain | Conversation / Message |
