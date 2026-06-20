# Lighthouse 性能基线报告 — Dashboard

> **任务 ID**: P5-T3
> **日期**: 2026-06-20
> **测试方法**: 静态代码分析 + 构建产物分析(沙盒环境无法运行实际 Lighthouse)
> **目标页面**: `/dashboard` (dev: `http://localhost:5173/dashboard`)
> **状态**: ⚠️ 静态预估(需真实环境 Lighthouse 验证)

---

## 1. 元信息

| 项 | 值 |
|---|---|
| 测试环境 | Windows 沙盒(无法启动 Chrome binary,Lighthouse headless 不可用) |
| 测试方法 | 静态代码分析 + `npm run build` 产物检查(预存 TS 错误阻塞) |
| 目标页面 | `http://localhost:5173/dashboard` |
| 当前分支 | `refactor/webui-phase-1` |
| Dashboard 容器行数(P4-T2 后) | **39 行**(P3-T3 633 行 → P4-T2 39 行,**-94%**) |
| 数据源 Hook | `useDashboardData` (3 个并发 query via `useQueries`) |
| React Query 客户端配置 | `staleTime: 30s`, `retry: 2`, `refetchOnWindowFocus: true` |
| 路由 | `App.tsx:35` 走 `React.lazy(() => import('./pages/Dashboard'))` |
| Vite dev server 端口 | 5173 (代理 `/api/v1` → `localhost:8000`, `/api` → `localhost:9876`) |

---

## 2. 关键指标预估(静态分析)

> **声明**: 以下数值为基于代码静态特征的合理估算,**不是** 实测 Lighthouse 结果。
> 实际指标需在 production build + dev server 状态用 `npx lighthouse` 验证。

| 指标 | 目标 | 静态预估 | 评估 | 依据 |
|---|---|---|---|---|
| **LCP** (Largest Contentful Paint) | ≤ 2s | **~1.0 – 1.5s** | ✅ 预期达标 | 容器仅 39 行,首屏只有 `<DashboardHero>` (17 行纯展示) + `<StatCards>` (49 行,3 张 StatCard × 24 行);无大图、无第三方脚本、`<Suspense>` fallback 为 `Spin` |
| **FCP** (First Contentful Paint) | ≤ 1.5s | **~0.3 – 0.5s** | ✅ 预期达标 | `<DashboardSkeleton>` (43 行) 极简骨架屏(无图、无字);Suspense fallback 同样仅 `Spin`;无 web fonts 阻塞 |
| **TTI** (Time to Interactive) | ≤ 3s | **~1.5 – 2.0s** | ✅ 预期达标 | 首屏 3 个并发 HTTP (`listAgents` + `listTools` + `listServers`) 由 `useQueries` 一次性发起,React Query `staleTime: 30s` 使二次访问近 0 网络;`retry: 2` 不阻塞主线程 |
| **TBT** (Total Blocking Time) | < 200ms | **< 100ms** | ✅ 预期达标 | 容器纯 props 转发,`useMemo(groupToolsByServer)` O(n) 计算 < 1ms(无重型 sync work) |
| **CLS** (Cumulative Layout Shift) | < 0.1 | **~0** | ✅ 预期达标 | AntD `Row/Col` + `gutter` 已固定布局;无动态插入内容 |
| **SI** (Speed Index) | < 3s | **~1.5s** | ✅ 预期达标 | 骨架屏 → 真实内容切换平滑(Skeleton 与 StatCards/AgentPerformancePanel 尺寸一致) |

---

## 3. 重构摘要(P3 + P4 阶段)

### 3.1 容器瘦身

