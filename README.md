# Fin-Agent - 金融分析 Agent 系统

基于 OpenCode 的多 Agent 金融分析系统，集成 10 个专业分析 Agent 和 7 个 MCP Server，支持 A 股和美股的全维度分析。

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│ WebUI (React + Ant Design) │
│ Dashboard │ 信息中心 │ Chat │ Workflows │ Configuration │
├─────────────────────────────────────────────────────────────┤
│ Python Framework (FastAPI) │
│ ┌───────────┐ ┌──────────────┐ ┌────────────────────────┐ │
│ │ API Layer │ │ DI Container │ │ AgentDispatcher │ │
│ │ 12 routers│ │ (Protocol) │ │ (统一调度) │ │
│ └───────────┘ └──────────────┘ └────────────────────────┘ │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│ │WorkflowEngine│ │ Scheduler │ │ DataMaintenance │ │
│ │ (DAG 编排) │ │ (Cron 定时) │ │ (后台数据维护) │ │
│ └──────────────┘ └──────────────┘ └──────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ MCP Servers │
│ ASHARE │ FIN-AGENT │ FRED │ SEC-EDGAR │ RISK │ CN-MACRO │ LIB │
├─────────────────────────────────────────────────────────────┤
│ Agent 矩阵 (tools 白名单隔离) │
│ Macro-Scout │ Technical │ Fundamental │ Sentiment │ ... │
└─────────────────────────────────────────────────────────────┘
```

## Agent 矩阵

| Agent | 职责 | 维度 |
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

每个 Agent 通过 WebUI 配置独立的 **tools 白名单**，运行时只能看到自己被授权的工具，减少提示词占用。

## MCP Server 工具集

| Server | 语言 | 工具数 | 数据源 |
|--------|------|--------|--------|
| **ashare-mcp-server** | Python | 10 | AKShare (A 股行情/技术/基本面/资金) |
| **fin-agent-mcp-server** | Node.js | 13 | FinVul (美股全维度) |
| **fred-mcp-server** | Node.js | 3 | FRED (美联储宏观数据) |
| **sec-edgar-mcp** | Python | 5 | SEC-EDGAR (美股财报) |
| **risk-mcp-server** | Python | 3 | 本地风控计算 |
| **cn-macro-mcp-server** | Python | 7 | 中国宏观数据 (信用/利率/PMI/通胀) |
| **lib-mcp-server** | Node.js | 10 | 记忆/一致性/信号融合/魔鬼代言人 |

## 核心功能

### 工作流编排
- **可视化 DAG 编辑器** — 拖拽式工作流设计
- **串行/并行执行** — 拓扑排序 + 并行分支自动识别
- **Session 链式复用** — 串行节点共享会话，减少资源开销
- **Debate 节点** — 多 Agent 辩论 + Judge 裁决
- **Cron 定时调度** — APScheduler 集成

### 后台数据维护
- **独立数据库** — `maintenance.db` 与业务数据分离
- **定时采集** — 配置 Agent + Prompt + Cron 自动获取数据
- **信息中心** — 前端实时查看维护数据
- **维护设置** — 开关、触发方式、Agent 配置

### 系统可观测性
- **Session 管理 API** — 查看/清理 HAPI 会话
- **Execution 查询 API** — 执行记录列表、时间线、重试
- **Agent 调度 API** — 同步/并行直接调用 Agent

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
# Windows (CMD)
start.bat

# Windows (PowerShell)
.\start.ps1

# Linux / macOS
bash config/start.sh

# 或直接运行
cd main && python -m framework.main
```

### 4. 访问 WebUI

启动后访问 http://localhost:3120

## 目录结构

```
fin-agent/
├── main/
│ ├── framework/ # 核心框架
│ │ ├── api/ # API 路由 (12 个模块)
│ │ │ ├── agents.py # Agent 管理
│ │ │ ├── conversations.py# 对话系统
│ │ │ ├── dispatch.py # Agent 直接调度
│ │ │ ├── executions.py # 执行查询/重试
│ │ │ ├── sessions.py # Session 管理
│ │ │ ├── triggers.py # 工作流触发
│ │ │ └── ...
│ │ ├── core/ # 核心逻辑
│ │ │ ├── protocols.py # Protocol 抽象接口
│ │ │ ├── container.py # DI 容器
│ │ │ ├── agent_dispatcher.py # 统一调度器
│ │ │ ├── workflow_engine.py # DAG 执行引擎
│ │ │ ├── scheduler.py # Cron 调度器
│ │ │ └── hapi_bridge.py # HAPI Hub 客户端
│ │ ├── models/ # SQLAlchemy ORM
│ │ └── repositories/ # 数据访问层
├── webui/ # 前端 (React + Vite)
│ └── src/pages/
│ ├── Dashboard.tsx # 系统仪表盘
│ ├── InfoPage.tsx # 信息中心 (数据展示)
│ ├── ChatPage.tsx # 对话界面
│ ├── WorkflowEditor.tsx # 工作流 DAG 编辑器
│ └── ...
├── agents/
│ ├── mcp/ # MCP Server 实现
│ │ ├── core/ # 核心金融分析 (Node.js)
│ │ ├── ashare/ # A 股数据 (Python)
│ │ ├── fred/ # 宏观数据 (Node.js)
│ │ ├── risk/ # 风控计算 (Python)
│ │ └── cn-macro/ # 中国宏观 (Python)
│ └── lib/ # 共享工具库 (Node.js)
├── .opencode/
│ ├── opencode.json # 主配置 (Agent/MCP/Tools)
│ └── agents/ # Agent 系统提示词
├── data/
│ ├── finagent.db # 业务数据库
│ └── maintenance.db # 维护数据库
└── start.bat # 启动脚本
```

## 技术栈

- **后端**: Python 3.11+, FastAPI, SQLAlchemy, APScheduler
- **前端**: React 18, TypeScript, Vite, Ant Design, ReactFlow
- **Agent 框架**: OpenCode + HAPI Hub
- **MCP Servers**: Node.js (TypeScript), Python
- **数据源**: AKShare, FinVul, FRED, SEC-EDGAR, 中国宏观数据

## License

MIT
