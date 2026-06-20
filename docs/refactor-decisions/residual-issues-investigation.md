# 四个遗留问题深度排查报告

> 调查日期: 2026-06-20
> 调查人: 主 agent(主调度)
> 任务卡进度: 24/24 完成,本报告评估之前标注的 4 个"已知遗留问题"

---

## TL;DR

| # | 问题 | 严重度 | 实际影响范围 | 修复成本 |
|---|---|---|---|---|
| 1 | 后端 `system.py` 路由未挂载 | 🟡 中 | 前端无任何代码调用 `ROUTES.system.dbHealth`;后端代码定义存在但应用不会注册该端点 | 🟢 1 行修复 |
| 2 | ChatPage 内 `useConversationPolling`/`useConversationStream` 引用已删 `listMessages` | 🔴 高 | 2 个文件无法编译 → `ChatPage` 功能(轮询 + SSE 流)在运行时**会 throw** `ReferenceError: listMessages is not defined` | 🟢 2 处替换 + 删除 1 函数调用 |
| 3 | pages/ 下 16 个文件直接 `import ... from '../api/...'`(违反 P3-T6 ESLint 规则) | 🔴 高 | `npm run lint` 在 CI 阶段会**全部失败**,`npm run build` 也会失败;其中 5 个文件还引用了 P2 阶段已删的 API 函数 | 🟡 中等(需逐文件改) |
| 4 | SessionsPage 408 行引用未定义函数 | 🔴 高 | SessionsPage 整个文件**无法编译**,即使加 ESLint 修复后整个页面也是空壳 | 🟠 较大(决定如何处理) |

---

## 问题 1:后端 `system.py` 路由未挂载

### 现状

- `src/main/api/v1/system.py:20-44` 定义了 `router = APIRouter(prefix="/system")` + `GET /db_health` 端点
- `src/main/api/app.py:80-86` 的 `from src.main.api.v1 import (...)` 列表**未包含** `system`
- `src/main/api/app.py:106-110` 的 `app.include_router(...)` 调用**未包含** `system.router`
- `src/main/api/v1/__init__.py:38` 已经 `from src.main.api.v1.system import router`,所以 import 路径是通的,只是 `create_app` 没调用

### 影响范围

- 前端 `ROUTES.system.dbHealth = "/system/db_health"` 已定义在 `src/webui/src/api/contract.ts:39`,但**当前 webui 没有任何代码调用** `ROUTES.system.dbHealth`(grep 全 webui 无匹配)
- `src/webui/src/domain/system.ts` 引用了 `/api/v1/system/{status,logs,cache}` 等,但这些端点**后端也不存在** —— 说明前端类型文件也是历史遗留
- 实际影响: **零**(没人调用,只是死代码)

### 修复方法

**最小修复**(推荐,1 行):
```python
# src/main/api/app.py:80-86,改为:
from src.main.api.v1 import (
    agents,
    conversations,
    executions,
    mcp,
    system,        # ← 加这一行
    workflows,
)
```

```python
# src/main/api/app.py:106-110,改为:
app.include_router(workflows.router)
app.include_router(executions.router)
app.include_router(agents.router)
app.include_router(mcp.router)
app.include_router(conversations.router)
app.include_router(system.router)   # ← 加这一行
```

**或者彻底删除 `system.py` + `domain/system.ts` + `ROUTES.system.dbHealth` + CI 端点表 14 号**(零引用,符合 KISS 原则)。

**建议**: 选"彻底删除"路径,后端定义 + 前端类型 + ROUTES entry 三件套全部移除。原因:
- 没人调用
- `domain/system.ts` 引用的 `/api/v1/system/{status,logs,cache}` 后端**本就不存在**(从未实现)
- 已删除的 `api/system.ts`(P2-T4)就用过 `getSystemStatus`/`getLogsStats`/`getCacheState`,表明这些 API **从未在后端实现过**
- 只保留 `db_health` 也意义不大(没人用)

### 验证命令

