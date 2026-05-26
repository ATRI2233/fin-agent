# 金融分析 MCP 服务器生态

基于 Agent + 多数据源 MCP 架构的金融分析系统，聚合美联储经济数据 (FRED)、A股市场数据、SEC 财报、风险控制等多源数据，提供 18+ 金融分析工具。

## 目录结构

```
financial_stock/
├── fin-agent/                          # 核心金融 Agent 项目
│   ├── mcp-server/                     # 核心金融分析 MCP 服务器
│   │   ├── src/
│   │   │   ├── index.ts               # 服务入口
│   │   │   ├── mcp/                   # MCP 协议实现
│   │   │   └── tools/                 # 金融分析工具集
│   │   ├── dist/                      # 编译输出
│   │   └── package.json               # 18+ 金融分析工具
│   ├── mcp-servers/                   # MCP 服务器集合
│   │   ├── fred/                      # 美联储经济数据 (FRED)
│   │   │   └── package.json           # 800,000+ 经济时序数据
│   │   ├── ashare/                    # A 股市场数据
│   │   │   └── ashare_mcp_server.py   # akshare 数据源
│   │   ├── risk/                      # 风控计算服务
│   │   │   └── risk_mcp_server.py     # 仓位管理 + 机构持仓
│   │   └── sec-edgar/                 # SEC 财报查询
│   │       └── docs/                  # 安装文档
│   ├── scripts/
│   │   └── install.bat                # Windows 安装脚本
│   └── skill/                         # Agent 技能模块
│       └── dist/                      # 编译后的技能引擎
├── mcp_servers/                       # MCP 服务器独立包
│   ├── fred-mcp-server/               # FRED MCP (TypeScript)
│   ├── ashare-mcp/                    # A 股 MCP (Python)
│   ├── risk-mcp/                      # 风控 MCP (Python)
│   ├── sec-edgar-mcp/                # SEC EDGAR MCP (Python)
│   └── package.json
└── download/                          # 分发包目录
```

## MCP 服务器说明

| 服务器 | 路径 | 说明 |
|--------|------|------|
| **fin-agent-mcp-server** | `fin-agent/mcp-server` | 核心金融分析 MCP，聚合多源数据，提供技术分析、记忆层、逻辑一致性引擎 |
| **fred-mcp-server** | `fin-agent/mcp-servers/fred` | 美联储经济数据，访问 800,000+ 经济时序序列，支持搜索、浏览、数据获取 |
| **ashare-mcp-server** | `fin-agent/mcp-servers/ashare` | A 股数据，使用 akshare 提供行情、技术面、基本面、新闻数据 |
| **risk-mcp-server** | `fin-agent/mcp-servers/risk` | 本地风控计算，仓位管理，机构持仓分析 |
| **sec-edgar-mcp** | `fin-agent/mcp-servers/sec-edgar` | SEC EDGAR 财报查询，公司Filing和财务数据结构化获取 |

## 安装方式

### Windows

```bash
cd fin-agent/scripts
install.bat
```

### Linux / macOS

```bash
cd fin-agent/scripts
bash install.sh
```

安装脚本会自动安装所有 MCP 服务器的依赖。

## 环境变量配置

在项目根目录或 `fin-agent/` 目录创建 `.env` 文件：

```env
# FRED API (美联储经济数据)
FRED_API_KEY=your_fred_api_key

# OpenAI API (用于 LLM 分析)
OPENAI_API_KEY=your_openai_api_key

# 数据库路径 (可选)
DATABASE_PATH=./data/financial.db
```

## 技术栈

| 技术 | 说明 |
|------|------|
| **Node.js / TypeScript** | 核心 Agent 和 FRED MCP 服务器 |
| **Python** | A 股、风控、SEC EDGAR MCP 服务器 |
| **SQLite** | 本地数据存储 |
| **MCP SDK** | Model Context Protocol 实现 |
| **akshare** | A 股数据源 |
| **yfinance** | 金融数据下载 |
| **edgartools** | SEC EDGAR 解析 |

## 许可证

AGPL-3.0