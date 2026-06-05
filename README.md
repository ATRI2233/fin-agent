# Fin-Agent - 金融分析 Agent 系统

基于 OpenCode 的多 Agent 金融分析系统，集成 8 个专业分析 Agent 和 6 个 MCP Server，支持 A 股和美股的全维度分析。

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Web UI (React)                         │
├─────────────────────────────────────────────────────────────┤
│                    OpenCode Framework                       │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────┤
│ 宏观侦察 │ 技术形态 │ 基本面审计│ 情绪解码 │ 板块轮动 │ ...  │
├──────────┴──────────┴──────────┴──────────┴──────────┴──────┤
│                      MCP Servers                            │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│  │ ASHARE  │ │ FIN-AGENT│ │  FRED   │ │ SEC-EDGAR│          │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## Agent 矩阵

| Agent | 职责 | 天时/地利/人和/主力/时机/安全/质地 |
|-------|------|------|
| **Macro-Scout** | 宏观环境侦察 | 天时 - 判断大环境是否适合交易 |
| **Sector-Rotator** | 板块轮动分析 | 地利 - 资金流向和景气赛道 |
| **Sentiment-Decoder** | 新闻情绪解码 | 人和 - 市场叙事和舆情分析 |
| **Smart-Money-Hound** | 聪明钱追踪 | 主力 - 大资金和机构动向 |
| **Technical-Chartist** | 技术形态分析 | 时机 - 买卖点和关键价位 |
| **Fundamental-Auditor** | 基本面审计 | 质地 - 公司估值和财报分析 |
| **Risk-Gatekeeper** | 风控守门员 | 安全 - 仓位管理和风险评估 |
| **Fusion-Brain** | 信号融合仲裁 | 综合 - 多维度加权决策 |
| **Memory-Learner** | 经验学习 | 进化 - 历史准确率和规则优化 |
| **Devil-Advocate** | 魔鬼代言人 | 对抗 - 反方论点和风险提示 |

## MCP Server 工具集

### ASHARE MCP Server (A 股)
- `ashare_quote` - 实时行情：最新价/涨跌幅/成交量
- `ashare_technical_levels` - 技术指标：RSI/EMA/布林带/MACD
- `ashare_fundamental_scan` - 基本面：ROE/净利润/PE/PB
- `ashare_news_sentiment` - 新闻情绪分析
- `ashare_market_snapshot` - 大盘指数快照
- `ashare_fund_flow` - 个股资金流向
- `ashare_lhb` - 龙虎榜数据

### FIN-AGENT MCP Server (美股)
- `market_snapshot` - 美股大盘快照
- `technical_levels` - 技术分析
- `news_sentiment` - 新闻情绪分析
- `fundamental_scan` - 基本面扫描
- `earnings_calendar` - 财报日历
- `sector_rotation` - 板块轮动
- `insider_trading` - 内部人交易
- `fear_greed_index` - 恐慌贪婪指数
- `analyst_ratings` - 分析师评级
- `options_greeks` - 期权希腊字母
- `commodity_prices` - 大宗商品价格
- `sec_filings` - SEC 财报查询
- `risk_gauge` - 风险评估

### LIB MCP Server (逻辑工具)
- `memory_recall` / `memory_save` / `memory_verify` - 记忆系统
- `experience_summary` - 经验总结
- `rule_manage` - 规则管理
- `signal_fusion` - 信号融合
- `consistency_check` - 一致性检查
- `devil_advocate` - 魔鬼代言人

### FRED MCP Server (宏观数据)
- `fred_search` / `fred_series` / `fred_category` - 美联储经济数据

### Risk MCP Server (风控)
- `risk_position_size` - 仓位计算
- `risk_stop_loss` - 止损计算
- `risk_portfolio_analysis` - 组合分析
- `risk_hedge` - 对冲建议

### SEC-EDGAR MCP Server
- `sec_company_search` / `sec_filings_search` / `sec_filing_content` / `sec_financial_data`

## 快速开始

### 1. 安装依赖

```bash
# Python 依赖
pip install -r requirements.txt

# Node.js 依赖
cd agents/mcp/core && npm install
cd agents/lib && npm install
cd agents/mcp/fred && npm install
```

### 2. 配置环境变量

复制 `.env.example` 文件并填入 API Key：
- `FRED_API_KEY` - FRED 宏观数据 API

### 3. 启动系统

```bash
# Windows
start.bat

# PowerShell
.\start.ps1

# 或直接运行
cd main && python -m framework.main
```

### 4. 访问 Web UI

启动后访问 http://localhost:3000

## 目录结构

```
fin-agent/
├── agents/
│   ├── mcp/              # MCP Server 实现
│   │   ├── core/         # 核心金融分析
│   │   ├── ashare/       # A 股数据
│   │   ├── fred/         # 宏观数据
│   │   └── risk/         # 风控计算
│   ├── lib/              # 共享工具库
│   ├── hapi-hub/         # HAPI 集成
│   └── opencode/         # OpenCode 集成
├── main/
│   └── framework/        # 主框架 (FastAPI)
│       ├── api/          # API 路由
│       ├── core/         # 核心逻辑
│       ├── models/       # 数据模型
│       └── tests/        # 测试
├── webui/                # 前端界面 (React)
│   ├── src/
│   │   ├── pages/        # 页面组件
│   │   └── components/   # 通用组件
│   └── server/           # BFF 服务
├── .opencode/            # OpenCode 配置
│   ├── agents/           # Agent 定义
│   └── skills/           # Skills 定义
├── opencode.json         # 主配置文件
├── start.bat             # Windows 启动脚本
└── requirements.txt      # Python 依赖
```

## 技术栈

- **后端**: Python 3.11+, FastAPI, SQLAlchemy
- **前端**: React 18, TypeScript, Vite
- **Agent 框架**: OpenCode
- **MCP Servers**: Node.js (TypeScript), Python
- **数据源**: AKShare (A 股), FinVul (美股), FRED (宏观), SEC-EDGAR

## License

MIT
