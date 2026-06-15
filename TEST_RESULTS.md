# Agent 全链路测试结果报告

**测试时间**: 2026-06-14 16:00-16:10
**测试环境**: FastAPI (port 8000) + OpenCode Serve (port 4096)

---

## Phase 1: 环境就绪 ✅

| 检查项 | 状态 | 备注 |
|--------|------|------|
| FastAPI 启动 | ✅ | port 8000 |
| OpenCode Serve | ✅ | port 4096 |
| MCP Servers | ✅ | 11/12 connected (sec-edgar 未连接，不影响A股) |
| Agent 配置 | ✅ | 11 个 agent 可用 |

---

## Phase 2: 单 Agent 独立测试

| # | Agent | 状态 | 耗时 | 工具调用 | 问题 |
|---|-------|------|------|---------|------|
| 2.1 | technical-chartist | ✅ | 43s | ashare_quote, ashare_technical_levels | 无 |
| 2.2 | fundamental-auditor | ✅ | 23s | ashare_financial_report | 无 |
| 2.3 | macro-scout | ✅ | 32s | cn_macro_* | 无 |
| 2.4 | sentiment-decoder | ✅ | 37s | stock_sentiment, news_sentiment | 无 |
| 2.5 | sector-rotator | ✅ | 64s | sector_rotation, ashare_fund_flow | 部分工具调用失败但有降级处理 |
| 2.6 | smart-money-hound | ✅ | 24s | ashare_fund_flow, ashare_lhb | ⚠️ 工具报错 (见下) |
| 2.7 | risk-gatekeeper | ✅ | 14s | risk_gauge | ⚠️ 数据不足 (见下) |
| 2.8 | devil-advocate | ✅ | 52s | 无 (纯推理) | 无 |
| 2.9 | fin-orchestrator | ✅ | 10s | 无 (介绍) | 无 |

---

## Phase 3: 名称→代码映射测试 ✅

| 输入 | Agent | 预期代码 | 结果 |
|------|-------|---------|------|
| 招商南油(601975) | technical-chartist | 601975 | ✅ 正确 |
| 贵州茅台(600519) | technical-chartist | 600519 | ✅ 正确 |
| 宁德时代(300750) | technical-chartist | 300750 | ✅ 正确 |
| 贵州茅台(600519) | fundamental-auditor | 600519 | ✅ 正确 |

---

## Phase 4: 工作流测试

| # | 场景 | 状态 | 问题 |
|---|------|------|------|
| 4.1 | 已有工作流重新触发 | ❌ 500 | **BUG-1**: 状态机不允许 failed→running |
| 4.2 | 新建工作流执行 | ⚠️ | **BUG-2**: 执行完成后状态仍为 running |
| 4.3 | 工作流节点执行 | ✅ | input→tech/fund→output 全部完成 |
| 4.4 | 通过聊天触发工作流 | ✅ | 正常返回 execution_id |

---

## Phase 5: 错误处理测试

| # | 场景 | 状态 | 结果 |
|---|------|------|------|
| 5.1 | 不存在的股票 | ✅ | Agent 返回 "data_unavailable" 而非崩溃 |
| 5.2 | 空 prompt | ⚠️ | 返回空结果，未返回 422 错误 |
| 5.3 | 错误代码格式 | ✅ | Agent 正确识别并提示 |

---

## 发现的 BUG 列表

### BUG-1: 工作流状态机不允许 failed→running 转换
- **位置**: `main/framework/core/state_machine.py` 第 138 行
- **现象**: 已失败的工作流无法重新触发，返回 500 错误
- **错误信息**: `InvalidStatusTransition: Invalid workflow transition: 'failed' -> 'running'`
- **影响**: 用户无法重试失败的工作流
- **修复方案**: 在 `WorkflowStatus` 中添加 `failed→running` 转换，或在 trigger 前先重置状态为 pending

### BUG-2: 工作流执行完成后状态未更新为 "completed"
- **位置**: `main/framework/controllers/workflows.py` `_run_workflow_async()` 函数
- **现象**: 所有节点执行完成后，WorkflowExecution 状态仍为 "running"
- **原因**: `engine.execute()` 成功返回后没有调用 `exec_repo.update_execution(execution_id, status="completed")`
- **影响**: 前端轮询永远看不到完成状态
- **修复方案**: 在 `engine.execute()` 后添加状态更新

### BUG-3: smart-money-hound 工具调用异常
- **位置**: `ashare_fund_flow`, `ashare_fund_flow_real`, `ashare_lhb`
- **现象**: 返回 NoneType 错误，无法获取资金流向数据
- **影响**: 资金流向分析不可用
- **修复方案**: 检查 MCP 工具实现，添加空值处理

### BUG-4: risk-gatekeeper 数据不足
- **位置**: `risk_gauge` 工具
- **现象**: 提示"数据不足（需要 ≥60 个交易日）"
- **影响**: 风险评估无法完成
- **说明**: 可能是数据源限制，非代码 bug

### BUG-5: 空 prompt 未返回验证错误
- **位置**: `main/framework/controllers/dispatch.py`
- **现象**: 空 prompt 返回 200 + 空结果，而非 422 验证错误
- **影响**: 用户体验不佳
- **修复方案**: 添加 prompt 非空验证

---

## 待修复优先级

1. **BUG-2** (高): 工作流状态不更新 - 影响核心功能
2. **BUG-1** (高): 无法重试工作流 - 影响用户体验
3. **BUG-3** (中): 资金流向工具异常 - 影响分析完整性
4. **BUG-5** (低): 空 prompt 验证 - 用户体验优化
5. **BUG-4** (低): 数据不足 - 可能是数据源限制
