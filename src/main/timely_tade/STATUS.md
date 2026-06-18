# timely_tade — 占位模块

**状态**: 占位（暂未实现）
**计划**: 及时交易模块（拼写沿用项目命名传统 — "tade" 而非 "trade"）
**移除/实现时间**: 待定

## 目的

预留用于实时信号 → 交易执行链路（券商接口、订单路由、滑点控制）。

## 当前状态

- 目录已创建以保留命名空间
- **没有任何代码、测试或子模块**
- 不在 pytest 收集路径上
- 不在 runtime import 路径上

## 占位意图

保留空目录的原因：防止 skill 或 agent 引用 `main.timely_tade.*`
路径时因 ModuleNotFoundError 而失败。

## 命名说明

注意拼写：`timely_tade` 而非 `timely_trade`。这是项目早期约定，
未在任何现有代码中作为模块引用。实现时可保留或重命名为
`main.framework.services.core.timely_trade`。

## 移除条件

满足以下任一条件可移除此目录：

1. 交易模块在新位置落地（推荐：`main/framework/services/core/trade_service.py`）
2. 没有任何代码引用此路径

## 历史

- 2026-06-18: 加 STATUS.md 说明占位意图