```bash
# 删除后端前确认无引用
grep -rn "from src.main.api.v1.system\|api/v1.system\|api/v1/system" src/ --include="*.py" | head -10
# 预期: 只有 __init__.py:38(import router 自身) + system.py 自身
```

---

## 问题 2:ChatPage 内 `useConversationPolling`/`useConversationStream` 引用已删 `listMessages`

### 现状

| 文件 | 行 | 引用 |
|---|---|---|
| `src/webui/src/pages/ChatPage/hooks/useConversationPolling.ts` | 22 | `import { listMessages } from '../../../api/conversations';` |
| `src/webui/src/pages/ChatPage/hooks/useConversationPolling.ts` | 82 | `const msgs = await listMessages(conversationId);` |
| `src/webui/src/pages/ChatPage/hooks/useConversationStream.ts` | 15 | `import { listMessages } from '../../../api/conversations';` |
| `src/webui/src/pages/ChatPage/hooks/useConversationStream.ts` | 107 | `const msgs = await listMessages(conversationId);` |

`api/conversations.ts` 在 P2-T3 已删除 `listMessages`(后端无独立 `/conversations/{id}/messages` GET;消息已在 `getConversation` 响应里)。

### 严重性

🔴 **高** — ChatPage 是核心交互页面。
- `useConversationPolling` 和 `useConversationStream` 在 ChatPage 内被使用(`useMessages.ts:27,62-63` import 这两个 hook)
- 即使 ChatPage index.tsx 本身能编译,运行时发送消息后:
  - 走 polling 路径(`useConversationPolling.startStream`): `setInterval` 2s 后 `listMessages()` → `ReferenceError: listMessages is not defined` → catch 静默,轮询**永远不更新**消息
  - 走 stream 路径(`useConversationStream`): SSE 收到 `workflow_status`/`workflow_result`/`workflow_error` 事件后调 `listMessages()` 刷新消息 → 同样 throw → catch 静默,**workflow 状态无法显示**
- `useMessages.ts` 本身没引用 listMessages(已用 `useConversation` 拿到 envelope),但调 `useConversationStream`,stream hook 内部会炸

### 修复方法

**最小修复**(2 行):
```typescript
// useConversationPolling.ts
// L22: 删除 import { listMessages }
// L82: 改为 const msgs = convEnvelope?.messages ?? []
//      但 polling hook 不持有 convEnvelope — 需要改成调 getConversation(id) → .messages

// 或更简洁:在 polling hook 内部也用 useQuery(useConversation(id)) 拿 envelope
```

**实际更优的方案**(重写 polling/stream hook):
- `useConversationPolling`: 改用 `useQuery(useConversation)` 替代 `listMessages` 调用
- `useConversationStream`: SSE 事件触发时调 `useConversation(id).refetch()` 而非 `listMessages()`

但这要改 hook 接口,影响 `useMessages.ts`(L62-63)。
或者**最小成本**:保留 `useConversationPolling` 接收 `envelope.messages` 作为 prop / 参数,从 `useMessages` 传进去。

**建议**:重写这两个 hook(共 250 行),改用 React Query。

### 验证命令

```bash
# 删除 import 后
grep -n "listMessages" src/webui/src/pages/ChatPage/hooks/*.ts
# 预期: 零匹配
```

---

## 问题 3:pages/ 下 16 个文件直接 `import ... from '../api/...'`

### 现状

完整清单(16 个文件):

