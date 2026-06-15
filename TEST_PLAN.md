# Agent 全链路测试计划

## 测试目标
模拟前端真实调用方式，测试每个 Agent 的独立能力和工作流协作能力，发现并记录所有异常。

## 测试环境
- FastAPI Backend: `http://localhost:8000/api/v1/`
- OpenCode Serve: `http://localhost:4096/`
- 数据库: `data/finagent.db`

## 测试用例

### Phase 1: 环境就绪检查
| # | 检查项 | 方法 |
|---|--------|------|
| 1.1 | FastAPI 启动 | `GET /api/v1/health` |
| 1.2 | OpenCode Serve 运行 | `GET http://localhost:4096/mcp` |
| 1.3 | MCP Server 连接状态 | 检查各 MCP server status |
| 1.4 | Agent 配置完整 | 检查 `.opencode/agents/` 目录 |

### Phase 2: 单 Agent 独立测试 (dispatch API)
每个 Agent 用简单 prompt 测试，验证：能响应、能调用工具、返回有效结果。

| # | Agent | Prompt | 预期工具调用 |
|---|-------|--------|-------------|
| 2.1 | `technical-chartist` | "分析招商南油(601975)的技术面" | `ashare_stock_lookup`, `ashare_technical_levels`, `ashare_quote` |
| 2.2 | `fundamental-auditor` | "分析招商南油(601975)的基本面" | `ashare_stock_lookup`, `ashare_financial_report` |
| 2.3 | `macro-scout` | "当前中国宏观经济形势如何?" | `cn_macro_*` tools |
| 2.4 | `sentiment-decoder` | "分析招商南油(601975)的市场情绪" | `ashare_stock_lookup`, `ashare_quote` |
| 2.5 | `sector-rotator` | "分析航运板块的轮动情况" | `ashare_sector_*` tools |
| 2.6 | `smart-money-hound` | "分析招商南油(601975)的资金流向" | `ashare_stock_lookup`, `ashare_money_flow` |
| 2.7 | `risk-gatekeeper` | "评估招商南油(601975)的风险" | `risk_*` tools |
| 2.8 | `devil-advocate` | "招商南油值得投资吗?" | `ashare_stock_lookup` |
| 2.9 | `conflict-resolver` | 带上下文测试 | 无需工具 |
| 2.10 | `memory-learner` | 学习型 agent | 无需工具 |
| 2.11 | `fin-orchestrator` | "帮我分析招商南油" | 调度其他 agent |

### Phase 3: 名称→代码映射测试
| # | 输入 | 预期代码 | 测试 Agent |
|---|------|---------|-----------|
| 3.1 | "招商南油" | 601975 | technical-chartist |
| 3.2 | "贵州茅台" | 600519 | fundamental-auditor |
| 3.3 | "601975" (直接代码) | 601975 | technical-chartist |
| 3.4 | "宁德时代" | 300750 | technical-chartist |

### Phase 4: 工作流测试
| # | 工作流 | 输入 | 预期 |
|---|--------|------|------|
| 4.1 | 已有工作流 (fundamental→conflict) | "分析招商南油" | 所有节点成功完成 |
| 4.2 | 创建新工作流 (全 Agent) | "分析招商南油" | 全链路通过 |

### Phase 5: 错误处理测试
| # | 场景 | 预期行为 |
|---|------|---------|
| 5.1 | 不存在的股票名 | Agent 返回错误提示而非崩溃 |
| 5.2 | 超时测试 | 120s 超时正确返回 |
| 5.3 | 空 prompt | 返回 422 验证错误 |

## 测试结果记录格式
每个测试记录：
- 测试时间
- 请求内容
- 响应状态
- 工具调用情况 (是否调用了预期工具)
- 返回结果摘要
- 发现的问题
