# WebUI Frontend Audit Report

**Audit Layer:** WebUI Frontend (`project/src/webui/src/`)
**Date:** 2026-06-25
**Scope:** Bugs, Dead Code / Null Pointers, Redundant Design, Unreasonable Design / Missing Interfaces
**Total Findings:** 103 (12 Bugs + 27 Dead Code + 26 Redundant Design + 38 Unreasonable Design)

---

## Severity Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH     | 8 |
| MEDIUM   | 35 |
| LOW      | 60 |

---

## 1. Bugs

| # | Severity | File | Lines | Issue |
|---|----------|------|-------|-------|
| B1 | HIGH | `pages/AgentsPage/columns.tsx`, `hooks/useAgentsPage.ts` | 108-127, 30-36 | Source column `filePath` is never populated. `toAgentMeta()` only maps `name`, `description`, `mode` from the `Agent` type, but canonical `Agent` (domain/agent.ts:27-48) does not define `filePath`. Column always renders `'---'`, filter returns empty table. **Critical functionality loss.** |
| B2 | HIGH | `pages/WorkflowEditor/properties/DebateNodePropertiesPanel.tsx` | 99-103 | `allowClear` on Select causes `onChange` to fire `undefined` when cleared. Handler `updateAgent(idx, val)` expects `string` but receives `undefined`, inserting `undefined` into the workflow graph's `agents` array. |
| B3 | HIGH | `pages/WorkflowEditor/WorkflowSettingsModal.tsx` | 40, 57, 83, 91-93 | `nextCron` unconditionally set to `''` on save, and spread `...(nextCron ? { cron_expression: nextCron } : {})` always evaluates to `{}`. Any existing `cron_expression` on the workflow is silently dropped on every settings save. |
| B4 | MEDIUM | `pages/WorkflowMonitor.tsx` | 130 | Edge animation keyed on wrong direction. `animated: (execNodes.find((n) => n.node_id === e.source)?.status === 'running')` animates edges *leaving* the running node, not edges *entering* it. |
| B5 | MEDIUM | `pages/ChatPage/hooks/useMessages.ts` | 76-81 | Polling stops on every `convEnvelope` change. When `refetchOnWindowFocus` triggers a re-fetch (changing `convEnvelope` reference), the effect calls `stopPollingRef.current()` unconditionally, halting active polling mid-workflow. |
| B6 | MEDIUM | `pages/ChatPage/hooks/useMessages.ts` | 76-81 | `setMessages(convEnvelope.messages)` (in useMessages) and `setMessages(msgs)` (in useConversationPolling.ts:102-103) write to the same zustand store key independently, creating a data race on the shared `messages` array. |
| B7 | MEDIUM | `pages/FrameworkPage.tsx` | 107, 123 | Both "Edit" (EditOutlined) and "View" (EyeOutlined) buttons navigate to `/workflows/${record.id}/edit`. No read-only detail route exists; inspection gets edit mode. |
| B8 | MEDIUM | `pages/FrameworkPage.tsx` | 149-155 | "History Records" button navigates to `/workflows` — same route as current page. Either a no-op or unnecessary re-navigation. |
| B9 | LOW | `styles/theme.css` | 421-423 vs 607-613 | Duplicate `.ant-select-selection-item` declaration with `!important` on both. Second wins for ALL selects (including single-select), rendering tags in accent-blue as if multi-select. |
| B10 | LOW | `hooks/useAgents.ts` | 15 | Stale JSDoc claims `api/agents.ts` helpers "do not yet forward" `AbortSignal`, but `api/agents.ts:19` clearly forwards `signal`. Misleading documentation. |
| B11 | MEDIUM | `pages/WorkflowEditor/index.tsx`, `hooks/useWorkflowAutoSave.ts` | 231-236, 93-94 | `getSaveData` is inline arrow function recreated every render. `useEffect` lists it in dependencies, so interval is cleared/recreated on every render. Auto-save never fires during active editing because 30s countdown restarts on each keystroke. |
| B12 | LOW | Multiple renderers | -- | Silent data truncation in various data renderers (see cross-layer report for details). |