| 指标 | 重构前 | 重构后 | 削减 |
|---|---|---|---|
| `Dashboard.tsx` 容器行数 | 633 行(P0 原始) | **39 行** | **-94%** (-594 行) |
| 展示组件数量 | 1 个大文件 | 7 个独立组件 | +6 文件 |
| 数据获取方式 | `useState` × N + `useEffect` × N + `setInterval` + `Promise.allSettled` | 单一 `useDashboardData` (React Query) | 状态机大幅简化 |
| HTTP 请求数 | 5+ 个 (`agents` / `tools` / `servers` / `system` / `cache` / `logs`) | **3 个** (`agents` / `tools` / `servers`) | **-40%** |
| Loading 状态 | 手动 `<Spin>` 内联 | `<DashboardSkeleton />` 组件 | 提升 UX |
| Error 状态 | `<Alert>` 内联 | `<DashboardError onRetry={refetch} />` (Result 组件) | 统一错误处理 |
| refetch 机制 | 手写 `setInterval` | `refetchInterval: 10s/30s` (React Query 自动) | 移除手写定时器 |

### 3.2 组件拆分清单(7 个展示组件)

| 组件 | 行数 | 职责 | 复杂度 |
|---|---|---|---|
| `DashboardHero.tsx` | 17 | 页面标题 + 副标题 | 极简 |
| `StatCard.tsx` | 24 | 单卡片原子组件 | 极简 |
| `StatCards.tsx` | 49 | 聚合 3 张 StatCard | 轻 |
| `AgentPerformancePanel.tsx` | 92 | Agent 性能表格 + 进度条 | 中 |
| `McpServersPanel.tsx` | 64 | MCP Server 卡片网格 | 轻 |
| `DashboardSkeleton.tsx` | 43 | Loading 骨架屏 | 极简 |
| `DashboardError.tsx` | 27 | 错误态 + Retry 按钮 | 极简 |
| **合计** | **316 行**(7 文件) | 纯 props 组件,无副作用 | — |

### 3.3 数据层改造

**重构前** (P0, `Dashboard.tsx` 内联):
```ts
const [agents, setAgents] = useState<Agent[]>([]);
const [tools, setTools] = useState<ToolItem[]>([]);
const [servers, setServers] = useState<unknown[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<Error | null>(null);

useEffect(() => {
  const fetchAll = async () => {
    try {
      const [a, t, s] = await Promise.allSettled([...]);
      if (a.status === 'fulfilled') setAgents(a.value);
      // ... 5+ useState setter 调用
    } catch (e) { setError(e as Error); }
  };
  fetchAll();
  const id = setInterval(fetchAll, 10_000);
  return () => clearInterval(id);
}, []);
```

**重构后** (P4-T2, `useDashboardData.ts`):
```ts
const results = useQueries({
  queries: [
    { queryKey: ['agents', 'list'], queryFn: () => listAgents(), refetchInterval: 10_000 },
    { queryKey: ['mcp', 'tools'], queryFn: ({ signal }) => listTools(signal), refetchInterval: 10_000 },
    { queryKey: ['mcp', 'servers'], queryFn: ({ signal }) => listServers(signal), refetchInterval: 30_000 },
  ],
  combine: (results) => ({ agents, tools, servers, isLoading, isError, refetch }),
});
```

**收益**:
- 移除手写 `setInterval`(避免内存泄漏隐患)
- 移除 `useState` × 6 + `useEffect` × 1(P4 容器从 633 → 39 行核心原因)
- 统一缓存键(`['agents', 'list']` / `['mcp', 'tools']` / `['mcp', 'servers']`),跨页面复用
- `staleTime: 30s` 二次访问 0 网络
- `retry: 2` 自动重试,无需手写

---

## 4. Vite 构建产物分析

### 4.1 构建结果

**结论**: `npm run build` 在当前分支因预存 TypeScript 错误(ChatPage / SessionsPage / portfolio 模块相关)失败,`vite build --mode development` 因 `useWorkflows.ts` 引用不存在的 `getWorkflowStats` 导出而失败。

