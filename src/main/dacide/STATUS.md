# dacide — 占位模块

**状态**: 占位（暂未实现）
**计划**: 决策模块（Decision Module）
**移除/实现时间**: 待定

## 目的

预留用于将工作流执行结果转化为可执行的投资决策（含仓位/止损/止盈）。

## 当前状态

- 目录已创建以保留命名空间
- **没有任何代码、测试或子模块**
- 不在 pytest 收集路径上
- 不在 runtime import 路径上（`main.framework` 和 `main.session` 不引用本模块）

## 占位意图

保留空目录的原因：防止后续工作流模板和 Agent 提示词在引用
`main.dacide.*` 路径时因 ModuleNotFoundError 而失败。

## 移除条件

满足以下任一条件可移除此目录：

1. 决策模块在新位置落地（推荐：`main/framework/services/core/decision_service.py`）
2. 工作流模板不再引用 `dacide` 路径

## 历史

- 2026-06-18: 加 STATUS.md 说明占位意图