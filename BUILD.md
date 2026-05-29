# 构建部署包

从源码（`src/`）构建完整部署包的步骤说明。

## 构建产物

```
deploy/
├── server/              WebUI 后端 (tsc 编译产物)
├── public/              前端静态文件 (Vite build)
├── mcp-server/          核心 MCP 服务器 (tsc + node_modules)
├── mcp-servers/         MCP 服务器集合
│   ├── ashare/          Python 源码拷贝
│   ├── fred/            tsc 编译产物
│   ├── risk/            Python 源码拷贝
│   └── sec-edgar/       Python 源码拷贝
├── .opencode/           配置数据拷贝
├── .env                 环境变量模板
├── start.bat            Windows 启动脚本
└── start.sh             Linux 启动脚本
```

## 全量构建

```powershell
# 1. WebUI 后端编译
Push-Location src/webui/server
npm install --include=dev
npx tsc
Pop-Location

# 2. 前端构建
Push-Location src/webui
npm install --include=dev
npx vite build
Pop-Location

# 3. 核心 MCP 服务器编译
Push-Location src/mcp-server
npm install --include=dev
npx tsc
Pop-Location

# 4. Fred MCP 编译
Push-Location src/mcp-servers/fred
npm install --include=dev
npx tsc
Pop-Location

# 5. 拷贝到 deploy/
New-Item -ItemType Directory -Force deploy/server
Copy-Item -Recurse src/webui/server/dist deploy/server/dist
Copy-Item -Recurse src/webui/server/node_modules deploy/server/node_modules
Copy-Item src/webui/server/package.json deploy/server/

Copy-Item -Recurse src/webui/dist deploy/public

New-Item -ItemType Directory -Force deploy/mcp-server
Copy-Item -Recurse src/mcp-server/dist deploy/mcp-server/dist
Copy-Item -Recurse src/mcp-server/node_modules deploy/mcp-server/node_modules
Copy-Item src/mcp-server/package.json deploy/mcp-server/
Copy-Item src/mcp-server/.env.example deploy/mcp-server/.env

New-Item -ItemType Directory -Force deploy/mcp-servers
Copy-Item -Recurse src/mcp-servers/ashare deploy/mcp-servers/ashare
Copy-Item -Recurse src/mcp-servers/risk deploy/mcp-servers/risk
Copy-Item -Recurse src/mcp-servers/sec-edgar deploy/mcp-servers/sec-edgar
New-Item -ItemType Directory -Force deploy/mcp-servers/fred
Copy-Item -Recurse src/mcp-servers/fred/src deploy/mcp-servers/fred/src
Copy-Item -Recurse src/mcp-servers/fred/build deploy/mcp-servers/fred/build
Copy-Item -Recurse src/mcp-servers/fred/node_modules deploy/mcp-servers/fred/node_modules
Copy-Item src/mcp-servers/fred/package.json deploy/mcp-servers/fred/

Copy-Item -Recurse .opencode deploy/.opencode
```

## 组件速查

| 组件 | 源码 | 构建命令 |
|------|------|----------|
| WebUI 后端 | `src/webui/server/` | `npm install && npx tsc` |
| 前端静态 | `src/webui/` | `npm install && npx vite build` |
| 核心 MCP | `src/mcp-server/` | `npm install && npx tsc` |
| Fred MCP | `src/mcp-servers/fred/` | `npm install && npx tsc` |
| A 股 MCP | `src/mcp-servers/ashare/` | 纯 Python，拷贝即可 |
| 风控 MCP | `src/mcp-servers/risk/` | 纯 Python，拷贝即可 |
| SEC MCP | `src/mcp-servers/sec-edgar/` | 纯 Python，拷贝即可 |

## 注意

- `node_modules/`、`deploy/`、`*.zip` 已通过 `.gitignore` 排除，不会提交到版本控制
- 部署前需配置 `deploy/mcp-server/.env` 中的 API 密钥
- 首次启动时 `start.bat` 会自动处理 Python 依赖安装和原生模块编译
