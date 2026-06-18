# data_learning — 占位模块

**状态**: 占位（暂未实现）
**计划**: 数据学习模块
**移除/实现时间**: 待定

## 目的

预留用于机器学习驱动的特征工程与模型训练（如价格预测、波动率建模）。

## 当前状态

- 目录已创建以保留命名空间
- **没有任何代码、测试或子模块**
- 不在 pytest 收集路径上
- 不在 runtime import 路径上

## 占位意图

保留空目录的原因：避免破坏可能在 skill 或 agent prompt 中引用
`main.data_learning.*` 的代码。

## 移除条件

满足以下任一条件可移除此目录：

1. 数据学习模块在新位置落地（推荐：`main/framework/services/core/learning_service.py`）
2. 没有任何代码引用此路径

## 历史

- 2026-06-18: 加 STATUS.md 说明占位意图