| # | 文件 | 路径深度 | 引用模块 | 引用函数 |
|---|---|---|---|---|
| 1 | `pages/RulesEditor.tsx` | L5 | `../api/opencode` | `opencodeGet`, `opencodePut` |
| 2 | `pages/SkillsPage.tsx` | L29 | `../api/opencode` | `opencodeDelete`, `opencodeGet`, `opencodePost`, `opencodePut` |
| 3 | `pages/ChatPage/hooks/useConversationPolling.ts` | L22 | `../../../api/conversations` | `listMessages` ← **已删** |
| 4 | `pages/ChatPage/hooks/useConversationStream.ts` | L15 | `../../../api/conversations` | `listMessages` ← **已删** |
| 5 | `pages/WorkflowEditor/hooks/useWorkflowAutoSave.ts` | L25 | `../../../api/workflows` | `UpdateWorkflowPayload`(类型) |
| 6 | `pages/WorkflowEditor/hooks/useWorkflowLoader.ts` | L31 | `../../../api/workflows` | `getWorkflow` |
| 7 | `pages/WorkflowEditor/properties/AgentNodePropertiesPanel.tsx` | L30 | `../../../api/mcp` | `listTools` |
| 8 | `pages/AgentsPage/index.tsx` | L60 | `../../api/agents` | `deleteAgent`, `updateAgent` ← **已删** |
| 9 | `pages/AgentsPage/CreateAgentModal.tsx` | L18 | `../../api/agents` | `updateAgent` ← **已删** |
| 10 | `pages/AgentsPage/EditAgentModal.tsx` | L22 | `../../api/agents` | `getAgentContent`, `updateAgent`, `updateAgentToolsWhitelist` ← **已删** |
| 11 | `pages/AgentsPage/ViewAgentModal.tsx` | L17 | `../../api/agents` | `getAgentContent` ← **已删** |
| 12 | `pages/AgentsPage/hooks/useAgentModels.ts` | L18 | `../../../api/opencode` | `opencodeGet`, `opencodePost` |
| 13 | `pages/AgentsPage/hooks/useAgentTools.ts` | L12, L14 | `../../../api/mcp`, `../../../api/http` | `listTools`, `apiGet`, `buildUrl` |
| 14 | `pages/AgentsPage/hooks/useAgentsPage.ts` | L11 | `../../../api/agents` | `getAgentToolsWhitelist` |
| 15 | `pages/modules/portfolio/index.tsx` | L39 | `../../api/modules/portfolio` | (批量 import) |
| 16 | `pages/modules/portfolio/StockDetail.tsx` | L49 | `../../api/modules/portfolio` | (批量 import) |

### 严重性分析

**A. 引用已删 API 的文件(必坏,7 个)**:
- `useConversationPolling.ts`, `useConversationStream.ts`(问题 2)
- `AgentsPage/index.tsx`, `CreateAgentModal.tsx`, `EditAgentModal.tsx`, `ViewAgentModal.tsx`(引用 `updateAgent`/`deleteAgent`/`getAgentContent`/`updateAgentToolsWhitelist`,全在 P2-T2 删了)

**B. 引用仍然存在 API 但违反 ESLint 规则(必 lint 失败,9 个)**:
- `RulesEditor.tsx`, `SkillsPage.tsx`, `useWorkflowAutoSave.ts`, `useWorkflowLoader.ts`, `AgentNodePropertiesPanel.tsx`, `useAgentModels.ts`, `useAgentTools.ts`, `useAgentsPage.ts`, portfolio 2 个文件
- 这些文件本身可能能编译,但 `npm run lint` 在 P3-T6 配置的 no-restricted-imports 规则下会**全部报错** → CI 阻断

### 修复策略

**A 类(已删 API 引用)**:
- AgentsPage 4 个文件 + AgentsPage index 1 个: 这些是 Agent CRUD,后端**无对应端点**。决策:
  - **选项 1**: 删除这些文件 + 在 App.tsx 移除 AgentsPage 路由(承认功能未实现,等后端补齐)
  - **选项 2**: 改造为本地 mock + 占位 UI(等后端补齐)
  - **选项 3**: 把 `updateAgent`/`deleteAgent` 等 P2 删除决定回滚,后端补齐端点(范围爆炸,不建议)
- **推荐**: 选选项 1(删除)。后端无 agent CRUD API,前端做下去是无根之木。删除 4 个 AgentsPage 内的 modal + 1 个 index 中的"新建/编辑/删除"按钮。
- ChatPage hooks 2 个:已在问题 2 单独说明

