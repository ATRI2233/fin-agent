# BUG 修复报告

**修复时间**: 2026-06-14 16:12

---

## ✅ BUG-1: 工作流状态机不允许 failed→running 转换

**文件**: `main/framework/core/state_machine.py` 第 78 行

**修复**: 添加 `WorkflowStatus.RUNNING` 到 `FAILED` 状态的允许转换集合

```python
# Before:
WorkflowStatus.FAILED:    frozenset({WorkflowStatus.DRAFT}),

# After:
WorkflowStatus.FAILED:    frozenset({WorkflowStatus.DRAFT, WorkflowStatus.RUNNING}),
```

**验证**: 已失败的工作流现在可以重新触发，返回 202 状态码

---

## ✅ BUG-2: 工作流执行完成后状态未更新为 "completed"

**文件**: `main/framework/controllers/workflows.py` `_run_workflow_async()` 函数

**修复**: 在 `engine.execute()` 成功返回后更新执行状态

```python
# Before:
engine = container.create_workflow_engine(workflow_id, params, execution_id=execution_id)
await engine.execute()

# After:
engine = container.create_workflow_engine(workflow_id, params, execution_id=execution_id)
result = await engine.execute()
# Update execution status based on result
final_status = "completed"
if result and isinstance(result, dict):
    final_status = result.get("status", "completed")
with contextlib.suppress(Exception):
    exec_repo.update_execution(execution_id, status=final_status)
```

**验证**: 执行状态在所有节点完成后正确更新为 "completed"

---

## ✅ BUG-5: 空 prompt 未返回验证错误

**文件**: `main/framework/controllers/dispatch.py` 第 51 行

**修复**: 添加 `min_length=1` 验证

```python
# Before:
prompt: str = Field(..., max_length=10000)

# After:
prompt: str = Field(..., min_length=1, max_length=10000)
```

**验证**: 空 prompt 现在返回 422 Validation Error

---

## ⚠️ BUG-3: smart-money-hound 工具调用异常

**状态**: 未修复（需进一步调查）

**现象**: `ashare_fund_flow`, `ashare_fund_flow_real`, `ashare_lhb` 返回异常

**可能原因**:
1. akshare 库版本问题导致 API 返回格式变化
2. 网络请求超时或被限制
3. 数据源（东方财富）接口变更

**建议**: 需要单独调试 akshare 库的接口调用

---

## ⚠️ BUG-4: risk-gatekeeper 数据不足

**状态**: 非代码 BUG（数据源限制）

**现象**: `risk_gauge` 提示"数据不足（需要 ≥60 个交易日）"

**说明**: 这是数据源的正常限制，需要足够的历史数据才能计算风险指标

---

## 修复总结

| BUG | 状态 | 影响 |
|-----|------|------|
| BUG-1 | ✅ 已修复 | 工作流可重试 |
| BUG-2 | ✅ 已修复 | 执行状态正确更新 |
| BUG-3 | ⚠️ 待调查 | 资金流向数据不可用 |
| BUG-4 | ℹ️ 非BUG | 数据源限制 |
| BUG-5 | ✅ 已修复 | 输入验证完善 |