---

## 2. Dead Code / Null Pointers

| # | Severity | File | Lines | Issue |
|---|----------|------|-------|-------|
| D1 | HIGH | `hooks/useFetch.ts` | entire (115 lines) | Entire file never imported anywhere. Whole codebase uses `@tanstack/react-query`. |
| D2 | HIGH | `pages/WorkflowEditor/WorkflowBlockSelectorModal.tsx` | entire | Fully functional component never imported. `index.tsx` uses a minimal inline `BlockSelectorModalShell` instead. |
| D3 | MEDIUM | `components/workflow/SessionBoundarySelector.tsx` | 25 | `const [, setBoundaries] = useState<SessionBoundary[]>([])` — value destructured away, setter called but stored value never read. |
| D4 | MEDIUM | `components/workflow/SessionBoundarySelector.tsx` | 16, 21 | `nodes` prop declared, destructured, passed by parent, but never referenced in component body. |
| D5 | MEDIUM | `components/workflow/WorkflowCanvas.tsx` | 103-105 | `onSelectionChange` is empty function registered via `useOnSelectionChange`. No-op. |
| D6 | MEDIUM | `pages/WorkflowEditor/WorkflowContext.tsx` | 28, 67-72 | `currentWorkflow` / `setCurrentWorkflow` exposed in context but never consumed by any file. |
| D7 | MEDIUM | `pages/WorkflowEditor/WorkflowContext.tsx` | 44, 86-91 | `resetEditor()` defined but never called. |
| D8 | MEDIUM | `store/useUiStore.ts` | 20, 29-31 | `darkMode`, `toggleDarkMode()`, `setDarkMode()` persisted to localStorage but never consumed. `App.tsx` hardcodes `theme.darkAlgorithm`. |
| D9 | MEDIUM | `store/useUiStore.ts` | 22, 33-34 | `currentRoute`, `setCurrentRoute()` never read or called. Route determined via `useLocation()`. |
| D10 | MEDIUM | `pages/WorkflowEditor/index.tsx`, `WorkflowSettingsModal.tsx` | 643-644, 40, 57 | `initialCronExpression` passed through entire call chain but never read in modal — form doesn't display it, save handler hardcodes `nextCron = ''`. |
| D11 | MEDIUM | `api/http.ts` | 285-335 | `apiGetText` and `apiPutText` defined but zero consumers import them. |
| D12 | LOW | `App.tsx` | 108-109 | `pageName()` fallback branch unreachable. All routes matched by preceding if-statements; unknown paths redirected by `<Route path="*">` to `/`. |
| D13 | LOW | `pages/FrameworkAgentDetail.tsx` | 59 | Guard `if (!agent) return <Spin .../>` is unreachable after line 36's `if (error \|\| !agent) return <Alert .../>`. |
| D14 | LOW | `styles/theme.css` | 54-55 | `.btn-gradient` — zero consumers in any component file. |
| D15 | LOW | `styles/theme.css` | -- | `.stat-card` family (5 rules) — never referenced in JSX. |
| D16 | LOW | `styles/theme.css` | -- | `.mini-chart-wrapper` — zero consumers. |
| D17 | LOW | `styles/theme.css` | -- | `.activity-feed-*` (6 rules) — never imported. |
| D18 | LOW | `styles/theme.css` | -- | `.list-row` family (3 rules) — zero consumers. |
| D19 | LOW | `styles/theme.css` | -- | `.actions-row` — zero consumers. |
| D20 | LOW | `styles/theme.css` | -- | `.custom-scroll` — zero consumers. |
| D21 | LOW | `styles/theme.css` | -- | `.scroll-container` — zero consumers. |
| D22 | LOW | `styles/theme.css` | -- | `.markdown-body` — zero consumers. |
| D23 | LOW | `styles/theme.css` | -- | `.status-dot` family (5 rules) — zero consumers. |
| D24 | LOW | `styles/theme.css` | -- | `.status-dot.active` — zero consumers. |
| D25 | LOW | `styles/theme.css` | -- | `@keyframes pulse` — never referenced by any animation-name. |
| D26 | LOW | `styles/theme.css` | -- | Total ~200 lines of dead CSS across all unused rule groups above. |
| D27 | MEDIUM | `hooks/useDashboardData.ts` | 44-47 | `listServers` query runs every 30s but `Dashboard.tsx:20` never destructures `servers`. Wasted network call. |
| D28 | LOW | `pages/ChatPage/MessageThread.tsx` | 64 | `onLoadMore` prop in `MessageThreadProps` never destructured or called. TODO says "currently unused." |

