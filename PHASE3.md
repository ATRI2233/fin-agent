# Phase 3：前端架构建设与全量验收

> 目标：建立前端分层架构、统一 API 调用和状态管理、全量验证收尾
> 预计周期：3 周（原蓝图阶段 4 + 阶段 5）
> 前置条件：Phase 2 全部完成

---

## 一、前端 API 客户端层（第 7 周前半）

### 1.1 创建 config/ 配置层

| 文件 | 职责 |
|------|------|
| `config/api.ts` | API 基础配置（baseURL、timeout） |
| `config/endpoints.ts` | 所有 API 端点常量 |
| `config/theme.ts` | 主题配置（色值、字体、圆角） |
| `config/constants.ts` | 业务常量 |

### 1.2 创建 Axios 统一客户端

```typescript
// api/client.ts
import axios, { AxiosInstance, AxiosError } from 'axios';
import { API_BASE_URL, API_TIMEOUT } from '../config/api';

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: { 'Content-Type': 'application/json' },
});

// 请求拦截器
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('api_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// 响应拦截器
apiClient.interceptors.response.use(
  (response) => response.data,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // 处理认证失败
    }
    return Promise.reject(error);
  }
);

export default apiClient;
```

```typescript
// api/conversations.ts
import apiClient from './client';
import { ENDPOINTS } from '../config/endpoints';
import type { Conversation, Message, CreateConversationRequest } from '../types/models';

export const conversationApi = {
  list: () => apiClient.get<Conversation[]>(ENDPOINTS.CONVERSATIONS.LIST),

  get: (id: string) => apiClient.get<Conversation>(ENDPOINTS.CONVERSATIONS.GET(id)),

  create: (data: CreateConversationRequest) =>
    apiClient.post<Conversation>(ENDPOINTS.CONVERSATIONS.CREATE, data),

  sendMessage: (id: string, content: string) =>
    apiClient.post(ENDPOINTS.CONVERSATIONS.SEND_MESSAGE(id), { content }),
};
```

### 1.3 创建领域 API 模块

| 文件 | 覆盖端点 |
|------|----------|
| `api/conversations.ts` | 对话 CRUD、消息发送 |
| `api/workflows.ts` | 工作流 CRUD、触发、调度 |
| `api/agents.ts` | Agent 列表、详情、统计 |
| `api/executions.ts` | 执行记录查询、重试 |
| `api/sessions.ts` | Session 管理 |
| `api/tools.ts` | 工具列表 |
| `api/maintenance.ts` | 数据维护 |

### 1.4 创建 TypeScript 类型定义

| 文件 | 内容 |
|------|------|
| `types/api.ts` | API 请求/响应类型 |
| `types/models.ts` | 业务模型类型 |
| `types/common.ts` | 通用类型 |

---

## 二、前端状态管理与 Hooks（第 7 周后半）

### 2.1 创建 Zustand Store

| Store | 管理状态 |
|-------|----------|
| `conversationStore.ts` | 对话列表、当前对话、消息列表 |
| `workflowStore.ts` | 工作流列表、当前工作流、执行状态 |
| `agentStore.ts` | Agent 列表、配置、统计 |
| `systemStore.ts` | 系统状态、连接状态 |

#### Zustand Store 完整示例

```typescript
// store/conversationStore.ts
import { create } from 'zustand';
import { conversationApi } from '../api/conversations';
import type { Conversation, Message } from '../types/models';

interface ConversationState {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchConversations: () => Promise<void>;
  setCurrentConversation: (id: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  clearError: () => void;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  currentConversation: null,
  messages: [],
  loading: false,
  error: null,

  fetchConversations: async () => {
    set({ loading: true, error: null });
    try {
      const conversations = await conversationApi.list();
      set({ conversations, loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  setCurrentConversation: async (id: string) => {
    set({ loading: true });
    try {
      const conversation = await conversationApi.get(id);
      const messages = await conversationApi.getMessages(id);
      set({ currentConversation: conversation, messages, loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  sendMessage: async (content: string) => {
    const { currentConversation } = get();
    if (!currentConversation) return;
    try {
      await conversationApi.sendMessage(currentConversation.id, content);
      const messages = await conversationApi.getMessages(currentConversation.id);
      set({ messages });
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  clearError: () => set({ error: null }),
}));
```

### 2.2 创建自定义 Hooks

| Hook | 职责 |
|------|------|
| `useConversation.ts` | 对话业务逻辑（列表、当前、消息） |
| `useWorkflow.ts` | 工作流业务逻辑（CRUD、执行） |
| `useAgent.ts` | Agent 业务逻辑（列表、配置） |
| `usePolling.ts` | 通用轮询逻辑（执行状态、消息更新） |

