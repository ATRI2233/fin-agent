/**
 * 后端 API 路由契约 — 与 src/main/api/v1/*.py 保持同步。
 * 前端所有 API 调用的 URL 必须从此文件引用,禁止手写字符串。
 *
 * 后端路由注册点: src/main/api/app.py:106-110
 */
export const ROUTES = {
  agents: {
    list:  "/api/v1/agents",
    get:   (name: string) => `/api/v1/agents/${encodeURIComponent(name)}`,
  },
  conversations: {
    list:     "/api/v1/conversations",
    create:   "/api/v1/conversations",
    get:      (id: string) => `/api/v1/conversations/${encodeURIComponent(id)}`,
    messages: (id: string) => `/api/v1/conversations/${encodeURIComponent(id)}/messages`,
  },
  executions: {
    list:  "/api/v1/executions",
    get:   (id: string) => `/api/v1/executions/${encodeURIComponent(id)}`,
    abort: (id: string) => `/api/v1/executions/${encodeURIComponent(id)}/abort`,
    retry: (execId: string, nodeId: string) =>
      `/api/v1/executions/${encodeURIComponent(execId)}/nodes/${encodeURIComponent(nodeId)}/retry`,
  },
  mcp: {
    tools:         "/api/v1/mcp/tools",
    servers:       "/api/v1/mcp/servers",
    allowedTools:  (name: string) => `/api/v1/mcp/agents/${encodeURIComponent(name)}/allowed-tools`,
  },
  workflows: {
    list:    "/api/v1/workflows",
    create:  "/api/v1/workflows",
    get:     (id: string) => `/api/v1/workflows/${encodeURIComponent(id)}`,
    update:  (id: string) => `/api/v1/workflows/${encodeURIComponent(id)}`,
    delete:  (id: string) => `/api/v1/workflows/${encodeURIComponent(id)}`,
    trigger: (id: string) => `/api/v1/workflows/${encodeURIComponent(id)}/trigger`,
  },
  system: {
    dbHealth: "/system/db_health",
  },
} as const;