---

## 3. Redundant Design

| # | Severity | File | Lines | Issue |
|---|----------|------|-------|-------|
| R1 | LOW | `components/dataRenderers/MacroRenderer.tsx` | 43 | Regex `/date\|日期\|月份\|月份\|时间/` contains `月份` twice (duplicate alternation). |
| R2 | MEDIUM | `pages/ChatPage/MessageBubble.tsx`, `MessageThread.tsx` | 32-35, 47-49 | `getExtraType(msg)` helper defined identically in both files. Should be shared. |
| R3 | MEDIUM | `pages/ChatPage/MessageBubble.tsx`, `MessageThread.tsx` | 21-25, 38-44 | `ChatMessage` type (extending `Message` with `_struck`, `_latestWorkflow`) defined identically in both files. |
| R4 | LOW | `pages/ExecutionTimeline.tsx`, `pages/NodeDataPanel.tsx` | 30-34, 29-33 | `jsonPreview` helper duplicated with different `maxLen` defaults (200 vs 300) and different formatting. |
| R5 | LOW | `pages/WorkflowEditor/index.tsx`, `AgentPalettePanel.tsx` | 440-444, 59-63 | Built-in node list (`input`, `output`, `debate`) defined in both places. |
| R6 | LOW | `pages/WorkflowEditor/WorkflowCanvasPanel.tsx`, `NodeInspector.tsx` | 64-69, 71-76 | `PROMPT_TYPE_ICONS` and `PROMPT_TYPE_OPTIONS` both map `PromptType` values to emoji icons. |
| R7 | LOW | `pages/WorkflowEditor/properties/InputNodePropertiesPanel.tsx` | 31 | Local `InputNode` type alias shadows identical export from `index.tsx line 113`. |
| R8 | LOW | `pages/WorkflowEditor/properties/OutputNodePropertiesPanel.tsx` | 22 | Local `OutputNode` type alias shadows identical export from `index.tsx line 114`. |
| R9 | LOW | `components/workflow/WorkflowCanvas.tsx` | 96-98 | `sessionBoundaryId` and `sessionBoundaryColor` written to every node's `data` but no node component ever reads these properties. |
| R10 | LOW | `pages/WorkflowEditor/index.tsx` | 88 | `AgentNode` type has `agent?: string` at top-level AND `agentType` in `AgentNodeData` — both always set to same value. Top-level `agent` never read. |
| R11 | LOW | `WorkflowCanvasPanel.tsx`, `index.tsx` | 240-246, 246-251 | `defaultEdgeOptions` with `type: 'smoothstep'`, `animated: true`, and stroke style duplicated by explicit `onConnect` styling. |
| R12 | LOW | `WorkflowCanvasPanel.tsx` | 224-226 | `handlePaneClick` is no-op wrapper `useCallback(() => { onPaneClick?.(); }, [onPaneClick])`. Could pass `onPaneClick` directly. |
| R13 | LOW | `pages/WorkflowList.tsx` | 42-43 | `const createWorkflow = createMutation.mutate; const deleteWorkflow = deleteMutation.mutate` — used exactly once each. |
| R14 | LOW | `App.tsx` | 97-98, 82 | `SIDEBAR_WIDTH`, `SIDEBAR_COLLAPSED_WIDTH`, `agentsPaths` declared inside component body, re-allocated every render. |
| R15 | LOW | `pages/FrameworkPage.tsx` | 44 | `const loading = wfLoading` — unnecessary alias. |
| R16 | LOW | `hooks/useAgentsPage.ts` | 51 | `const CHUNK_SIZE = 4;` defined inside hook body. Should be module-level constant. |
| R17 | LOW | `hooks/useChatConversations.ts` | 43 | After `setCurrentConversation(conv)` already sets `messages: []`, `setMessages([])` called immediately after. Double reset. |
| R18 | LOW | `MacroRenderer.tsx` | 48-50 | `dateKey ?? ''` and `valueKey ?? ''` unnecessary since both guaranteed non-null by `\|\| keys[0]` / `\|\| keys[1]` fallbacks above. |
| R19 | LOW | `WorkflowCanvas.tsx` | 87-88 | `getInitialNodes()` and `getInitialEdges()` called on every render but only consumed once. Should use lazy initializers. |
| R20 | LOW | `App.tsx` | 67 | `refetchOnWindowFocus: true` is React Query default. Explicitly setting is redundant. |
| R21 | LOW | `styles/theme.css` | 54-55 | `--font-display` and `--font-body` are identical font stacks. Single `--font-primary` suffices. |
| R22 | LOW | `styles/theme.css` | 321-326 | `.ant-table-tbody > tr:hover > td` and `.ant-table-tbody > tr.ant-table-row:hover > td` match exactly same elements. |
| R23 | LOW | `styles/theme.css` | 112-125, 933-944, 1098-1116 | Three separate near-identical scrollbar style blocks. |
| R24 | LOW | `FrameworkPage.tsx` | 82-86 | `statusIcons` maps `draft` to `PauseCircleOutlined`. Draft hasn't started; file/edit icon more semantic. |
| R25 | LOW | `api/http.ts` | 341 | Re-exports `API_V1_BASE` from config/env.ts, creating two import paths for same constant. |

