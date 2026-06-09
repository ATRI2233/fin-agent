# 修复 dist 编码 + 验证 news_sentiment + 评估信息源

## 目标
完成 sentiment-decoder agent 优化的最后两步：
1. 修复 `agents/mcp/core/dist` 下被双重编码损坏的 .js 文件
2. 实际调用 `news_sentiment` 工具，验证 3 种场景的返回数据
3. 多维度评估 US（news_sentiment）和 CN（ashare_news_sentiment）工具信息源是否够用
4. 清理临时测试文件

## Context

### 已完成
1. ✅ 重写 `D:\github_place\fin-agent\.opencode\agents\sentiment-decoder.md`，删除无数据支撑字段
2. ✅ 实际调用 `ashare_news_sentiment` Python 工具验证 3 场景
3. ✅ 诊断 dist 损坏范围（19 个文件，14 个损坏）
4. ✅ 诊断 src 状态（src 是 GBK 编码，**不是损坏**）

### 关键发现
- **src/ TypeScript 文件是 GBK 编码**（不是 UTF-8，但 tsc 能正常读取）
- **dist/ JavaScript 文件是双重编码损坏**（UTF-8 字节被错误地按 GBK 重新解码保存）
- 修复策略：仅修复 dist，不动 src

### 损坏分析
- 14 个文件损坏
- 119 个 `\uFFFD`（�）+ 119 个 `\xef\xbf\xbd` 字节 + 18 个 `,,` 模式
- 3 个文件语法断裂（sectorRotation.js, insiderTrading.js, optionsGreeks.js）- 不影响 news_sentiment 测试
- 11 个文件仅字符串内容损坏

## 修复方案

### 目标
仅修复 11 个非结构性损坏的 .js 文件（newsSentiment.js 在内）：
- 对每个含 `\uFFFD` 的字符串字面量，尝试反向还原
- 如果还原失败（仍包含 `\uFFFD` 或非中文字符），用占位符替换

### 风险
- 修复后字符串可能不完全准确（中文可能有偏差）
- 不影响工具的功能（description 字符串只用于 MCP 协议描述）

## 实施步骤

### 步骤 1: 诊断 dist 损坏范围 ✅
- 扫描 20 个 .js 文件，输出损坏文件清单和损坏位置
- 实际结果：14 / 19 损坏，3 个结构性断裂，11 个字符串损坏

### 步骤 2: 制定修复策略 ✅
- src 是 GBK 编码（不是损坏）
- dist 是双重编码损坏
- 策略：仅修复 dist 字符串

### 步骤 3: 实施修复
- **任务**：用 Python 脚本修复 11 个文件的字符串损坏
  - 读取每个 .js 文件
  - 用正则匹配所有字符串字面量
  - 对包含 `\uFFFD` 的字符串：
    1. 尝试将字符串按 GBK 解码，再按 UTF-8 编码
    2. 验证还原后是否还有 `\uFFFD`
    3. 如果没有，写回文件
    4. 如果仍有，用占位符 `<corrupted string removed>` 替代
  - 保存备份为 `<file>.bak`
  - 用 `node --check` 验证
- **输出**：报告修复结果
- **实际结果**（B 和 C 已完成）：
  - **关键发现**：**.ts 源文件也被破坏**（不只是 .js）
  - 所有 src/tools 文件都有相同的字符串损坏
  - 11 个目标 .js 文件**无法用 .ts 作为 ground truth 修复**
  - 3 个并行代理尝试了多种方法：
    - 字符串级替换（失败：.ts 内容也损坏）
    - GBK→UTF-8 反向解码（失败：文件既不是纯 UTF-8 也不是纯 GBK）
    - Git HEAD 检查（失败：HEAD 版本也有同样损坏）
    - tsc 重新编译（失败：.ts 文件有语法错误）
  - 代理 C 错误地删除了 `inputSchema: {` 行，需要回滚

### 步骤 4: 实际调用 news_sentiment
- **任务**：用 Python 通过 MCP stdio 协议调用 news_sentiment
- **关键依赖**：newsSentiment.js（已修复）和 mcpClientManager.js（必须可用）
- **测试场景**：
  1. 正常情况：AAPL，72h
  2. 错误情况：无 ticker
  3. 降级情况：未知 ticker
- **输出**：3 个 JSON 返回值

### 步骤 5: 多维度评估信息源
- **评估维度**：
  1. 数据维度（情绪分数、价格、新闻列表、恐惧贪婪指数、源可信度）
  2. 时间维度（72h vs 24h、时间衰减）
  3. 市场覆盖（US vs CN 对等性）
  4. 信号质量（评分依据：关键词、可信度加权、时间衰减）
  5. 缺口分析（与专业情绪分析对比缺什么）
- **输出**：评估报告 + 是否需要新增工具的建议

### 步骤 6: 清理临时文件
- 删除 `agents/mcp/core/` 下的测试文件
  - test_news_sentiment.ts
  - test_news_sentiment.mts
  - test_news_sentiment.cjs

## 验证标准

1. ✅ dist 下所有 11 个目标文件 `node --check` 通过
2. ✅ MCP server 能成功启动
3. ✅ news_sentiment 3 个场景调用都有结果
4. ✅ 评估报告输出信息源是否够用的判断
5. ✅ 临时测试文件已清理

## 风险与回退

- **风险 1**：修复后字符串仍有 `\uFFFD`
  - 回退：用占位符替代
- **风险 2**：FINNHUB_API_KEY 无效
  - 回退：使用 mock 数据
- **风险 3**：mcpClientManager.js 也是损坏的
  - 回退：先修复它（它在修复列表中）

## 不在本计划范围

- 不修复 src/*.ts 文件（不是损坏）
- 不修改其他 agent 的 prompt
- 不调用其他工具

## 后续（评估后决定）

根据步骤 5 的评估结果，可能需要：
- 新增工具建议
- 修改 sentiment-decoder.md 输出格式
- 调整 fusion-brain 权重