#### Hooks 完整示例

```typescript
// hooks/useConversation.ts
import { useEffect } from 'react';
import { useConversationStore } from '../store/conversationStore';

export function useConversation(conversationId?: string) {
  const store = useConversationStore();

  useEffect(() => {
    store.fetchConversations();
  }, []);

  useEffect(() => {
    if (conversationId) {
      store.setCurrentConversation(conversationId);
    }
  }, [conversationId]);

  return {
    conversations: store.conversations,
    current: store.currentConversation,
    messages: store.messages,
    loading: store.loading,
    error: store.error,
    sendMessage: store.sendMessage,
    clearError: store.clearError,
  };
}
```

---

## 三、前端页面重构（第 8 周）

### 3.1 拆分 ChatPage（833 行 → ≤ 200 行）

| 提取内容 | 目标文件 |
|----------|----------|
| 消息气泡组件 | `components/chat/MessageBubble.tsx` |
| 输入框组件 | `components/chat/ChatInput.tsx` |
| 对话列表组件 | `components/chat/ConversationList.tsx` |
| 对话业务逻辑 | `hooks/useConversation.ts` |

**精简后**：

```tsx
// pages/ChatPage.tsx — 精简后
export function ChatPage() {
  const { id } = useParams();
  const { conversations, current, messages, sendMessage } = useConversation(id);

  return (
    <div className="chat-page">
      <ConversationList conversations={conversations} activeId={id} />
      <ChatArea conversation={current} messages={messages} onSend={sendMessage} />
    </div>
  );
}
```

### 3.2 拆分 WorkflowEditor（1563 行 → ≤ 300 行）

| 提取内容 | 目标文件 |
|----------|----------|
| 画布组件 | `components/workflow/WorkflowCanvas.tsx` |
| Agent 节点 | `components/workflow/nodes/AgentNode.tsx` |
| Debate 节点 | `components/workflow/nodes/DebateNode.tsx` |
| IO 节点 | `components/workflow/nodes/InputOutputNode.tsx` |
| 会话边界选择器 | `components/workflow/SessionBoundarySelector.tsx` |
| 工作流列表页 | `pages/workflow/WorkflowList.tsx` |
| 执行时间线 | `pages/workflow/ExecutionTimeline.tsx` |
| 节点数据面板 | `pages/workflow/NodeDataPanel.tsx` |
| 工作流业务逻辑 | `hooks/useWorkflow.ts` |

### 3.3 拆分 AgentsPage（941 行 → ≤ 200 行）

| 提取内容 | 目标文件 |
|----------|----------|
| Agent 列表 | `pages/agents/AgentsPage.tsx`（精简） |
| 框架配置 | `pages/agents/FrameworkPage.tsx` |
| Agent 详情 | `pages/agents/FrameworkAgentDetail.tsx` |
| Agent 业务逻辑 | `hooks/useAgent.ts` |

### 3.4 消除 AppLayout 内联样式

**现状**：`App.tsx` (460行) 中大量内联 `style` 对象。

**方案**：
- 抽取至 `styles/theme.css` CSS 变量
- 布局组件拆分：`AppLayout.tsx` / `Sidebar.tsx` / `Header.tsx`
- 所有色值、间距、字体通过 CSS 变量引用

### 3.5 前端目标目录结构

> 规则：每个子文件夹内最多 7 个代码文件（不含 `index.ts`）