---

## 4. Unreasonable Design / Missing Interfaces

| # | Severity | File | Lines | Issue |
|---|----------|------|-------|-------|
| U1 | HIGH | `hooks/useDashboardData.ts` | 75-76 | `isLoading: results.some((r) => r.isLoading)` and `isError: results.some((r) => r.isError)`. Single query failure causes entire Dashboard to show error, even if other data loaded. All-or-nothing. |
| U2 | MEDIUM | `WorkflowSettingsModal.tsx` | 90-94 | Config spread `config: { ... }` completely replaces config instead of merging. Future backend config fields silently dropped. |
| U3 | MEDIUM | `FrameworkPage.tsx` | 189 | `workflows.slice(0, 10)` with `pagination={false}` silently drops records beyond row 10. No "show more" control. |
| U4 | MEDIUM | `pages/WorkflowEditor/index.tsx` | 330-341 | `onDeleteBlock` reads `nodes` from stale closure instead of using `setNodes` updater pattern. Vulnerable in batched state updates. |
| U5 | MEDIUM | `useSessionBoundary.ts` | 137 | `createBoundary` callback includes `options` in dep array. Callers pass inline object literals, creating new references every render. |
| U6 | LOW | `CronEditor.tsx` | 290 | `useEffect` omits `onChange` from dep array (eslint-disable). If parent replaces `onChange`, new handler is stale closure. |
| U7 | HIGH | `MessageThread.tsx` | 101-189 | Six derived datasets computed inline on every render, each iterating full `messages` array (5 O(n) scans per render). No `useMemo`. |
| U8 | MEDIUM | `ConversationSidebar.tsx` | 80-81 | Hover tracking via React state (`hoveredId`) causes every row to re-render on any row hover. Pure CSS `:hover` avoids this. |
| U9 | MEDIUM | `ChatPage/index.tsx` | 68-71 | `useAgents()` and `useWorkflows()` called unconditionally even when no conversation selected. Triggers unnecessary HTTP requests on empty state. |
| U10 | MEDIUM | `hooks/useExecutions.ts` | -- | Returns raw `UseQueryResult` (`.isLoading`, `.isError`) while all other domain hooks normalize to `{ data, loading, error, refetch }`. Inconsistent API. |
| U11 | MEDIUM | `hooks/useWorkflows.ts` | 52 | Default `limit=1000` contradicts API layer default of 50. JSDoc claims "matches backend default" — wrong. |
| U12 | LOW | `InputNodePropertiesPanel.tsx` vs `AgentNodePropertiesPanel.tsx` | -- | Inconsistent edit patterns: AgentNode uses local `paramRows` mirror to buffer edits; InputNode commits every keystroke directly. |
| U13 | LOW | `styles/theme.css` | 833-840 | `.fade-in-N` delay classes depend on `.fade-in` base class. Applying only `.fade-in-2` without `.fade-in` yields no animation. |
| U14 | MEDIUM | `useDashboardData.ts` | 36-53 | `listAgents()` and health check don't propagate React Query's `AbortSignal`. In-flight requests can't be aborted on unmount. |
| U15 | MEDIUM | `useAgentsPage.ts` | 53-69 | Chunked whitelist fetching silently catches failures per agent. Users see `'...'` permanently for any failed agent fetch with no retry indication. |
| U16 | LOW | `AgentsPage/index.tsx` | 77 | Error alert `closable` with `onClose={() => refetchAgents()}` means dismissing error also triggers retry. Conflated actions. |
| U17 | LOW | `ToolsPage.tsx` | 27 | Disabled Switch in "启用" column is purely decorative. Tag would be more honest. |
| U18 | LOW | `ToolsPage.tsx` | 48 | Refresh button (spinning icon) and Table (spinner overlay) show loading simultaneously. Redundant. |
| U19 | LOW | `AgentPalettePanel.tsx` | 110-111 | Heading and subtitle show same text because `agent.type` and `agent.label` both map to `a.name`. |
| U20 | LOW | `StatCards.tsx` | 29 | `xs={8}` forces 3-column on smallest screens. Cards may be unreadable below 576px. |
| U21 | LOW | `AgentPerformancePanel.tsx` | 44 | Redundant border on expanded non-last items creates visual double-border. |
| U22 | LOW | `NodeDataPanel.tsx` | 157, 179 | Uses deprecated Ant Design v5 `bodyStyle` prop. Produces runtime deprecation warning. |
| U23 | LOW | `ChatInput.tsx` | 89-105 | Mode toggle: clicking Agent when already in agent mode calls `onModeChange('agent')` — no-op state update that still triggers re-render. |
| U24 | MEDIUM | `FrameworkAgentDetail.tsx` | 14-17, 60 | `AgentDetailViewModel` works around mismatched backend types instead of fixing canonical types. |
| U25 | MEDIUM | `WorkflowMonitor.tsx` | 180-183, 238-240 | Repeated unsafe type assertions: `execution as (Execution & { nodes?: ApiNodeExec[] })`. Silent breakage if API changes. |
| U26 | LOW | `MessageThread.tsx` | 114-119 | Cast `m.extra_data as { status?: string } \| undefined` assumes structure without runtime validation. |
| U27 | MEDIUM | `useChatConversations.ts` | 18 | `DEFAULT_AGENT_NAME = 'fin-orchestrator'` hardcoded. If orchestrator renamed/removed, new conversations fail silently. |
| U28 | MEDIUM | `SentimentRenderer.tsx` | 35 | Score normalization `score > 1 && score <= 100 ? score : (score + 1) * 50` cannot disambiguate [0,1] vs [-1,1] scales. Score 0.5 on [0,100] scale (0.5%) maps to 75 instead of 0.5. |
| U29 | MEDIUM | `SentimentRenderer.tsx` | 107 | `news.sentiment === 'negative'` / `'positive'` case-sensitive. If API returns `"Negative"` or `"POSITIVE"`, check silently falls through. |
| U30 | MEDIUM | `FredRenderer.tsx` | 39 | `d.value ?? 0` replaces null values with 0. Missing FRED observations render as sharp drops to zero, not honest gaps. |
| U31 | HIGH | `App.tsx` | entire (77-353) | `AppLayout` is monolithic: sidebar, menu state, navigation config, page-name resolver, routing, and page shell. Violates Single Responsibility Principle. |
| U32 | LOW | `App.tsx` | 286-291 | Sidebar collapse uses `onMouseEnter`/`onMouseLeave` DOM events to directly mutate `e.currentTarget.style.color`, bypassing React rendering pipeline. |
| U33 | LOW | `MessageBubble.tsx` | 142-190 | Avatar background color, icon, and bubble styles determined by deeply-nested ternary chains (4+ levels deep), repeated 3 times. Lookup map more maintainable. |
| U34 | LOW | `ChatPage/index.tsx`, `ChatHeader.tsx` | 82, 87, 81-83 | Validation messages mix Chinese and English. |
| U35 | LOW | `pages/WorkflowEditor/index.tsx` | 652-695 | `BlockSelectorModalShell` is non-functional placeholder wired to "选择工作流导入" button. Displays nothing useful but opens modal. |
| U36 | MEDIUM | `useAgentsPage.ts` | 26 | `useWhitelistAgents` does not handle the case where the whitelist API returns an empty list — all agents are shown anyway but the hook still fires requests for zero IDs. |
| U37 | MEDIUM | `ExecutionTimeline.tsx` | 45-52 | Timeline node status logic duplicates `WorkflowMonitor.tsx` status color mapping. Status-to-color mapping defined in three places across the codebase. |
| U38 | MEDIUM | `NodeInspector.tsx` | 88-94 | Data panel falls back to `JSON.stringify(data, null, 2)` for unknown prompt types. Large payloads (>10MB) crash the tab with `RangeError: Invalid string length`. |

