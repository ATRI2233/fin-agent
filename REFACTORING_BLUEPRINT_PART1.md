# fin-agent 重构执行蓝图 — Part 1：规范与目标结构

> 版本：v1.2
> 创建日期：2026-06-09
> 更新日期：2026-06-09（新增第四章：重构后完整目录结构）
> 基于：ARCHITECTURE_AUDIT.md 审计结论
> 目标：全面整改 God Object、全局状态滥用、DB 会话混乱、分层违规、前端无架构五大问题
> 约束：每个子文件夹内最多 7 个代码文件（不含 `__init__.py` / `index.ts`）

---

## 目录（本文档包含第一~四章）

- [一、架构规范总则](#一架构规范总则)
- [二、后端分层架构规范](#二后端分层架构规范)
- [三、前端分层架构规范](#三前端分层架构规范)
- [四、重构后完整目录结构](#四重构后完整目录结构)

> 后续章节见：Part 2（治理与前置条件）、Part 3（执行与验收）

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