**B 类(违反 ESLint 规则但 API 仍存在)**:
- `useWorkflowAutoSave.ts` / `useWorkflowLoader.ts`: 改用 `src/webui/src/hooks/useWorkflows` 中对应的 hook
- `AgentNodePropertiesPanel.tsx`: 改用 `useMcp` 的 `useTools` hook
- `useAgentModels.ts`: opencode 的 `useOpencodeAgentModels` 已有(P3-T2c 生成的 25 个 hook 之一)
- `useAgentTools.ts`: 用 `useTools` / `useAllowedTools` hook 替代直接 `apiGet` + `buildUrl`
- `useAgentsPage.ts`: 用 `useAgentToolsWhitelist` 改写到 hooks(若还没有,需要新建)
- portfolio 2 个文件: 用 `usePortfolio` hook 替代
- `RulesEditor.tsx` / `SkillsPage.tsx`: 任务卡 P3-T5 明确说"不负责处理" —— 这两个页面应**直接删除路由 + 文件**,因为后端无对应端点

**实施路径建议**:
1. 派一个 haiku 子 agent 一次性处理 16 个文件的 import 修复(可批量)
2. ESLint 规则**暂时不强制**(P3-T6 已配置,但当前 `npm run lint` 还没跑过,直到 CI 跑才知道)
3. **或**:把 ESLint 规则的 `overrides.src/pages/**` 改严,确保所有 pages 直接调用都被捕获

---

## 问题 4:SessionsPage 408 行引用未定义函数

### 现状

`src/webui/src/pages/SessionsPage.tsx` 408 行:
- L66: `const data: SessionListResponse = await listSessions();`
- L81: `const data = await getSystemStatus();`
- L105: `await deleteSession(sessionId);`
- L118: `const result = await cleanupSessions({ all_expired: true });`
- L132: `const session = await getSession(sessionId);`

所有 5 个函数 + `SessionListResponse` 类型都未导入(也无 import 行)。grep 显示**该文件没有任何 `import ... from '../api/...'`**。P2-T4 子 agent 报告说"删了 SessionsPage.tsx 的 sessions 块",但只删了 import 行,**保留了函数调用和类型引用**。

### 严重性

🔴 **高**:
- 整个 408 行文件**TypeScript 编译完全失败**
- 即便 ESLint 规则修复了其他 15 个文件,`npm run build` 在 `npx tsc && vite build` 阶段会因为 SessionsPage 直接报错
- App.tsx 路由表包含 `/sessions`(`App.tsx:60`),运行时访问该路由会因为 import 失败而崩

### 修复方法

**方案 1:删除 SessionsPage 整个文件**(推荐,与"后端无 sessions API"事实一致)
- 移除 `App.tsx:60` 路由 + `App.tsx:27` lazy import + `App.tsx:58` menu item
- 删除 `src/webui/src/pages/SessionsPage.tsx`
- 工作量: 5 行修改 + 1 个文件删除

**方案 2:用 React Query + 真实 API 重写**
- 后端无 sessions API,这条路不通
- 需要先决定 SessionsPage 的真实业务(它似乎是 OpenCode runtime session,不是 fin-agent session)
- **不推荐**: 范围爆炸,后端支持未知

**方案 3:占位页 + TODO**
- 改成 30 行的 "SessionsPage (coming soon)" 静态页
- 路由保留但功能置空
- 工作量: 中等,408 行 → 30 行

**推荐**: 选方案 1(删除)。

### 验证命令

```bash
# 删除前确认无外部路由依赖
grep -rn "SessionsPage" src/webui/src/ --include="*.ts" --include="*.tsx" | grep -v "SessionsPage.tsx"
# 预期: 只有 App.tsx 的 lazy import + 路由 + 菜单项

# 删除后
test -f src/webui/src/pages/SessionsPage.tsx && echo "FAIL" || echo "PASS"
grep -n "SessionsPage" src/webui/src/App.tsx
# 预期: 零匹配
```

