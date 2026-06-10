# Fin-Agent 项目规范

## 项目概览

金融分析多 Agent 系统，基于 OpenCode CLI 子进程模式执行 Agent。

## 目录结构

```
project/
├── main/                          # Python 后端
│   ├── framework/
│   │   ├── api/                   # 12 个路由模块 (FastAPI)
│   │   ├── controllers/           # 控制器层
│   │   ├── core/                  # 核心：容器、调度器、工作流引擎
│   │   │   └── workflow/          # DAG 引擎 + 节点执行器
│   │   ├── models/                # ORM (5张表: agents/workflows/executions/conversations/messages)
│   │   ├── repositories/          # 数据访问层
│   │   ├── schemas/               # Pydantic 模式
│   │   └── services/              # 业务逻辑层
│   ├── data_maintenance/          # 数据维护模块 (独立 SQLite)
│   └── session/                   # OpenCodeBackend + ProcessPool
├── agents/
│   ├── mcp/                       # 7 个 MCP Server (51 个工具)
│   │   ├── ashare/                # A股 (10 工具)
│   │   ├── core/                  # 核心金融 (13 工具)
│   │   ├── fred/                  # 美联储宏观 (3 工具)
│   │   ├── risk/                  # 风控 (3 工具)
│   │   ├── cn-macro/              # 中国宏观 (7 工具)
│   │   └── sec-edgar/             # 美股财报 (5 工具)
│   ├── lib/                       # 共享逻辑 (10 工具: 记忆/信号融合)
│   └── opencode/                  # OpenCode CLI
├── webui/                         # React 前端
│   ├── src/pages/                 # 19 个页面
│   ├── src/components/            # 通用组件 (React Flow 工作流画布)
│   └── server/                    # Express API 服务
├── start.ps1                      # 一键启动脚本
└── requirements.txt
```

## 技术栈

- **后端**: Python 3.11+, FastAPI, SQLAlchemy, APScheduler
- **前端**: React 18, TypeScript, Ant Design, @xyflow/react (React Flow), Vite
- **Agent**: OpenCode CLI 子进程模式
- **数据库**: SQLite (`data/finagent.db` + `data/maintenance.db`)

## 启动方式

```powershell
cd project
.\start.ps1
# FastAPI: localhost:8000
# WebUI Server: localhost:9876
# WebUI Frontend: localhost:5173
```

## 核心模块

| 功能 | 文件 |
|------|------|
| DI 容器 | `project/main/framework/core/container.py` |
| Agent 调度 | `project/main/framework/core/agent_dispatcher.py` |
| DAG 工作流 | `project/main/framework/core/workflow_engine.py` |
| 定时调度 | `project/main/framework/core/scheduler.py` |
| Agent 后端 | `project/main/session/opencode_backend.py` |

## 开发约定

- API 路由 → controllers → services → repositories 分层
- 工作流节点上限 50，拓扑排序执行
- Agent 工具白名单在 `project/.opencode/opencode.json` 配置
- 前端页面自治状态管理，无集中式 store