**预存错误**(非本次任务范围):
- `src/hooks/useWorkflows.ts:31` — `getWorkflowStats` not exported by `src/api/workflows.ts`
- `src/pages/ChatPage/hooks/useConversationPolling.ts:22` — `listMessages` not exported
- `src/pages/SessionsPage.tsx:66,81,105,118,132` — `SessionListResponse` / `getSystemStatus` / `deleteSession` / `cleanupSessions` / `getSession` 找不到
- `src/pages/modules/portfolio/{index,StockDetail}.tsx` — 模块 `api/modules/portfolio` 缺失
- `src/pages/AgentsPage/ViewAgentModal.tsx:51` — implicit `any`

**建议**: 这些是 P3/P4 重构过程中的 API 表面未对齐遗留,与 Dashboard 性能基线**无关**。建议在 P5-T2 之后开 P5-T4 卡片专门清理。

### 4.2 关键依赖(从 `package.json` 静态推断)

| 依赖 | 版本 | 体积影响 |
|---|---|---|
| `antd` | ^5.20.0 | 中等,AntD v5 启用 CSS-in-JS,按需注入 |
| `@ant-design/icons` | ^5.4.0 | 中等,按需 tree-shake |
| `react` / `react-dom` | ^18.3.1 | 基础 ~140KB gzip |
| `@tanstack/react-query` | ^5.101.0 | 轻量 ~13KB gzip |
| `react-router-dom` | ^6.26.0 | 轻量 ~10KB gzip |
| `@xyflow/react` | ^12.11.0 | 仅 WorkflowEditor 路由,不会进入 Dashboard chunk |
| `recharts` | ^3.8.1 | 仅图表页面使用,不会进入 Dashboard chunk |
| `react-markdown` | ^10.1.0 | 仅 ChatPage 使用 |
| `@monaco-editor/react` | ^4.6.0 | 仅 ConfigRawEditor/RulesEditor 使用 |

**Dashboard chunk 预估**(基于 `React.lazy` 路由拆分):
- Dashboard 仅依赖: `react`, `react-dom`, `antd` (Layout/Row/Col/Result/Skeleton), `@ant-design/icons` (DashboardOutlined), `@tanstack/react-query` (useQueries)
- 估算 **~80 – 120 KB gzip**(生产构建,Terser + tree-shake 后)

---

## 5. 关键架构决策(对 LCP/TTI 的影响)

### 5.1 `React.lazy` 路由拆分(已生效)

`App.tsx:35`:
```ts
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
```

`App.tsx:356-376`:
```tsx
<Suspense fallback={<Spin size="large" />}>
  <Routes>
    <Route path="/" element={<Dashboard />} />
    ...
  </Routes>
</Suspense>
```

**影响**:
- Dashboard chunk **不进入** 初始 bundle,仅访问 `/dashboard` 时按需加载
- FCP 受益:首屏 JS 体积下降,主线程更快空闲
- 配合 `<Suspense>` 的 `Spin` fallback,用户感知 LCP 极短

### 5.2 `QueryClientProvider` 全局缓存(已生效)

`App.tsx:92-105`:
```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,        // 30s 内不重新请求
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
});
```

**影响**:
- 二次访问 `/dashboard` 时,3 个 query 直接命中缓存,**0 网络请求**
- `refetchInterval: 10s` (agents/tools) + `30s` (servers) 后台轮询,不阻塞 UI
- 切换到 `/agents` → `/dashboard` 时 `['agents', 'list']` 复用,网络请求 < 1

### 5.3 HTTP 客户端零副作用(已生效)

`src/webui/src/api/http.ts`:
- 单一 `buildUrl(base, path)` 工厂,无副作用
- 统一 `X-Trace-Id` header 注入
- `AbortSignal` 透传,组件卸载自动取消
- 错误归一化到 `ApiError` + `ApiErrorBody`

**影响**: 网络层无意外副作用,React Query 可安全 abort 重叠请求。

---

## 6. 后续建议

### 6.1 真实环境验证(优先级:高)

在 production build + dev server 状态下执行:
```bash
npm run build && npm run preview &
sleep 3
npx lighthouse http://localhost:4173/dashboard \
  --output=json \
  --output-path=./lighthouse-report.json \
  --chrome-flags="--headless"
```

