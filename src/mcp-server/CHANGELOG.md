# Changelog

## 1.1.0 (2026-05-23)

### 重构
- **MCP 客户端管理器重写**：`MCPClientManager` 从空桩改为基于 SDK Client + StdioClientTransport 的真实实现
  - 惰性连接：首次 `callTool()` 时 spawn + connect
  - 连接池：按 serverName 缓存，进程崩溃自动重连
  - 超时控制：每个 call 默认 30s，可配置
  - 代理引导：`NODE_OPTIONS=--import proxy-bootstrap.mjs` 注入子进程全局代理
- **6 个工具重构**：移除对死网关 `internal-api.z.ai` 的依赖，改用 `stock-scanner` MCP
  - `market_snapshot`：TradingView 指数 + 板块行情
  - `sector_rotation`：TradingView 板块相对强度计算
  - `technical_levels`：TradingView RSI/MACD/布林带/枢轴点/均线
  - `news_sentiment`：Finnhub 新闻 + 恐惧贪婪指数 + 情绪衰减
  - `fundamental_scan`：TradingView 基本面字段（P/E/ROE/负债率等，无需 API Key）
  - `signal_fusion`：多源加权信号融合（技术35%+基本面30%+情绪10%+宏观10%+期权10%+内部交易5%）

### 新增
- **代理引导模块**：`proxy-bootstrap.mjs` 通过 undici `setGlobalDispatcher` 为子进程注入全局代理
- **`.env` 自动加载**：引入 `dotenv`，启动时自动读取 `FINNHUB_API_KEY`、`FRED_API_KEY`、`OILPRICE_API_KEY`
- **API Key 支持**：Finnhub（新闻/基本面）、FRED（宏观数据）、OilpriceAPI（大宗商品）

### 修复
- **工具注册消失**：`server.setRequestHandler()` 重复调用覆盖问题，统一为单 handler 路由
- **子进程不继承代理**：MCP SDK `getDefaultEnvironment()` 不传 `HTTP_PROXY`，通过 NODE_OPTIONS 注入解决
- **Sector rotation 相对强度为 0**：`data.Perf_1M` 点号字段名访问不到 `data["Perf.1M"]`，添加回退访问
- **sec_filings 崩溃**：`filings.find is not a function`，添加 `Array.isArray` 守卫
- **signal_fusion 负 ROE 计分错误**：ROE 为负时错误加分，改为减分
- **代理硬编码 7897**：移除所有默认代理地址，仅在环境变量显式配置时启用

### 配置
- 新增 `.env` 文件，存放 API Key（已加入 `.gitignore`）
- 代理不再硬编码，由 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量控制

### 依赖
- 新增：`dotenv`（环境变量加载）
- 移除：`global-agent`（原代理方案不再使用）