```
webui/src/
├── config/                              # 配置层（4 文件）✅
│   ├── api.ts                           # API 基础配置（baseURL、超时）
│   ├── endpoints.ts                     # 所有 API 端点常量
│   ├── theme.ts                         # 主题配置
│   └── constants.ts                     # 业务常量
│
├── api/                                 # API 客户端层（按领域分组）
│   ├── client.ts                        # Axios 实例 + 拦截器
│   ├── conversations.ts                 # 对话 API
│   ├── workflows.ts                     # 工作流 API
│   ├── agents.ts                        # Agent API
│   └── maintenance.ts                   # 数据维护 API
│
├── store/                               # 全局状态（Zustand）
│   ├── conversationStore.ts
│   ├── workflowStore.ts
│   ├── agentStore.ts
│   └── systemStore.ts
│
├── hooks/                               # 自定义 Hooks
│   ├── useConversation.ts
│   ├── useWorkflow.ts
│   ├── useAgent.ts
│   └── usePolling.ts
│
├── types/                               # TypeScript 类型
│   ├── api.ts                           # API 请求/响应类型
│   ├── models.ts                        # 业务模型类型
│   └── common.ts                        # 通用类型
│
├── components/                          # UI 组件（按领域分组）
│   ├── common/                          # 通用基础组件（3 文件）✅
│   │   ├── PageHeader.tsx
│   │   ├── StatusBadge.tsx
│   │   └── LoadingSpinner.tsx
│   │
│   ├── layout/                          # 布局组件（3 文件）✅
│   │   ├── AppLayout.tsx
│   │   ├── Sidebar.tsx
│   │   └── Header.tsx
│   │
│   ├── chat/                            # 对话组件（3 文件）✅
│   │   ├── MessageBubble.tsx
│   │   ├── ChatInput.tsx
│   │   └── ConversationList.tsx
│   │
│   └── workflow/                        # 工作流组件（5 文件）✅
│       ├── WorkflowCanvas.tsx
│       ├── SessionBoundarySelector.tsx
│       └── nodes/
│           ├── AgentNode.tsx
│           ├── DebateNode.tsx
│           └── InputOutputNode.tsx      # InputNode + OutputNode 合并
│
├── pages/                               # 页面（按领域分组）
│   ├── dashboard/                       # 仪表盘（1 文件）
│   │   └── Dashboard.tsx
│   │
│   ├── chat/                            # 对话（2 文件）✅
│   │   ├── ChatPage.tsx
│   │   └── SessionsPage.tsx
│   │
│   ├── workflow/                        # 工作流（6 文件）✅
│   │   ├── WorkflowList.tsx
│   │   ├── WorkflowEditor.tsx
│   │   ├── WorkflowMonitor.tsx
│   │   ├── WorkflowSettings.tsx
│   │   ├── ExecutionTimeline.tsx
│   │   └── NodeDataPanel.tsx
│   │
│   ├── agents/                          # Agent 管理（3 文件）✅
│   │   ├── AgentsPage.tsx
│   │   ├── FrameworkPage.tsx
│   │   └── FrameworkAgentDetail.tsx
│   │
│   ├── config/                          # 配置管理（3 文件）✅
│   │   ├── ConfigRawEditor.tsx
│   │   ├── RulesEditor.tsx
│   │   └── PermissionsPage.tsx
│   │
│   ├── resources/                       # 资源管理（4 文件）✅
│   │   ├── ToolsPage.tsx
│   │   ├── SkillsPage.tsx
│   │   ├── MCPServersPage.tsx
│   │   └── ProvidersPage.tsx
│   │
│   └── info/                            # 信息中心（2 文件）✅
│       ├── InfoPage.tsx
│       └── InfoSettingsPage.tsx
│
├── styles/                              # 样式
│   ├── theme.css                        # CSS 变量主题
│   └── global.css                       # 全局样式
│
├── App.tsx                              # 路由定义
└── main.tsx                             # 入口
```

### 3.6 MCP Server 目标结构

```
agents/
├── lib/                                 # 共享逻辑库
│   ├── index.ts                         # 入口
│   ├── types.ts                         # 类型定义
│   ├── dataHub.ts                       # 数据中枢
│   │
│   ├── memory/                          # 记忆与学习（3 文件）✅
│   │   ├── memoryTools.ts
│   │   ├── memoryLearner.ts
│   │   └── experienceSummary.ts
│   │
│   └── analysis/                        # 分析工具（3 文件）✅
│       ├── conflictResolver.ts
│       ├── consistencyCheck.ts
│       └── devilAdvocate.ts
│
├── mcp/
│   ├── core/                            # 核心 MCP Server
│   │   └── src/
│   │       ├── index.ts                 # 入口
│   │       ├── types.ts                 # 类型
│   │       │
│   │       ├── mcp/                     # MCP 客户端（2 文件）✅
│   │       │   ├── mcpClientManager.ts
│   │       │   └── proxy.ts
│   │       │
│   │       ├── memory/                  # 记忆存储（1 文件）
│   │       │   └── memoryStore.ts
│   │       │
│   │       └── tools/                   # 工具定义（已分组）✅
│   │           ├── fundamental/ (4)
│   │           ├── fusion/ (1)
│   │           ├── market/ (3)
│   │           ├── risk/ (1)
│   │           ├── sentiment/ (3)
│   │           └── technical/ (2)
│   │
│   ├── ashare/                          # A 股（1 文件）
│   ├── cn-macro/                        # 中国宏观（1 文件）
│   ├── fred/                            # FRED（1 文件）
│   ├── risk/                            # 风控（1 文件）
│   └── sec-edgar/                       # SEC（1 文件）
│
├── opencode/                            # OpenCode 配置
└── hapi-hub/                            # HAPI Hub（遗留）
```

### 3.7 目录合规性验证