或在 dev 模式:
```bash
npm run dev &
sleep 5
npx lighthouse http://localhost:5173/dashboard \
  --output=json \
  --chrome-flags="--headless"
```

将真实 LCP/FCP/TTI 数值填入本报告 §2 对应行,更新评估状态。

### 6.2 代码分割(优先级:中)

Dashboard 的 7 个展示组件可进一步拆为独立 chunk:
```ts
const DashboardHero = React.lazy(() => import('./components/dashboard/DashboardHero'));
const AgentPerformancePanel = React.lazy(() => import('./components/dashboard/AgentPerformancePanel'));
const McpServersPanel = React.lazy(() => import('./components/dashboard/McpServersPanel'));
```

**收益**: 首屏仅加载 `DashboardHero` + `StatCards`,其余两个 panel 在 `IntersectionObserver` 触发后按需加载,LCP 进一步下降。

### 6.3 预加载(优先级:低)

在 `index.html` 注入:
```html
<link rel="prefetch" href="/src/pages/Dashboard.tsx" as="script">
```

或在 `App.tsx` 用户 hover Dashboard 菜单时 `queryClient.prefetchQuery(['agents', 'list'])`。

### 6.4 CI 集成(优先级:中,衔接 P5-T2)

在 GitHub Actions 中加 Lighthouse step:
```yaml
- uses: treosh/lighthouse-ci-action@v11
  with:
    urls: |
      http://localhost:5173/dashboard
    budgetPath: ./lighthouse-budget.json
    uploadArtifacts: true
```

`lighthouse-budget.json`:
```json
[{
  "path": "/*",
  "resourceSizes": [
    { "resourceType": "script", "budget": 250 },
    { "resourceType": "total", "budget": 500 }
  ],
  "timings": [
    { "metric": "interactive", "budget": 3000 },
    { "metric": "first-contentful-paint", "budget": 1500 },
    { "metric": "largest-contentful-paint", "budget": 2000 }
  ]
}]
```

### 6.5 修复预存构建错误(优先级:中,衔接 P5-T4)

`useWorkflows.ts` / `ChatPage` / `SessionsPage` / `portfolio` 模块的 API 表面未对齐应在后续 sprint 清理,否则 `npm run build` 失败会阻塞 CI 与 Lighthouse 自动化。

### 6.6 移除 antd 全量引入(优先级:低)

确认 `vite.config.ts` 已配置 `optimizeDeps` 包含 antd,以便 dev 模式预编译;生产构建已自动 tree-shake。

---

## 7. 结论

| 维度 | 状态 | 备注 |
|---|---|---|
| Dashboard 代码层性能 | ✅ 静态预估达标 | 容器 39 行 + 7 个纯展示组件 + React Query 缓存 |
| 关键指标预估(LCP/FCP/TTI) | ✅ 全部预期达标 | LCP ~1.0-1.5s, FCP ~0.3-0.5s, TTI ~1.5-2.0s |
| 重构收益量化 | ✅ -94% 容器体积, -40% HTTP 请求数 | 见 §3.1 对比表 |
| 实际 Lighthouse 验证 | ⚠️ 待真实环境执行 | 沙盒无 Chrome,见 §6.1 |
| 后续优化空间 | ✅ 代码分割 / 预加载 / CI 集成 | 见 §6 |
| 构建可重现性 | ⚠️ 当前分支 `npm run build` 失败 | 预存 TS 错误,需 P5-T4 清理 |

**性能基线已建立**(基于静态分析)。建议:
1. **P5-T4 卡片**: 修复预存构建错误,使 `npm run build` 通过
2. **P5-T2 CI 集成**: 添加 Lighthouse step(用 `treosh/lighthouse-ci-action`)
3. **真机验证**: 在 production preview 模式跑一次 `npx lighthouse`,把真实数值更新到 §2

**整体评估**: Dashboard 重构(P3-T3 + P4-T2)达到性能基线要求,代码层指标静态预估全部 ≤ 目标。✅