---

## 5. Top Fixes (Priority Order)

> **Critical/High items requiring immediate attention:**

| Priority | ID | Summary | Effort |
|----------|----|---------|--------|
| P1 | B1 | Source column `filePath` never populated — column always renders `'---'`. Either remove the column or add `filePath` to the canonical `Agent` domain type. | Low |
| P2 | B3 | `cron_expression` silently dropped on every WorkflowSettingsModal save. `nextCron` is hardcoded to `''`; spread always evaluates to `{}`. | Low |
| P3 | B2 | `allowClear` on Select passes `undefined` to `updateAgent(idx, val)`, corrupting the workflow graph's `agents` array. | Low |
| P4 | B11 | Auto-save interval recreated on every render because `getSaveData` is an inline arrow in the deps array. Never fires during active editing. | Low |
| P5 | D1 | Entire `hooks/useFetch.ts` (115 lines) is dead code — zero imports. Delete file. | Trivial |
| P6 | D2 | Entire `WorkflowBlockSelectorModal.tsx` never imported. Delete or wire up. | Trivial |
| P7 | U1 | Dashboard all-or-nothing error handling: single query failure takes down all panels. Use per-query error boundaries. | Medium |
| P8 | U7 | `MessageThread.tsx` runs 5 O(n) scans of `messages` on every render with no `useMemo`. | Low |
| P9 | U31 | `App.tsx` `AppLayout` is a monolithic 276-line component violating SRP. Extract sidebar, nav config, page shell. | Medium |

---

## Executive Summary

```
Layer:         WebUI Frontend (project/src/webui/src/)
Total Issues:  103
  Bugs:             12  (3 HIGH, 6 MEDIUM, 3 LOW)
  Dead Code:        27  (2 HIGH, 10 MEDIUM, 15 LOW)
  Redundant:        26  (0 HIGH, 2 MEDIUM, 24 LOW)
  Unreasonable:     38  (3 HIGH, 18 MEDIUM, 17 LOW)

Top Concerns:
  1. Data integrity bugs (B1-B3) cause silent data loss or broken columns
  2. 2 entire files are dead code (D1-D2), ~200 lines of dead CSS (D14-D26)
  3. Monolithic AppLayout (U31) impedes all future layout changes
  4. Auto-save (B11) and cron persistence (B3) entirely non-functional
  5. Duplicated types/helpers (R2-R3) create maintenance surface area
```

---

*Report generated 2026-06-25. All file paths are relative to `project/src/webui/src/`.*