| 目录 | 文件数 | 状态 |
|------|--------|------|
| `config/` | 4 | ✅ |
| `api/` | 5 | ✅ |
| `store/` | 4 | ✅ |
| `hooks/` | 4 | ✅ |
| `types/` | 3 | ✅ |
| `components/common/` | 3 | ✅ |
| `components/layout/` | 3 | ✅ |
| `components/chat/` | 3 | ✅ |
| `components/workflow/` | 5 | ✅ |
| `pages/dashboard/` | 1 | ✅ |
| `pages/chat/` | 2 | ✅ |
| `pages/workflow/` | 6 | ✅ |
| `pages/agents/` | 3 | ✅ |
| `pages/config/` | 3 | ✅ |
| `pages/resources/` | 4 | ✅ |
| `pages/info/` | 2 | ✅ |
| `lib/memory/` | 3 | ✅ |
| `lib/analysis/` | 3 | ✅ |
| `src/mcp/` | 2 | ✅ |

**所有目录均 ≤ 7 个代码文件。**

---

## 四、全量验证与收尾（第 9 周）

### 4.1 代码质量检查

| 检查项 | 工具 | 验收标准 |
|--------|------|----------|
| Python 代码规范 | `ruff check` | 0 error |
| TS/TSX 代码规范 | `npx eslint` | 0 error |
| 分层依赖违规 | `python scripts/check_dependencies.py` | 0 violation |
| 文件行数超限 | `python scripts/check_lines.py` | 所有文件 ≤ 500 行 |
| 直接 fetch 调用 | ESLint `no-restricted-syntax` | 0 处 |
| 硬编码 API 地址 | ESLint `no-restricted-imports` | 0 处 |

### 4.2 功能验证

| 测试范围 | 测试类型 | 数量目标 |
|----------|----------|----------|
| 后端 API 端点 | 集成测试 | 15+ |
| Service 层逻辑 | 单元测试 | 50+ |
| Repository 层 | 单元测试 | 30+ |
| 前端核心流程 | E2E 测试 | 5-10 |
| 工作流完整流程 | 端到端测试 | 3+ |

### 4.3 文档更新

| 文档 | 更新内容 |
|------|----------|
| `README.md` | 反映新架构、更新目录结构 |
| `ARCHITECTURE.md` | 新建，描述分层架构和设计决策 |
| `CHANGELOG.md` | 记录重构变更 |

---

## 五、Phase 3 验收清单

### 前端 API 层

- [ ] `api/client.ts` Axios 实例创建完成
- [ ] 7 个领域 API 模块全部实现
- [ ] `config/` 配置层创建完成（4 文件）
- [ ] `types/` 类型定义创建完成（3 文件）

### 前端状态管理

- [ ] 4 个 Zustand Store 全部实现
- [ ] 4 个自定义 Hooks 全部实现
- [ ] Store 通过 Hooks 暴露给组件

### 页面重构

- [ ] `ChatPage.tsx` ≤ 200 行（从 833 行）
- [ ] `WorkflowEditor.tsx` ≤ 300 行（从 1563 行）
- [ ] `AgentsPage.tsx` ≤ 200 行（从 941 行）
- [ ] `App.tsx` 消除内联样式
- [ ] 所有页面无直接 `fetch()` 调用
- [ ] 所有页面无硬编码 API 地址

### 全量验收

- [ ] `ruff check` — 0 error
- [ ] `npx eslint` — 0 error
- [ ] `scripts/check_dependencies.py` — 0 violation
- [ ] `scripts/check_lines.py` — 所有文件 ≤ 500 行
- [ ] 后端所有 API 端点正常响应
- [ ] 工作流创建、编辑、执行正常
- [ ] 对话功能正常（Agent 模式 + Workflow 模式）
- [ ] 定时任务正常
- [ ] 数据维护功能正常
- [ ] 前端所有页面正常渲染
- [ ] 前端核心流程可走通
- [ ] README.md 已更新
- [ ] ARCHITECTURE.md 已创建

---

## 六、重构前后对比预期

| 指标 | 重构前 | Phase 3 完成后 |
|------|--------|----------------|
| 最大文件行数 | 1563 行 (WorkflowEditor.tsx) | ≤ 500 行 |
| SessionLocal 调用次数 | 37 处 | 1 处（database.py 定义） |
| 全局 configure 函数 | 5 个 | 0 个 |
| Controller 文件平均行数 | 300+ 行 | ≤ 200 行 |
| 前端直接 fetch 调用 | 50+ 处 | 0 处 |
| 硬编码 API 地址 | 散落各处 | 集中在 config/endpoints.ts |
| 可单元测试的模块数 | ~30% | 100% Service/Repository |
| 测试用例总数 | 0 | 100+ |
