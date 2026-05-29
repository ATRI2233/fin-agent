# 金融分析 MCP 服务器生态

基于 Agent + 多数据源 MCP 架构的金融分析系统，聚合美联储经济数据 (FRED)、A股市场数据、SEC 财报、风险控制等多源数据，提供 18+ 金融分析工具。

## 目录结构

```
financial_stock/
├── BUILD.md                            # 部署包构建说明（从 src/ 构建 deploy/）
├── src/                                # 源码目录
│   ├── mcp-server/                     # 核心金融分析 MCP 服务器
│   │   ├── src/
│   │   │   ├── index.ts               # 服务入口
│   │   │   ├── mcp/                   # MCP 协议实现
│   │   │   ├── memory/                # SQLite 记忆层
│   │   │   └── tools/                 # 18+ 金融分析工具
│   │   ├── dist/                      # 编译输出
│   │   └── package.json
│   ├── mcp-servers/                   # MCP 服务器集合
│   │   ├── fred/                      # 美联储经济数据 (FRED)
│   │   ├── ashare/                    # A 股市场数据 (akshare)
│   │   ├── risk/                      # 风控计算服务
│   │   └── sec-edgar/                 # SEC 财报查询
│   ├── skill/                         # 编排器 + Agent 技能引擎
│   │   ├── agents/                    # 子 Agent 定义
│   │   ├── src/                       # orchestrator + engines
│   │   ├── market-briefing/SKILL.md   # 大盘快照技能
│   │   ├── stock-deep/SKILL.md        # 个股分析技能
│   │   ├── fin-review/SKILL.md        # 周度复盘技能
│   │   └── position-watch/SKILL.md    # 持仓盯盘技能
│   └── webui/                         # WebUI 管理界面
│       ├── src/                       # React 前端源码
│       ├── server/                    # Express 后端源码
│       ├── vite.config.ts
│       └── package.json
├── plugin/
│   └── opencode-plugin/               # opencode 插件安装器
│       ├── src/                       # 安装逻辑 (index.ts, configure-mcp.ts)
│       └── package.json
├── scripts/                           # 安装脚本
│   ├── install.bat                    # Windows
│   └── install.sh                     # Linux / macOS
├── .opencode/                         # 项目级 opencode 配置
│   ├── agents/                        # 9 个金融分析 Agent 定义
│   └── skills/                        # 金融分析工作流 Skill
└── .omo/                              # OpenCode 工作文件（已 gitignored）
```

## MCP 服务器说明

| 服务器 | 路径 | 说明 |
|--------|------|------|
| **fin-agent-mcp-server** | `src/mcp-server` | 核心金融分析 MCP，聚合多源数据，提供技术分析、记忆层、逻辑一致性引擎 |
| **fred-mcp-server** | `src/mcp-servers/fred` | 美联储经济数据，访问 800,000+ 经济时序序列 |
| **ashare-mcp-server** | `src/mcp-servers/ashare` | A 股数据，使用 akshare 提供行情、技术面、基本面数据 |
| **risk-mcp-server** | `src/mcp-servers/risk` | 本地风控计算，仓位管理，机构持仓分析 |
| **sec-edgar-mcp** | `src/mcp-servers/sec-edgar` | SEC EDGAR 财报查询 |

## 环境变量配置

在项目根目录创建 `.env` 文件：

```env
# FRED API (美联储经济数据)
FRED_API_KEY=your_fred_api_key

# Finnhub (新闻情绪)
FINNHUB_API_KEY=your_finnhub_api_key

# OpenAI API (用于 LLM 分析)
OPENAI_API_KEY=your_openai_api_key
```

## 技术栈

| 技术 | 说明 |
|------|------|
| **Node.js / TypeScript** | 核心 Agent、FRED MCP、WebUI 后端 |
| **Python** | A 股、风控、SEC EDGAR MCP 服务器 |
| **React / Vite** | WebUI 前端 |
| **SQLite (better-sqlite3)** | 本地记忆存储 |
| **MCP SDK** | Model Context Protocol 实现 |
| **akshare** | A 股数据源 |
| **yfinance** | 金融数据下载 |
| **edgartools** | SEC EDGAR 解析 |

## 许可证

AGPL-3.0