---

## 修复优先级

按 ROI(影响 / 成本)排序:

| 优先级 | 任务 | 工作量 | 阻塞 |
|---|---|---|---|
| **P0** | 问题 4: 删 SessionsPage | 🟢 5 行 | `npm run build` 编译 |
| **P0** | 问题 2: 修 ChatPage 2 个 hook | 🟢 50 行 | ChatPage 运行时崩溃 |
| **P0** | 问题 3A: 删 AgentsPage CRUD modals + index 按钮 | 🟡 200 行 | 编译 + 运行时 |
| **P1** | 问题 3B: 9 个文件 import 改 hooks | 🟡 中等 | `npm run lint` 通过 |
| **P1** | 问题 1: 删 system.py + domain/system.ts + ROUTES.system | 🟢 1 文件 | 无直接阻塞 |

**P0 修复 ~250 行代码,3-4 个子 agent 可完成,预计 1 小时内闭环。**

---

## 后续建议(非任务卡范围)

1. **重新审视任务卡边界**: P3-T5 任务卡明确"SkillsPage/RulesEditor 不处理",但 SkillsPage 237 行 + RulesEditor 61 行也是死代码(后端无端点),应一并删除 + 移除路由
2. **ESLint 规则增量加强**: 当前 `overrides.src.pages/**` 范围已覆盖这些文件,但未运行验证。建议添加 `npm run lint` 到 P3-T6 的 CI step(任务卡已要求,但子 agent 报告"加进 CI 但未实际跑")
3. **后端 system.py + 前端 domain/system.ts 一并清理**: 三件套(后端 + 前端类型 + ROUTES)同生共灭,零引用就全删
4. **补建 P5-T4**(本未在任务卡中): "E2E 全栈端到端测试 + 完整 TypeScript build 验证",作为 Phase 5 的真实闭环

---

## 附录:涉及的 24 个文件

```
src/main/api/app.py                                          (system router 缺失)
src/main/api/v1/system.py                                    (待删)
src/webui/src/api/contract.ts                                (dbHealth 入口待删)
src/webui/src/domain/system.ts                               (待删)

src/webui/src/pages/ChatPage/hooks/useConversationPolling.ts (listMessages 引用)
src/webui/src/pages/ChatPage/hooks/useConversationStream.ts  (listMessages 引用)
src/webui/src/pages/SessionsPage.tsx                         (待删,408 行)
src/webui/src/pages/SkillsPage.tsx                           (待删,237 行)
src/webui/src/pages/RulesEditor.tsx                          (待删,61 行)

src/webui/src/pages/AgentsPage/index.tsx                    (updateAgent/deleteAgent)
src/webui/src/pages/AgentsPage/CreateAgentModal.tsx          (updateAgent)
src/webui/src/pages/AgentsPage/EditAgentModal.tsx            (getAgentContent/updateAgent/updateAgentToolsWhitelist)
src/webui/src/pages/AgentsPage/ViewAgentModal.tsx            (getAgentContent)
src/webui/src/pages/AgentsPage/hooks/useAgentModels.ts       (opencode import)
src/webui/src/pages/AgentsPage/hooks/useAgentTools.ts        (apiGet/buildUrl)
src/webui/src/pages/AgentsPage/hooks/useAgentsPage.ts        (getAgentToolsWhitelist)
src/webui/src/pages/WorkflowEditor/hooks/useWorkflowAutoSave.ts (UpdateWorkflowPayload type)
src/webui/src/pages/WorkflowEditor/hooks/useWorkflowLoader.ts (getWorkflow)
src/webui/src/pages/WorkflowEditor/properties/AgentNodePropertiesPanel.tsx (listTools)
src/webui/src/pages/modules/portfolio/index.tsx              (api/modules/portfolio)
src/webui/src/pages/modules/portfolio/StockDetail.tsx        (api/modules/portfolio)
src/webui/src/App.tsx                                        (3 个 lazy import + 3 个路由)
```
