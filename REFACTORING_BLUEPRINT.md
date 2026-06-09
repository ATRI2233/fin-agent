# fin-agent 重构执行蓝图

> 版本：v1.2
> 创建日期：2026-06-09
> 更新日期：2026-06-09（新增第四章：重构后完整目录结构）
> 基于：ARCHITECTURE_AUDIT.md 审计结论
> 目标：全面整改 God Object、全局状态滥用、DB 会话混乱、分层违规、前端无架构五大问题
> 约束：每个子文件夹内最多 7 个代码文件（不含 `__init__.py` / `index.ts`）

---

## 目录

- [一、架构规范总则](#一架构规范总则)
- [二、后端分层架构规范](#二后端分层架构规范)
- [三、前端分层架构规范](#三前端分层架构规范)
- [四、重构后完整目录结构](#四重构后完整目录结构)
- [五、全局状态与依赖治理](#五全局状态与依赖治理)
- [六、自动化防护工具配置](#六自动化防护工具配置)
- [七、重构前置条件（依赖图 + 并发方案 + 测试策略）](#七重构前置条件依赖图--并发方案--测试策略)
- [八、重构执行计划（7 阶段）](#八重构执行计划7-阶段)
- [九、验收标准与检查清单](#九验收标准与检查清单)

---

## 一、架构规范总则

### 1.1 单一职责原则

- 所有文件/模块行数 **不超过 500 行**（硬性上限）
- 单个文件仅承担 **一项核心职责**
- 严禁出现 God Object
- 禁止单一文件同时处理 CRUD、日志、缓存等多项职责

### 1.2 依赖倒置原则

- 高层模块依赖 **抽象接口** 而非低层模块
- 严禁 API 层直接操作数据库
- 所有数据操作必须通过 Service → Repository 中间层隔离

### 1.3 彻底消除硬编码

- API 地址 → `config/` 或 `.env`
- 阈值/常量 → `config/constants.py` / `config/constants.ts`
- 密钥 → `.env`（不入版本控制）
- 样式色值 → CSS 变量 / 主题配置文件
- 魔法数字与字符串 → 命名常量

### 1.4 明确模块边界

- 模块间仅通过定义好的接口通信
- 禁止直接访问其他模块内部全局变量、私有方法
- 跨模块调用必须通过依赖注入或事件总线

---

## 二、后端分层架构规范

### 2.1 四层架构定义

```
┌─────────────────────────────────────────────────────────┐
│  Controller 层 (API 路由)                                │
│  职责：请求参数校验、响应结果封装、HTTP 状态码处理        │
│  禁止：业务逻辑、数据库操作、状态管理                     │
├─────────────────────────────────────────────────────────┤
│  Service 层 (业务逻辑)                                   │
│
│  职责：核心业务逻辑、事务编排、跨服务协调                 │
│  依赖：Repository 接口（通过 DI 注入）                   │
│  禁止：直接操作数据库、直接使用 SessionLocal              │
├─────────────────────────────────────────────────────────┤
│  Repository 层 (数据访问)                                │
│  职责：封装数据库会话与 CRUD 操作、统一管理 DB 会话       │
│  实现：Repository 接口，返回 Model 对象                   │
│  禁止：业务逻辑判断                                      │
├─────────────────────────────────────────────────────────┤
│  Model 层 (数据模型)                                     │
│  职责：定义 ORM 模型、与数据表结构一一对应                │
│  禁止：业务逻辑、方法（除属性计算外）                     │
└─────────────────────────────────────────────────────────┘
```

### 2.2 目标目录结构

```
main/
├── config/
│   ├── __init__.py
│   ├── settings.py          # Settings(BaseSettings)，统一配置
│   ├── constants.py         # 业务常量（阈值、限制、默认值）
│   └── database.py          # 数据库引擎、SessionLocal、get_db
├── models/
│   ├── __init__.py
│   ├── agent.py             # Agent ORM 模型
│   ├── workflow.py          # Workflow ORM 模型
│   ├── execution.py         # WorkflowExecution + ExecutionNode ORM 模型
│   ├── conversation.py      # Conversation + Message ORM 模型
│   └── maintenance.py       # 数据维护相关 ORM 模型
├── repositories/
│   ├── __init__.py
│   ├── base.py              # BaseRepository[T] 泛型基类
│   ├── agent_repo.py        # AgentRepository
│   ├── workflow_repo.py     # WorkflowRepository
│   ├── execution_repo.py    # ExecutionRepository（扩展现有）
│   ├── conversation_repo.py # ConversationRepository
│   └── maintenance_repo.py  # MaintenanceRepository
├── services/
│   ├── __init__.py
│   ├── agent_service.py     # AgentService
│   ├── workflow_service.py  # WorkflowService
│   ├── execution_service.py # ExecutionService
│   ├── conversation_service.py # ConversationService（从 conversations.py 提取）
│   ├── scheduler_service.py # SchedulerService（从 scheduler.py 提取）
│   ├── debate_service.py    # DebateService（从 debate_executor.py 提取）
│   └── maintenance_service.py # MaintenanceService
├── controllers/
│   ├── __init__.py
│   ├── agents.py            # Agent 路由（精简为纯路由）
│   ├── workflows.py         # Workflow 路由
│   ├── executions.py        # Execution 路由
│   ├── conversations.py     # Conversation 路由（精简为纯路由）
│   ├── sessions.py          # Session 路由
│   ├── triggers.py          # Trigger 路由
│   ├── tools.py             # Tool 路由
│   ├── skills.py            # Skill 路由
│   ├── scheduler_routes.py  # Scheduler 路由
│   ├── system.py            # System 路由
│   ├── dispatch.py          # Dispatch 路由
│   └── data_maintenance.py  # 数据维护路由
├── core/
│   ├── __init__.py
│   ├── container.py         # DI 容器（InversifyJS 风格，Python 实现）
│   ├── protocols.py         # Protocol 抽象接口
│   ├── workflow_engine.py   # WorkflowEngine（精简，委托给 Strategy）
│   ├── node_executors/      # 节点执行策略（新增）
│   │   ├── __init__.py
│   │   ├── base.py          # NodeExecutor 抽象接口
│   │   ├── agent_executor.py
│   │   ├── debate_executor.py
│   │   ├── input_executor.py
│   │   └── output_executor.py
│   ├── workflow_parser.py   # DAG 验证（保持）
│   ├── retry_handler.py     # 重试与断路器（保持）
│   ├── performance.py       # 性能模块（保持）
│   └── exceptions.py        # 自定义异常（保持）
├── session/
│   ├── __init__.py
│   ├── opencode_backend.py  # OpenCodeBackend（保持）
│   ├── process_pool.py      # ProcessPool（保持，移除重复函数）
│   └── output_parser.py     # 输出解析（保持）
├── middleware/
│   ├── __init__.py
│   └── auth.py              # APIKeyMiddleware（从 core/auth.py 迁移）
├── main.py                  # FastAPI 应用入口（精简）
└── __init__.py
```

### 2.3 Controller 层规范

```python
# controllers/conversations.py — 示例
from fastapi import APIRouter, Depends, HTTPException
from ..services.conversation_service import ConversationService
from ..core.container import get_service
from ..schemas.conversation import (
    CreateConversationRequest,
    ConversationResponse,
    SendMessageRequest
)

router = APIRouter(prefix="/api/v1/conversations", tags=["conversations"])

@router.post("/", response_model=ConversationResponse)
async def create_conversation(
    request: CreateConversationRequest,
    service: ConversationService = Depends(get_service(ConversationService))
):
    """创建对话 — 仅做参数校验与响应封装"""
    return service.create(request)

@router.post("/{id}/messages")
async def send_message(
    id: str,
    request: SendMessageRequest,
    service: ConversationService = Depends(get_service(ConversationService))
):
    """发送消息 — 异步处理，返回任务 ID"""
    task_id = service.send_message(id, request)
    return {"task_id": task_id, "status": "processing"}
```

**规范要点：**
- 每个端点函数不超过 20 行
- 参数校验使用 Pydantic Schema
- 业务逻辑全部委托给 Service
- 异常统一由全局异常处理器捕获

### 2.4 Service 层规范

```python
# services/conversation_service.py — 示例
from ..repositories.conversation_repo import ConversationRepository
from ..repositories.execution_repo import ExecutionRepository
from ..core.protocols import AgentBackend
from ..core.workflow_engine import WorkflowEngine

class ConversationService:
    def __init__(
        self,
        conv_repo: ConversationRepository,
        exec_repo: ExecutionRepository,
        backend: AgentBackend,
        engine_factory: callable
    ):
        self._conv_repo = conv_repo
        self._exec_repo = exec_repo
        self._backend = backend
        self._engine_factory = engine_factory

    def create(self, request) -> ConversationResponse:
        """创建对话"""
        conversation = self._conv_repo.create(title=request.title)
        return ConversationResponse.from_model(conversation)

    def send_message(self, conv_id: str, request) -> str:
        """发送消息 — 根据模式分发"""
        conversation = self._conv_repo.get(conv_id)
        if request.mode == "agent":
            return self._send_agent_message(conversation, request)
        elif request.mode == "workflow":
            return self._execute_workflow(conversation, request)
```

**规范要点：**
- 通过构造函数注入所有依赖
- 不直接使用 `SessionLocal()`
- 不直接操作数据库模型
- 业务逻辑清晰、可测试

### 2.5 Repository 层规范

```python
# repositories/base.py — 泛型基类
from typing import TypeVar, Generic, Type, Optional, List
from sqlalchemy.orm import Session

T = TypeVar("T")

class BaseRepository(Generic[T]):
    def __init__(self, model: Type[T], db: Session):
        self._model = model
        self._db = db

    def get(self, id: str) -> Optional[T]:
        return self._db.query(self._model).filter(self._model.id == id).first()

    def list(self, **filters) -> List[T]:
        query = self._db.query(self._model)
        for key, value in filters.items():
            query = query.filter(getattr(self._model, key) == value)
        return query.all()

    def create(self, **kwargs) -> T:
        obj = self._model(**kwargs)
        self._db.add(obj)
        self._db.commit()
        self._db.refresh(obj)
        return obj

    def update(self, id: str, **kwargs) -> Optional[T]:
        obj = self.get(id)
        if obj:
            for key, value in kwargs.items():
                setattr(obj, key, value)
            self._db.commit()
            self._db.refresh(obj)
        return obj

    def delete(self, id: str) -> bool:
        obj = self.get(id)
        if obj:
            self._db.delete(obj)
            self._db.commit()
            return True
        return False
```

**规范要点：**
- 统一 DB 会话管理（通过 `get_db` 注入）
- 泛型基类减少重复代码
- 每个 Repository 专注一个聚合根
- 事务边界在 Repository 层控制

---

## 三、前端分层架构规范

### 3.1 分层架构定义

```
┌─────────────────────────────────────────────────────────┐
│  UI 组件层 (components/)                                │
│  职责：页面渲染、用户交互、样式                           │
│  禁止：业务逻辑、API 调用、状态管理逻辑                   │
├─────────────────────────────────────────────────────────┤
│  Hooks 层 (hooks/)                                      │
│  职责：封装业务逻辑、连接 UI 与 Store/API                 │
│  形式：自定义 React Hooks                                │
├─────────────────────────────────────────────────────────┤
│  Store 层 (store/)                                      │
│  职责：全局状态管理（Zustand）                            │
│  禁止：UI 渲染逻辑                                       │
├─────────────────────────────────────────────────────────┤
│  API 层 (api/)                                          │
│  职责：封装 Axios 实例、统一请求/响应处理                 │
│  禁止：业务逻辑                                          │
├─────────────────────────────────────────────────────────┤
│  Config 层 (config/)                                    │
│  职责：API 地址、主题配置、常量定义                       │
└─────────────────────────────────────────────────────────┘
```

### 3.2 目标目录结构

```
webui/src/
├── config/
│   ├── api.ts               # API 基础配置（baseURL、超时）
│   ├── endpoints.ts         # 所有 API 端点常量
│   ├── theme.ts             # 主题配置（色值、字体、圆角）
│   └── constants.ts         # 业务常量
├── api/
│   ├── client.ts            # Axios 实例 + 拦截器
│   ├── conversations.ts     # 对话 API 模块
│   ├── workflows.ts         # 工作流 API 模块
│   ├── agents.ts            # Agent API 模块
│   ├── executions.ts        # 执行 API 模块
│   ├── sessions.ts          # Session API 模块
│   ├── tools.ts             # 工具 API 模块
│   └── maintenance.ts       # 数据维护 API 模块
├── store/
│   ├── conversationStore.ts # 对话状态（Zustand）
│   ├── workflowStore.ts     # 工作流状态
│   ├── agentStore.ts        # Agent 状态
│   └── systemStore.ts       # 系统状态
├── hooks/
│   ├── useConversation.ts   # 对话业务逻辑 Hook
│   ├── useWorkflow.ts       # 工作流业务逻辑 Hook
│   ├── useAgent.ts          # Agent 业务逻辑 Hook
│   ├── usePolling.ts        # 轮询逻辑 Hook
│   └── useApi.ts            # 通用 API 调用 Hook
├── components/
│   ├── common/              # 通用基础组件
│   │   ├── PageHeader.tsx
│   │   ├── StatusBadge.tsx
│   │   └── LoadingSpinner.tsx
│   ├── workflow/            # 工作流相关组件
│   │   ├── WorkflowCanvas.tsx
│   │   ├── nodes/
│   │   └── edges/
│   ├── chat/                # 对话相关组件
│   │   ├── MessageBubble.tsx
│   │   ├── ChatInput.tsx
│   │   └── ConversationList.tsx
│   └── layout/              # 布局组件
│       ├── AppLayout.tsx
│       ├── Sidebar.tsx
│       └── Header.tsx
├── pages/
│   ├── Dashboard.tsx        # 精简为组合组件
│   ├── ChatPage.tsx         # 精简，逻辑移至 hooks
│   ├── WorkflowEditor.tsx   # 拆分为子组件
│   ├── AgentsPage.tsx       # 精简，逻辑移至 hooks
│   └── ...                  # 其他页面
├── styles/
│   ├── theme.css            # CSS 变量（保持）
│   ├── global.css           # 全局样式
│   └── components/          # 组件样式模块
├── types/
│   ├── api.ts               # API 请求/响应类型
│   ├── models.ts            # 业务模型类型
│   └── common.ts            # 通用类型
├── App.tsx                  # 路由定义（精简）
└── main.tsx                 # 入口
```

### 3.3 API 客户端层

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

### 3.4 Zustand Store 层

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
      // 刷新消息列表
      const messages = await conversationApi.getMessages(currentConversation.id);
      set({ messages });
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  clearError: () => set({ error: null }),
}));
```

### 3.5 自定义 Hooks 层

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

### 3.6 页面组件精简示例

```tsx
// pages/ChatPage.tsx — 精简后
import { useParams } from 'react-router-dom';
import { useConversation } from '../hooks/useConversation';
import { ConversationList } from '../components/chat/ConversationList';
import { ChatArea } from '../components/chat/ChatArea';
import { PageHeader } from '../components/common/PageHeader';

export function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const {
    conversations,
    current,
    messages,
    loading,
    error,
    sendMessage,
  } = useConversation(id);

  return (
    <div className="chat-page">
      <ConversationList
        conversations={conversations}
        activeId={id}
      />
      <ChatArea
        conversation={current}
        messages={messages}
        loading={loading}
        onSend={sendMessage}
      />
    </div>
  );
}
```

---

## 四、重构后完整目录结构

> 规则：每个子文件夹内最多 7 个代码文件（不含 `__init__.py` / `index.ts`）

### 4.1 后端 `main/` 目标结构

```
main/
├── config/                              # 配置层（3 文件）
│   ├── settings.py                      # Settings(BaseSettings)
│   ├── constants.py                     # 业务常量
│   └── database.py                      # 引擎、SessionLocal、get_db
│
├── models/                              # Model 层（5 文件）✅
│   ├── agent.py
│   ├── conversation.py
│   ├── workflow.py
│   ├── workflow_execution.py
│   └── database.py                      # Base、engine（与 config 合并或保留）
│
├── repositories/                        # Repository 层（待扩展）
│   ├── base.py                          # BaseRepository[T] 泛型基类
│   ├── agent_repo.py
│   ├── workflow_repo.py
│   ├── execution_repo.py
│   ├── conversation_repo.py
│   └── maintenance_repo.py
│
├── services/                            # Service 层（7 文件）✅
│   ├── agent_service.py
│   ├── conversation_service.py          # 从 conversations.py 提取
│   ├── workflow_service.py              # 从 workflows.py 提取
│   ├── execution_service.py             # 从 executions.py 提取
│   ├── scheduler_service.py             # 从 scheduler.py 提取
│   ├── debate_service.py                # 从 debate_executor.py 提取
│   └── maintenance_service.py
│
├── controllers/                         # Controller 层（按领域分组）
│   ├── conversations/                   # 对话域（3 文件）✅
│   │   ├── conversations.py             # 对话 CRUD + 消息发送
│   │   ├── sessions.py                  # Session 管理
│   │   └── dispatch.py                  # Agent 直接调度
│   │
│   ├── workflows/                       # 工作流域（4 文件）✅
│   │   ├── workflows.py                 # 工作流 CRUD
│   │   ├── triggers.py                  # 工作流触发
│   │   ├── executions.py                # 执行记录查询/重试
│   │   └── scheduler_routes.py          # 定时调度管理
│   │
│   ├── resources/                       # 资源域（3 文件）✅
│   │   ├── agents.py                    # Agent 列表/详情/统计
│   │   ├── tools.py                     # 工具列表
│   │   └── skills.py                    # 技能列表
│   │
│   └── system.py                        # 系统状态（独立）
│
├── core/                                # 核心引擎（按职责分组）
│   ├── agent/                           # Agent 调度域（3 文件）✅
│   │   ├── dispatcher.py                # AgentDispatcher
│   │   ├── registry.py                  # AgentRegistry
│   │   └── debate_executor.py           # DebateExecutor
│   │
│   ├── workflow/                         # 工作流引擎域（3 文件）✅
│   │   ├── engine.py                    # WorkflowEngine
│   │   ├── parser.py                    # DAG 解析
│   │   └── node_executors/              # 节点执行策略（4 文件）✅
│   │       ├── base.py                  # NodeExecutor 抽象接口
│   │       ├── agent_executor.py
│   │       ├── debate_executor.py
│   │       └── io_executor.py
│   │
│   ├── session/                         # Session 管理域（2 文件）✅
│   │   ├── cleanup.py                   # Session 清理
│   │   └── manager.py                   # Session 管理器
│   │
│   ├── infra/                           # 基础设施（4 文件）✅
│   │   ├── container.py                 # DI 容器
│   │   ├── protocols.py                 # Protocol 抽象接口
│   │   ├── auth.py                      # API Key 认证
│   │   └── exceptions.py                # 自定义异常
│   │
│   └── utils/                           # 工具模块（6 文件）✅
│       ├── logger.py                    # 日志配置
│       ├── log_collector.py             # 日志收集器
│       ├── input_merger.py              # 输入合并
│       ├── performance.py               # 性能限制器
│       ├── retry_handler.py             # 重试与断路器
│       └── scheduler.py                 # APScheduler 调度器
│
├── middleware/                          # 中间件（1 文件）
│   └── auth.py                          # APIKeyMiddleware
│
├── session/                             # OpenCode 执行层（3 文件）✅
│   ├── opencode_backend.py
│   ├── process_pool.py
│   └── output_parser.py
│
├── data_maintenance/                    # 数据维护子系统（3 文件）✅
│   ├── api/
│   │   └── data_maintenance.py
│   ├── core/
│   │   └── data_maintenance.py
│   └── models/
│       └── maintenance_db.py
│
└── main.py                              # FastAPI 入口
```

### 4.2 前端 `webui/src/` 目标结构

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

### 4.3 MCP Server `agents/` 目标结构

```
agents/
├── lib/                                 # 共享逻辑库
│   ├── index.ts                         # 入口（不计数）
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

### 4.4 目录合规性验证

| 目录 | 文件数 | 状态 |
|------|--------|------|
| `config/` | 3 | ✅ |
| `models/` | 5 | ✅ |
| `repositories/` | 6 | ✅ |
| `services/` | 7 | ✅ |
| `controllers/conversations/` | 3 | ✅ |
| `controllers/workflows/` | 4 | ✅ |
| `controllers/resources/` | 3 | ✅ |
| `core/agent/` | 3 | ✅ |
| `core/workflow/` | 3 | ✅ |
| `core/workflow/node_executors/` | 4 | ✅ |
| `core/session/` | 2 | ✅ |
| `core/infra/` | 4 | ✅ |
| `core/utils/` | 6 | ✅ |
| `session/` | 3 | ✅ |
| `api/` | 5 | ✅ |
| `store/` | 4 | ✅ |
| `hooks/` | 4 | ✅ |
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

## 五、全局状态与依赖治理

### 5.1 后端 DI 容器

```python
# core/container.py — 增强版
from typing import TypeVar, Type, Callable, Dict, Any
from functools import lru_cache

T = TypeVar("T")

class Container:
    """依赖注入容器 — 管理所有服务实例"""

    def __init__(self):
        self._services: Dict[Type, Any] = {}
        self._factories: Dict[Type, Callable] = {}
        self._singletons: Dict[Type, Any] = {}

    def register_singleton(self, interface: Type[T], implementation: T):
        """注册单例服务"""
        self._singletons[interface] = implementation

    def register_factory(self, interface: Type[T], factory: Callable[[], T]):
        """注册工厂函数"""
        self._factories[interface] = factory

    def get(self, interface: Type[T]) -> T:
        """获取服务实例"""
        # 优先返回单例
        if interface in self._singletons:
            return self._singletons[interface]
        # 使用工厂创建
        if interface in self._factories:
            return self._factories[interface]()
        raise ValueError(f"Service {interface} not registered")

# 全局容器实例
_container = Container()

def get_container() -> Container:
    return _container

def get_service(interface: Type[T]) -> Callable:
    """FastAPI Depends 工厂"""
    def dependency():
        return _container.get(interface)
    return dependency
```

### 5.2 容器初始化

```python
# main.py — startup 事件
from .core.container import get_container
from .config.database import SessionLocal
from .repositories import *
from .services import *

def configure_container():
    """配置依赖注入容器"""
    container = get_container()

    # 注册数据库会话工厂
    container.register_factory(SessionLocal, SessionLocal)

    # 注册 Repository
    container.register_factory(
        ConversationRepository,
        lambda: ConversationRepository(SessionLocal())
    )
    # ... 其他 Repository

    # 注册 Service
    container.register_singleton(
        ConversationService,
        ConversationService(
            conv_repo=container.get(ConversationRepository),
            exec_repo=container.get(ExecutionRepository),
            backend=container.get(AgentBackend),
        )
    )
    # ... 其他 Service

app = FastAPI()

@app.on_event("startup")
async def startup():
    configure_container()
```

### 5.3 消除全局状态清单

| 文件 | 全局变量 | 替换方案 |
|------|----------|----------|
| `scheduler.py` | `_engine_factory` | 移入 Container，通过 `get_service(EngineFactory)` 获取 |
| `session_cleanup.py` | `_backend`, `_active_sessions` | 移入 Container，SessionRegistry 作为单例注册 |
| `conversations.py` | `session_manager` | 移入 ConversationService |
| `data_maintenance.py` | `_dispatcher`, `_scheduler` | 移入 Container |

### 5.4 前端状态管理

- 使用 **Zustand** 替代组件内 useState 管理全局状态
- 每个领域创建独立 Store（conversationStore、workflowStore 等）
- Store 通过 Hooks 暴露给组件，组件不直接修改 Store 内部状态

---

## 六、自动化防护工具配置

### 6.1 ESLint 配置

```jsonc
// webui/.eslintrc.json
{
  "rules": {
    "max-lines": ["error", { "max": 500, "skipBlankLines": true, "skipComments": true }],
    "max-lines-per-function": ["error", { "max": 50, "skipBlankLines": true }],
    "no-magic-numbers": ["warn", { "ignore": [0, 1, -1, 200, 404, 500] }],
    "no-restricted-imports": ["error", {
      "paths": [{
        "name": "axios",
        "message": "请使用 @/api/client 统一请求"
      }]
    }],
    "no-restricted-syntax": ["error", {
      "selector": "CallExpression[callee.name='fetch']",
      "message": "禁止直接使用 fetch，请使用 @/api 模块"
    }]
  }
}
```

### 6.2 Python 代码检查

```toml
# pyproject.toml — ruff 配置
[tool.ruff]
line-length = 120
max-lines = 500

[tool.ruff.lint]
select = [
    "E",    # pycodestyle errors
    "W",    # pycodestyle warnings
    "F",    # pyflakes
    "C",    # conventions
    "I",    # isort
    "N",    # naming
    "UP",   # pyupgrade
]

[tool.ruff.lint.per-file-ignores]
"main/controllers/*.py" = ["C901"]  # 允许路由文件稍复杂

[tool.ruff.lint.mccabe]
max-complexity = 10
```

### 6.3 Pre-commit Hook

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: check-file-lines
        name: Check file line count
        entry: python scripts/check_lines.py
        language: system
        files: \.(py|ts|tsx)$

      - id: ruff-check
        name: Ruff lint
        entry: ruff check
        language: system
        files: \.py$

      - id: eslint-check
        name: ESLint check
        entry: npx eslint
        language: system
        files: \.(ts|tsx)$

      - id: dependency-check
        name: Dependency architecture check
        entry: python scripts/check_dependencies.py
        language: system
        files: \.py$
```

```python
# scripts/check_lines.py — 行数检查脚本
import sys
import os

MAX_LINES = 500
EXCLUDE_DIRS = {'node_modules', 'dist', '.git', '__pycache__', 'venv'}

def check_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = len(f.readlines())
    if lines > MAX_LINES:
        print(f"❌ {filepath}: {lines} 行 (超过 {MAX_LINES} 行限制)")
        return False
    return True

def main():
    failed = False
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for file in files:
            if file.endswith(('.py', '.ts', '.tsx')):
                filepath = os.path.join(root, file)
                if not check_file(filepath):
                    failed = True
    sys.exit(1 if failed else 0)

if __name__ == '__main__':
    main()
```

### 6.4 依赖架构检测

```python
# scripts/check_dependencies.py — 分层依赖检测
"""
检测规则：
1. controllers/ 不得直接 import models/ 中的 ORM 模型（应通过 Service）
2. controllers/ 不得直接使用 SessionLocal
3. services/ 不得直接使用 SessionLocal
4. 不得跨模块访问私有成员（以 _ 开头）
"""

import ast
import sys
from pathlib import Path

RULES = [
    {
        "name": "Controller 不得直接操作数据库",
        "source_dir": "main/controllers",
        "forbidden_imports": ["SessionLocal", "sqlalchemy"],
        "pattern": "controllers 不应直接导入数据库相关模块"
    },
    {
        "name": "Service 不得直接操作数据库",
        "source_dir": "main/services",
        "forbidden_imports": ["SessionLocal"],
        "pattern": "services 不应直接使用 SessionLocal，应通过 Repository"
    },
]

def check_imports(filepath, forbidden):
    with open(filepath, 'r') as f:
        tree = ast.parse(f.read())
    violations = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if any(f in alias.name for f in forbidden):
                    violations.append(f"  行 {node.lineno}: import {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            if node.module and any(f in node.module for f in forbidden):
                violations.append(f"  行 {node.lineno}: from {node.module} import ...")
    return violations

def main():
    failed = False
    for rule in RULES:
        path = Path(rule["source_dir"])
        if not path.exists():
            continue
        for py_file in path.glob("**/*.py"):
            violations = check_imports(py_file, rule["forbidden_imports"])
            if violations:
                print(f"❌ {rule['name']}: {py_file}")
                for v in violations:
                    print(v)
                failed = True
    sys.exit(1 if failed else 0)

if __name__ == '__main__':
    main()
```

---

## 七、重构前置条件（依赖图 + 并发方案 + 测试策略）

> ⚠️ 以下三项是重构的**安全网**，必须在动手前完成，否则重构就是在裸奔。

### 7.1 后端依赖关系图分析

#### 6.1.1 当前依赖关系（问题诊断）

通过分析 `main/` 目录下所有 Python 文件的 import 语句，得出以下依赖关系：

```
main.py (入口)
├── framework/main.py (FastAPI app)
│   ├── framework/api/* (12 个路由模块)
│   │   ├── conversations.py ──→ models, core/workflow_engine, core/container, SessionLocal
│   │   ├── workflows.py ──→ models, core/workflow_parser, core/container
│   │   ├── executions.py ──→ repositories/execution_repo, models, SessionLocal
│   │   ├── sessions.py ──→ models, SessionLocal
│   │   ├── triggers.py ──→ models, core/container, SessionLocal
│   │   ├── dispatch.py ──→ core/agent_dispatcher, core/container
│   │   ├── scheduler_routes.py ──→ core/scheduler
│   │   └── ... (其余路由)
│   │
│   ├── framework/core/* (16 个核心模块)
│   │   ├── workflow_engine.py ──→ models, agent_dispatcher, debate_executor, retry_handler, workflow_parser, SessionLocal
│   │   ├── agent_dispatcher.py ──→ protocols (AgentBackend)
│   │   ├── scheduler.py ──→ workflow_engine (延迟), SessionLocal, models
│   │   ├── container.py ──→ config, hapi_bridge/session
│   │   ├── session_cleanup.py ──→ protocols (AgentBackend) [全局 _backend, _active_sessions]
│   │   └── ...
│   │
│   └── framework/config.py ──→ Settings, _find_opencode_bin()
│
├── session/* (Agent 执行层)
│   ├── opencode_backend.py ──→ process_pool
│   └── process_pool.py ──→ _find_opencode_bin() (与 config.py 重复)
│
└── data_maintenance/* (独立子系统)
    └── core/data_maintenance.py ──→ framework/core/agent_dispatcher [全局 _dispatcher, _scheduler]
```

#### 6.1.2 已识别的循环依赖风险

| 风险点 | 说明 |
|--------|------|
| `conversations.py` ↔ `workflow_engine.py` | conversations 延迟导入 WorkflowEngine，WorkflowEngine 被 conversations 间接调用 |
| `scheduler.py` → `workflow_engine.py` → `models` | scheduler 通过引擎工厂间接依赖 models，同时自己也直接操作 models |
| `container.py` → `session/` → `config.py` | 容器创建 backend 实例，backend 依赖 config 中的路径查找 |

#### 6.1.3 DI Container 初始化顺序（拓扑排序）

```
Level 0: config/settings.py (无依赖)
Level 1: config/database.py (依赖 settings)
Level 2: models/* (依赖 database)
Level 3: repositories/* (依赖 models + database)
Level 4: session/opencode_backend (依赖 config)
Level 5: core/agent_dispatcher (依赖 session/backend)
Level 6: services/* (依赖 repositories + agent_dispatcher)
Level 7: core/workflow_engine (依赖 services + agent_dispatcher)
Level 8: core/scheduler (依赖 workflow_engine)
Level 9: controllers/* (依赖 services)
Level 10: main.py (组装所有)
```

**Container 注册顺序必须严格按此拓扑序执行，否则会触发未初始化依赖。**

### 7.2 SQLite 并发方案

#### 7.2.1 问题分析

当前 SQLite 并发问题的根源：
- `workflow_engine.py` 在并行执行节点时，多个协程同时写入 `execution_nodes` 表
- `conversations.py` 的 `_execute_workflow_async` 创建嵌套 Session（`db2 = SessionLocal()`）
- 默认 journal mode 是 DELETE，不支持并发读写

#### 7.2.2 方案选型：SQLite WAL + 写队列（选定方案）

**不迁移 PostgreSQL**，理由：
- 项目是单机部署的个人工具，不需要分布式
- SQLite 零配置、备份简单（复制文件即可）
- 迁移成本高，收益低

**实施方案：**

```python
# config/database.py — WAL 模式 + 连接池配置
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    pool_size=5,          # 连接池大小
    max_overflow=10,      # 溢出连接数
    pool_pre_ping=True,   # 连接健康检查
)

# 启用 WAL 模式
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")      # 写冲突时等待 5 秒
    cursor.execute("PRAGMA synchronous=NORMAL")      # WAL 模式下安全且更快
    cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
```

```python
# repositories/base.py — 写队列（可选，高并发场景启用）
import asyncio
from contextlib import asynccontextmanager

class WriteQueue:
    """串行化所有写操作，避免 SQLite 写锁冲突"""

    def __init__(self):
        self._queue: asyncio.Queue = asyncio.Queue()
        self._running = False

    async def enqueue(self, func, *args, **kwargs):
        """将写操作加入队列，等待执行完成"""
        future = asyncio.get_event_loop().create_future()
        await self._queue.put((func, args, kwargs, future))
        return await future

    async def start(self):
        """启动写队列消费者"""
        self._running = True
        while self._running:
            func, args, kwargs, future = await self._queue.get()
            try:
                result = func(*args, **kwargs)
                future.set_result(result)
            except Exception as e:
                future.set_exception(e)

# 全局写队列实例
_write_queue = WriteQueue()

class BaseRepository(Generic[T]):
    def __init__(self, model: Type[T], db_factory: Callable):
        self._model = model
        self._db_factory = db_factory

    def _write(self, operation):
        """通过写队列串行化写操作"""
        return _write_queue.enqueue(operation)
```

#### 7.2.3 Repository 层会话管理规则

| 场景 | 策略 |
|------|------|
| 读操作 | 直接使用注入的 Session，不创建新 Session |
| 单次写操作 | 使用注入的 Session，Repository 方法结束时 commit |
| 批量写操作 | 使用 `db.begin()` 上下文管理器，全部成功才 commit |
| 跨 Repository 写操作 | Service 层管理事务，通过 UnitOfWork 模式 |
| 并行节点写入 | WAL 模式 + busy_timeout=5000 自动重试 |

```python
# services/unit_of_work.py — 跨 Repository 事务
class UnitOfWork:
    def __init__(self, db: Session):
        self._db = db
        self._repos: Dict[str, BaseRepository] = {}

    def __enter__(self):
        self._transaction = self._db.begin()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self._transaction.rollback()
        else:
            self._transaction.commit()

    def repository(self, name: str, model: Type[T]) -> BaseRepository[T]:
        if name not in self._repos:
            self._repos[name] = BaseRepository(model, self._db)
        return self._repos[name]
```

### 7.3 测试策略

#### 7.3.1 测试金字塔

```
         ╱╲
        ╱E2E╲        少量（5-10 个核心流程）
       ╱──────╲
      ╱ 集成测试 ╲     中量（30-50 个 API 端点）
     ╱────────────╲
    ╱   单元测试    ╲    大量（Service/Repository/工具函数）
   ╱────────────────╲
```

#### 7.3.2 重构前：关键路径集成测试（安全网）

**必须在重构前完成的测试，作为重构的安全网：**

```python
# tests/integration/test_conversation_flow.py
"""
测试路径：创建对话 → 发送消息 → 获取回复
覆盖：conversations.py 的核心流程
"""
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_create_conversation(client: AsyncClient):
    """创建对话"""
    response = await client.post("/api/v1/conversations/", json={
        "title": "测试对话",
        "agent": "fin-orchestrator"
    })
    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert data["title"] == "测试对话"
    return data["id"]

@pytest.mark.asyncio
async def test_send_agent_message(client: AsyncClient):
    """发送 Agent 消息并获取回复"""
    conv_id = await test_create_conversation(client)

    # 发送消息
    response = await client.post(f"/api/v1/conversations/{conv_id}/messages", json={
        "content": "大盘今天怎么样",
        "mode": "agent"
    })
    assert response.status_code == 200
    task_id = response.json()["task_id"]

    # 轮询等待回复（最多 60 秒）
    for _ in range(120):
        response = await client.get(f"/api/v1/conversations/{conv_id}/messages")
        messages = response.json()
        if len(messages) > 1:  # 用户消息 + AI 回复
            assert messages[-1]["role"] == "assistant"
            break
        await asyncio.sleep(0.5)
    else:
        pytest.fail("Agent 回复超时")
```

```python
# tests/integration/test_workflow_flow.py
"""
测试路径：创建工作流 → 触发执行 → 查看结果
覆盖：workflows.py + workflow_engine.py 的核心流程
"""
@pytest.mark.asyncio
async def test_create_and_execute_workflow(client: AsyncClient):
    """创建简单工作流并执行"""
    # 创建工作流
    response = await client.post("/api/v1/workflows/", json={
        "name": "测试工作流",
        "nodes": [
            {"id": "n1", "type": "agent", "agent": "macro-scout", "prompt": "查看大盘"},
            {"id": "n2", "type": "agent", "agent": "technical-chartist", "prompt": "分析上证指数"}
        ],
        "edges": [
            {"source": "n1", "target": "n2"}
        ]
    })
    assert response.status_code == 200
    workflow_id = response.json()["id"]

    # 触发执行
    response = await client.post(f"/api/workflows/{workflow_id}/trigger")
    assert response.status_code == 200
    execution_id = response.json()["execution_id"]

    # 等待执行完成
    for _ in range(120):
        response = await client.get(f"/api/v1/executions/{execution_id}")
        status = response.json()["status"]
        if status in ("completed", "failed"):
            assert status == "completed"
            break
        await asyncio.sleep(1)
    else:
        pytest.fail("工作流执行超时")
```

```python
# tests/integration/test_scheduled_workflow.py
"""
测试路径：创建工作流 → 设置定时 → 手动触发验证
覆盖：scheduler_routes.py + scheduler.py 的核心流程
"""
@pytest.mark.asyncio
async def test_scheduled_workflow(client: AsyncClient):
    """定时工作流设置与触发"""
    # 创建工作流
    workflow_id = await create_test_workflow(client)

    # 设置定时
    response = await client.post(f"/api/v1/workflows/{workflow_id}/schedule", json={
        "cron_expression": "0 9 * * 1-5"
    })
    assert response.status_code == 200

    # 验证定时任务已注册
    response = await client.get("/api/v1/workflows/scheduled")
    scheduled = response.json()
    assert any(w["id"] == workflow_id for w in scheduled)
```

#### 7.3.3 重构后：分层单元测试

```python
# tests/unit/test_conversation_service.py
"""
测试 ConversationService 的业务逻辑
mock 所有 Repository 依赖
"""
from unittest.mock import Mock, MagicMock
from main.services.conversation_service import ConversationService

class TestConversationService:
    def setup_method(self):
        self.conv_repo = Mock()
        self.exec_repo = Mock()
        self.backend = Mock()
        self.service = ConversationService(
            conv_repo=self.conv_repo,
            exec_repo=self.exec_repo,
            backend=self.backend
        )

    def test_create_conversation(self):
        """创建对话 — 验证 Repository 调用"""
        self.conv_repo.create.return_value = Mock(id="conv-1", title="测试")
        result = self.service.create(CreateConversationRequest(title="测试"))
        self.conv_repo.create.assert_called_once()
        assert result.id == "conv-1"

    def test_send_message_agent_mode(self):
        """Agent 模式发送消息 — 验证 Backend 调用"""
        self.conv_repo.get.return_value = Mock(id="conv-1", hapi_session_id=None)
        self.backend.create_session.return_value = "session-1"

        self.service.send_message("conv-1", SendMessageRequest(content="你好", mode="agent"))

        self.backend.create_session.assert_called_once()
        self.backend.send_message.assert_called_once()

    def test_send_message_workflow_mode(self):
        """Workflow 模式发送消息 — 验证引擎创建"""
        self.conv_repo.get.return_value = Mock(id="conv-1")
        # ...
```

```python
# tests/unit/test_execution_repository.py
"""
测试 ExecutionRepository 的数据访问逻辑
使用 SQLite 内存数据库
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from main.models import Base
from main.repositories.execution_repo import ExecutionRepository

@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()

class TestExecutionRepository:
    def test_create_execution(self, db_session):
        repo = ExecutionRepository(db_session)
        execution = repo.create(workflow_id="wf-1", status="pending")
        assert execution.id is not None
        assert execution.status == "pending"

    def test_update_node_status(self, db_session):
        repo = ExecutionRepository(db_session)
        execution = repo.create(workflow_id="wf-1")
        repo.update_node(execution.id, "n1", status="completed", output={"result": "ok"})
        node = repo.get_node(execution.id, "n1")
        assert node.status == "completed"
```

#### 7.3.4 测试目录结构

```
tests/
├── conftest.py              # pytest fixtures（client, db_session 等）
├── integration/
│   ├── test_conversation_flow.py
│   ├── test_workflow_flow.py
│   ├── test_scheduled_workflow.py
│   └── test_dispatch_flow.py
├── unit/
│   ├── services/
│   │   ├── test_conversation_service.py
│   │   ├── test_workflow_service.py
│   │   └── test_execution_service.py
│   ├── repositories/
│   │   ├── test_execution_repository.py
│   │   └── test_conversation_repository.py
│   └── core/
│       ├── test_workflow_parser.py
│       └── test_retry_handler.py
└── e2e/
    └── test_full_analysis.py   # 端到端：大盘分析完整流程
```

#### 7.3.5 测试执行计划

| 阶段 | 测试类型 | 数量目标 | 执行频率 |
|------|----------|----------|----------|
| 重构前 | 集成测试 | 10-15 个 | 每次提交 |
| 重构中 | 单元测试 | 50-80 个 | 每个 PR |
| 重构后 | 全量测试 | 100+ 个 | CI/CD 自动 |

---

## 八、重构执行计划（7 阶段）

### 阶段 0：安全网 + 基础设施（第 1-2 周）

> ⚠️ 阶段 0 是重构的**前置条件**，必须完成才能进入后续阶段。

| 任务 | 产出 | 验收标准 |
|------|------|----------|
| **编写关键路径集成测试** | `tests/integration/test_conversation_flow.py` 等 | 10-15 个集成测试全部通过 |
| 配置 SQLite WAL 模式 | `config/database.py` | WAL 模式生效，busy_timeout=5000 |
| 实现写队列（可选） | `repositories/write_queue.py` | 并发写入无锁冲突 |
| 创建 config/ 目录，迁移配置 | `config/settings.py`, `config/constants.py`, `config/database.py` | 所有硬编码常量抽离 |
| 创建 repositories/base.py 泛型基类 | `BaseRepository[T]` | 基类完整、可实例化 |
| 创建 core/container.py 增强版 | DI 容器 | 支持 singleton/factory 注册 |
| 配置 ruff + ESLint 规则 | `pyproject.toml`, `.eslintrc.json` | 规则生效、CI 可运行 |
| 配置 pre-commit hooks | `.pre-commit-config.yaml` | 提交时自动检查 |
| 创建分层检测脚本 | `scripts/check_dependencies.py` | 检测脚本可运行 |

### 阶段 1：后端 Repository 层建设（第 3 周）

**目标**：统一数据库访问，消除散落的 `SessionLocal()` 调用

| 任务 | 涉及文件 | 产出 |
|------|----------|------|
| 实现 AgentRepository | `repositories/agent_repo.py` | Agent CRUD 完整 |
| 实现 WorkflowRepository | `repositories/workflow_repo.py` | Workflow CRUD 完整 |
| 扩展 ExecutionRepository | `repositories/execution_repo.py` | 覆盖所有执行相关查询 |
| 实现 ConversationRepository | `repositories/conversation_repo.py` | Conversation + Message CRUD |
| 实现 MaintenanceRepository | `repositories/maintenance_repo.py` | 数据维护 CRUD |
| 修改所有 API 端点使用 Depends(get_db) | 12 个控制器文件 | 无直接 SessionLocal 调用 |

**验收标准**：
- `grep -r "SessionLocal()" main/ --include="*.py"` 返回 0 结果（仅 database.py 中定义）
- 所有 Repository 可独立单元测试
- 分层检测脚本通过

### 阶段 2：后端 Service 层建设（第 4-5 周）

**目标**：提取业务逻辑，Controller 瘦身

| 任务 | 涉及文件 | 产出 |
|------|----------|------|
| 提取 ConversationService | 从 `conversations.py` 提取 | `services/conversation_service.py` |
| 提取 WorkflowService | 从 `workflows.py` + `workflow_engine.py` 提取 | `services/workflow_service.py` |
| 提取 ExecutionService | 从 `executions.py` 提取 | `services/execution_service.py` |
| 提取 SchedulerService | 从 `scheduler.py` 提取 | `services/scheduler_service.py` |
| 拆分 workflow_engine.py 的 execute_node | 新建 `core/node_executors/` | 策略模式，每种节点独立 Executor |
| 拆分 conversations.py 的后台任务 | 新建 `services/message_processor.py` | 后台任务独立模块 |
| 重构 Controller 层为纯路由 | 12 个控制器文件 | 每个端点不超过 20 行 |

**验收标准**：
- 所有 Controller 文件不超过 200 行
- conversations.py 从 610 行降至 150 行以下
- workflow_engine.py 从 603 行降至 300 行以下
- 所有 Service 可独立单元测试

### 阶段 3：后端依赖治理（第 6 周）

**目标**：彻底消除全局状态，完成 DI 容器落地

| 任务 | 涉及文件 | 产出 |
|------|----------|------|
| 将所有依赖收入 Container | `core/container.py` | 统一依赖管理 |
| 删除所有模块级 configure() 函数 | `scheduler.py`, `session_cleanup.py`, `conversations.py`, `data_maintenance.py` | 无 configure 函数 |
| 消除 _find_opencode_bin 重复 | `config.py`, `process_pool.py` | 共享配置函数 |
| main.py 瘦身 | `main.py` | 仅路由注册和启动配置 |
| 全量集成测试 | 测试文件 | 所有 API 端点正常工作 |

**验收标准**：
- `grep -r "configure(" main/ --include="*.py"` 返回 0 结果
- `grep -r "_engine_factory\|_backend\|_active_sessions\|_dispatcher\|_scheduler" main/ --include="*.py"` 仅在 Container 中出现
- 分层检测脚本全部通过

### 阶段 4：前端架构建设（第 7-8 周）

**目标**：建立分层架构，统一 API 调用和状态管理

| 任务 | 涉及目录 | 产出 |
|------|----------|------|
| 创建 API 客户端层 | `api/client.ts`, `api/conversations.ts` 等 | 统一 Axios 封装 |
| 创建配置层 | `config/api.ts`, `config/endpoints.ts`, `config/theme.ts` | 所有常量抽离 |
| 创建 Zustand Store | `store/conversationStore.ts` 等 | 全局状态管理 |
| 创建自定义 Hooks | `hooks/useConversation.ts` 等 | 业务逻辑封装 |
| 重构 ChatPage | `pages/ChatPage.tsx` | 从 833 行降至 200 行以下 |
| 重构 WorkflowEditor | `pages/WorkflowEditor.tsx` | 从 1563 行降至 300 行以下，拆分子组件 |
| 重构 AgentsPage | `pages/AgentsPage.tsx` | 从 941 行降至 200 行以下 |
| 重构 AppLayout | `App.tsx` | 消除内联样式，使用 CSS 变量 |
| 配置 ESLint 规则 | `.eslintrc.json` | 禁止直接 fetch、限制行数 |

**验收标准**：
- 所有页面文件不超过 300 行
- 无直接 `fetch()` 调用（全部通过 api/ 模块）
- 无硬编码 API 地址
- ESLint 检查全部通过

### 阶段 5：全量验证与收尾（第 9 周）

| 任务 | 产出 |
|------|------|
| 运行 ruff 全量检查 | 0 error |
| 运行 ESLint 全量检查 | 0 error |
| 运行分层依赖检测脚本 | 0 violation |
| 运行行数检查脚本 | 所有文件 ≤ 500 行 |
| 全量集成测试 | 所有 API 端点正常 |
| 前端 E2E 测试 | 核心流程正常 |
| 更新 README.md | 反映新架构 |
| 更新架构文档 | ARCHITECTURE.md |

---

## 九、验收标准与检查清单

### 9.1 架构合规检查

- [ ] 所有文件 ≤ 500 行
- [ ] 无 God Object（单文件单一职责）
- [ ] 无全局 `configure()` 函数
- [ ] 无直接 `SessionLocal()` 调用（Repository 层除外）
- [ ] Controller 层无业务逻辑
- [ ] Service 层无数据库操作
- [ ] 前端无直接 `fetch()` 调用
- [ ] 前端无硬编码 API 地址
- [ ] 所有常量抽离至 config/

### 9.2 代码质量检查

- [ ] ruff 检查通过（0 error）
- [ ] ESLint 检查通过（0 error）
- [ ] 分层依赖检测通过（0 violation）
- [ ] 行数检查通过（所有文件 ≤ 500 行）

### 9.3 功能验证

- [ ] 后端所有 API 端点正常响应
- [ ] 工作流创建、编辑、执行正常
- [ ] 对话功能正常（Agent 模式 + Workflow 模式）
- [ ] 定时任务正常
- [ ] 数据维护功能正常
- [ ] 前端所有页面正常渲染
- [ ] 前端核心流程可走通

---

## 附录：重构前后对比预期

| 指标 | 重构前 | 重构后 |
|------|--------|--------|
| 最大文件行数 | 1563 行 (WorkflowEditor.tsx) | ≤ 500 行 |
| SessionLocal 调用次数 | 37 处 | 1 处（database.py 定义） |
| 全局 configure 函数 | 5 个 | 0 个 |
| Controller 文件平均行数 | 300+ 行 | ≤ 200 行 |
| 前端直接 fetch 调用 | 50+ 处 | 0 处 |
| 硬编码 API 地址 | 散落各处 | 集中在 config/endpoints.ts |
| 可单元测试的模块数 | ~30% | 100% Service/Repository |
