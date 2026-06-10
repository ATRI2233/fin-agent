# PHASE 4 — Frontend 5-Layer Architecture Refactor

**Status**: DRAFT (awaiting Start Work approval)
**Branch**: `phase4-frontend-refactor`
**Plan file**: `.omo/plans/phase4-frontend-refactor.md`
**Predecessor**: PHASE 3 backend (tag: `phase3-complete`)
**Working dir**: `D:\github_place\fin-agent\project\webui\`

---

## 0. Background & Rationale

### Why this phase
PHASE 3 backend is complete (`phase3-complete` tag). The frontend (`webui/`) has accumulated technical debt that blocks maintainability:

| Issue | Evidence | Impact |
|---|---|---|
| 96 raw `fetch()` calls in 20 files | grep `fetch(` | No error normalization, no typing, no abort, no retry, no auth header standardization |
| 0 state management library | grep `zustand` in `package.json` deps = NO | Pure `useState`/`useEffect` everywhere, 73 `useState` calls, cross-page state via prop drilling or duplicated fetches |
| 0 types/ directory | 83 inline interface/type declarations | 5 duplicate `Agent` shapes, 5 duplicate `Workflow` shapes, 3 duplicate `NodeExec` |
| 3 God Components | `WorkflowEditor.tsx` (1563 lines), `AgentsPage.tsx` (941), `ChatPage.tsx` (834) | Single-file components with 25 useState, 13 fetch, 10 inline sub-components |
| 4 hardcoded base URLs | `Dashboard.tsx:18`, `ChatPage.tsx:65`, `InfoPage.tsx:14`, `InfoSettingsPage.tsx:19` | No env-driven config, no `.env*` files |
| 0 `config/` directory | Only `vite.config.ts` proxy | Backend URLs hardcoded everywhere |
| 0 `api/` directory | Direct `fetch` calls | No typed client, no request/response contracts enforced |

### User-confirmed scope (interview)
- **Branch**: `phase4-frontend-refactor` (separate from PHASE 3 backend)
- **Goal**: Replace frontend tech debt with 5-layer architecture
- **Stack**: React 18, TypeScript, Ant Design 5, React Flow, Vite
- **New deps**: zustand (already transitive v4.5.7), no axios (use typed fetch wrapper)
- **Estimated**: 15-20 hours of refactor work, 6 waves

### Out of scope (deferred to PHASE 5+)
- Backend Pydantic schema extraction to `main/framework/schemas/*.py` (frontend types depend on this for `openapi-typescript` codegen — but we can use the current state and iterate)
- SSE/WebSocket for ChatPage polling (current 2s poll is adequate)
- React component testing (vitest + RTL setup)
- Storybook for component library
- E2E tests (Playwright)
- Performance optimization (code splitting, lazy loading)
- Accessibility audit (ARIA, keyboard nav)

### Risk register
1. **Type alignment drift** — backend Pydantic models may change; frontend types must stay synced. Mitigation: type files named with `_v1` suffix, lock to OpenAPI snapshot.
2. **ChatPage polling breakage** — refactoring the polling loop incorrectly could break message flow. Mitigation: preserve exact 2s/120-poll semantics, write integration test first.
3. **WorkflowEditor ReactFlow integration** — 1563 lines with ReactFlow internals; splitting risks breaking drag/drop, auto-save, edge connections. Mitigation: split with `git diff` checkpointing, preserve all useEffect deps.
4. **Module resolution changes** — Vite may need `tsconfig.json` `paths` updates for `src/types/*` etc. Mitigation: configure `paths` in `tsconfig.json` AND `vite.config.ts` alias.
5. **Circular imports** — `api/` → `types/`, `hooks/` → `api/` + `store/` + `types/`. Mitigation: `types/` has zero imports; `api/` only imports `types/`; `hooks/` only imports `api/` + `types/` + `store/`.

### Latent bugs found (fix opportunistically during refactor)
1. `WorkflowMonitor.tsx:120` — `/api/v1/workflow/executions/{id}/status` (singular `workflow`) → should be `/api/v1/executions/{id}/status`
2. `Dashboard.tsx:127` — `/api/v1/health` called but no controller defines it
3. `FrameworkAgentDetail.tsx:64,89` — `/api/v1/jobs` called but no such route
4. `useSessionBoundary.ts:76` — `/api/workflow/session-boundary` (no `/v1`) routes to OpenCode proxy, not framework
5. `WorkflowList.tsx`, `WorkflowSettings.tsx` — `/api/v1/workflows/{id}/copy` doesn't exist
6. 8 inline Pydantic schemas in controllers need extraction to `main/framework/schemas/`

---

## 1. Definition of Done

- [ ] `src/config/env.ts` exports `API_V1_BASE`, `OPENCODE_API_BASE`, `MAINTENANCE_API_BASE` from `import.meta.env`
- [ ] `src/types/` directory created with 7 type files (conversation, workflow, agent, execution, system, ui, api-error)
- [ ] `src/api/client.ts` typed fetch wrapper (abort signal, JSON parse, ProblemDetail error normalization)
- [ ] 9 per-resource API modules: `src/api/{conversations,workflows,agents,executions,system,sessions,tools,skills,maintenance}.ts`
- [ ] 0 raw `fetch(` calls in components/pages (verified by grep)
- [ ] `zustand` promoted to direct dependency in `package.json`
- [ ] 3+ zustand stores: `useUiStore`, `useConversationStore`, `useWorkflowStore`
- [ ] `src/hooks/` directory with `useFetch<T>`, `useMutation<T>`, and 5+ resource-specific hooks
- [ ] `WorkflowEditor.tsx` split into 14 sub-files, all <300 lines each
- [ ] `AgentsPage.tsx` split into 9 sub-files, all <300 lines each
- [ ] `ChatPage.tsx` split into 8 sub-files, all <300 lines each
- [ ] 5 latent bugs fixed
- [ ] `tsc --noEmit` exits 0
- [ ] `npm run build` succeeds
- [ ] `eslint .` exits 0
- [ ] Branch tagged `phase4-complete`
- [ ] `git log --oneline phase3-complete..HEAD` shows wave-by-wave commits

---

## 2. Task Breakdown (50 tasks across 6 waves + Final Wave)

### Wave 1 — Foundation: types/, config/, store/ setup (10 tasks)

**Parallelization**: Tasks 1.1-1.4 (types extraction) and 1.5-1.7 (config) are parallel. Tasks 1.8-1.10 (store) depend on types.

- [ ] **1.1** Create `src/types/api-error.ts` — RFC 7807 ProblemDetail matching `main/framework/api/problems.py:1-30`
- [ ] **1.2** Create `src/types/conversation.ts` — extract from `ChatPage.tsx:31-50`, align with `schemas/conversation.py:148-239`
- [ ] **1.3** Create `src/types/agent.ts` — consolidate 5 Agent shapes (Agent, AgentMeta, AgentDetail, PaletteAgent, AgentInfo)
- [ ] **1.4** Create `src/types/workflow.ts` — consolidate 5 Workflow shapes + 3 NodeExec shapes + EdgePrompt
- [ ] **1.5** Create `src/types/execution.ts` — extract from `WorkflowMonitor.tsx`, `NodeDataPanel.tsx`, `ExecutionTimeline.tsx`
- [ ] **1.6** Create `src/types/system.ts` — consolidate SystemStatus (2 duplicates) + WorkflowStats (2 duplicates)
- [ ] **1.7** Create `src/types/ui.ts` — UI-only types: ToolItem, AgentMode, FormState, ModalState
- [ ] **1.8** Add `envPrefix: 'VITE_'` to `vite.config.ts` + create `src/vite-env.d.ts` for `import.meta.env` types
- [ ] **1.9** Create `src/config/env.ts` — export `API_V1_BASE`, `OPENCODE_API_BASE`, `MAINTENANCE_API_BASE`
- [ ] **1.10** Update 4 hardcoded constant sites to import from `config/env.ts` (Dashboard, ChatPage, InfoPage, InfoSettingsPage)

**Wave 1 commit**: `chore(phase4-w1): types foundation + env-driven config`
**Wave 1 tag**: `phase4-wave-1-complete`

---

### Wave 2 — api/ layer: client + 9 resource modules (10 tasks)

**Parallelization**: Tasks 2.1 (client) blocks 2.2-2.10. All 2.2-2.10 are parallel (different files).

- [ ] **2.1** Create `src/api/client.ts` — typed fetch wrapper:
  - `apiGet<T>(url, signal?)`, `apiPost<T>(url, body, signal?)`, `apiPut<T>(url, body)`, `apiDelete<T>(url)`
  - AbortSignal support
  - ProblemDetail error class (matches `api/types/api-error.ts`)
  - Network error wrapping
- [ ] **2.2** Create `src/api/conversations.ts` — 7 functions matching `controllers/conversations.py:62-176`
- [ ] **2.3** Create `src/api/workflows.ts` — 7 functions + 3 scheduler functions (matches `controllers/workflows.py:99-257` + `controllers/scheduler.py:16-48`)
- [ ] **2.4** Create `src/api/agents.ts` — 3 functions (matches `controllers/agents.py:28-72`)
- [ ] **2.5** Create `src/api/executions.ts` — 5 functions (matches `controllers/executions.py:67-202`)
- [ ] **2.6** Create `src/api/sessions.ts` — 4 functions (matches `controllers/sessions.py:55-181`)
- [ ] **2.7** Create `src/api/system.ts` — 3 functions (matches `controllers/system.py:132-164`)
- [ ] **2.8** Create `src/api/tools.ts` — 3 functions (matches `controllers/tools.py:18-48`)
- [ ] **2.9** Create `src/api/skills.ts` — 2 functions (matches `controllers/skills.py:46-50`)
- [ ] **2.10** Create `src/api/maintenance.ts` — 8 functions (matches `data_maintenance/controllers/data_maintenance.py:57-128`)

**Wave 2 commit**: `feat(phase4-w2): typed api client + 9 resource modules`
**Wave 2 tag**: `phase4-wave-2-complete`

---

### Wave 3 — Fetch migration: replace 96 raw fetch calls (10 tasks)

**Parallelization**: Tasks 3.1-3.10 are parallel (different files, max 4-10 constraint).

- [ ] **3.1** Migrate `pages/ChatPage.tsx` (8 fetch calls) — use `api/conversations.ts` + `api/agents.ts` + `api/workflows.ts`
- [ ] **3.2** Migrate `pages/Dashboard.tsx` (6 fetch calls + 9 in `Promise.allSettled`) — use `api/system.ts`
- [ ] **3.3** Migrate `pages/AgentsPage.tsx` (13 fetch calls) — use `api/agents.ts`
- [ ] **3.4** Migrate `pages/WorkflowEditor.tsx` (12 fetch calls) — use `api/workflows.ts` + `api/agents.ts`
- [ ] **3.5** Migrate `pages/InfoSettingsPage.tsx` (9 fetch calls) — use `api/maintenance.ts`
- [ ] **3.6** Migrate `pages/SkillsPage.tsx` (9 fetch calls) — use `api/skills.ts`
- [ ] **3.7** Migrate `pages/MCPServersPage.tsx` (8 fetch calls) — use OpenCode proxy helpers (out of repo scope but typed wrapper)
- [ ] **3.8** Migrate `pages/ProvidersPage.tsx` (5 fetch calls) — OpenCode proxy typed wrapper
- [ ] **3.9** Migrate `pages/WorkflowSettings.tsx` (6 fetch calls) + `WorkflowList.tsx` (4) — use `api/workflows.ts`
- [ ] **3.10** Migrate remaining 8 files (`FrameworkAgentDetail`, `PermissionsPage`, `ToolsPage`, `ConfigRawEditor`, `InfoPage`, `FrameworkPage`, `SessionsPage`, `RulesEditor`, `useSessionBoundary`) — total ~20 fetch calls

**Wave 3 commit**: `refactor(phase4-w3): replace 96 raw fetch with typed api/ layer`
**Wave 3 tag**: `phase4-wave-3-complete`

---

### Wave 4 — Store layer: zustand stores (5 tasks)

**Parallelization**: Tasks 4.1-4.5 are parallel (different stores, no shared deps).

- [ ] **4.1** Promote `zustand` to direct dep: `npm install zustand@^4.5.7` (already transitive)
- [ ] **4.2** Create `src/store/useUiStore.ts` — sidebar collapsed state (currently `App.tsx:92` `useState`), dark mode toggle, current route
- [ ] **4.3** Create `src/store/useConversationStore.ts` — `currentConversation: Conversation | null`, `setCurrentConversation` (replaces `ChatPage.tsx:283` + shared with `SessionsPage.tsx`)
- [ ] **4.4** Create `src/store/useWorkflowStore.ts` — `currentWorkflow: Workflow | null`, `selectedNodeId`, `selectedEdgeId` (replaces `WorkflowEditor.tsx:988-997`)
- [ ] **4.5** Migrate consumers — `App.tsx` (useUiStore for sidebar), `ChatPage.tsx` (useConversationStore), `WorkflowEditor.tsx` (useWorkflowStore)

**Wave 4 commit**: `feat(phase4-w4): zustand stores (ui, conversation, workflow)`
**Wave 4 tag**: `phase4-wave-4-complete`

---

### Wave 5 — Hooks layer: useFetch/useMutation + resource hooks (5 tasks)

**Parallelization**: Tasks 5.1 (generic) blocks 5.2-5.5. All 5.2-5.5 are parallel.

- [ ] **5.1** Create `src/hooks/useFetch.ts` + `useMutation.ts` — generic typed hooks with abort, error, loading states
- [ ] **5.2** Create `src/hooks/useConversations.ts` — wraps `api/conversations.ts` with `useFetch` + mutation helpers
- [ ] **5.3** Create `src/hooks/useWorkflows.ts` — list + single + trigger + schedule mutations
- [ ] **5.4** Create `src/hooks/useAgents.ts` — list + stats + tools whitelist
- [ ] **5.5** Migrate `components/workflow/useSessionBoundary.ts` (93 lines) to use the new typed pattern

**Wave 5 commit**: `feat(phase4-w5): generic useFetch/useMutation + resource hooks`
**Wave 5 tag**: `phase4-wave-5-complete`

---

### Wave 6 — God Component splits (3 tasks, sequential by component)

**Parallelization**: 3 God Components split SEQUENTIALLY (each is large, sequential is safer).

- [ ] **6.1** Split `ChatPage.tsx` (834 lines) → 8 sub-files:
  - `pages/ChatPage/index.tsx` (≤100 lines, orchestrator)
  - `pages/ChatPage/ConversationSidebar.tsx`
  - `pages/ChatPage/MessageThread.tsx`
  - `pages/ChatPage/ChatInput.tsx`
  - `pages/ChatPage/MessageBubble.tsx`
  - `pages/ChatPage/hooks/useConversationPolling.ts`
  - `pages/ChatPage/hooks/useConversations.ts`
  - `pages/ChatPage/hooks/useMessages.ts`
- [ ] **6.2** Split `AgentsPage.tsx` (941 lines) → 9 sub-files:
  - `pages/AgentsPage/index.tsx` (≤150 lines)
  - `pages/AgentsPage/ViewAgentModal.tsx`
  - `pages/AgentsPage/EditAgentModal.tsx`
  - `pages/AgentsPage/CreateAgentModal.tsx`
  - `pages/AgentsPage/BatchModelModal.tsx`
  - `pages/AgentsPage/hooks/useAgents.ts`
  - `pages/AgentsPage/hooks/useAgentTools.ts`
  - `pages/AgentsPage/hooks/useAgentModels.ts`
  - `pages/AgentsPage/columns.tsx`
- [ ] **6.3** Split `WorkflowEditor.tsx` (1563 lines) → 14 sub-files:
  - `pages/WorkflowEditor/index.tsx` (≤200 lines)
  - `pages/WorkflowEditor/WorkflowCanvasPanel.tsx`
  - `pages/WorkflowEditor/AgentPalettePanel.tsx`
  - `pages/WorkflowEditor/NodeInspector.tsx`
  - `pages/WorkflowEditor/properties/{AgentNode,DebateNode,InputNode,OutputNode,WorkflowBlockNode}PropertiesPanel.tsx` (5 files)
  - `pages/WorkflowEditor/EdgePromptEditor.tsx`
  - `pages/WorkflowEditor/WorkflowSettingsModal.tsx`
  - `pages/WorkflowEditor/WorkflowBlockSelectorModal.tsx`
  - `pages/WorkflowEditor/hooks/useWorkflowAutoSave.ts`
  - `pages/WorkflowEditor/hooks/usePaletteAgents.ts`
  - `pages/WorkflowEditor/hooks/useWorkflowLoader.ts`

**Wave 6 commit**: `refactor(phase4-w6): split 3 God Components into sub-files`
**Wave 6 tag**: `phase4-wave-6-complete`

---

### Final Verification Wave (4 tasks, parallel)

- [ ] **F1** Plan Compliance Audit — verify all DoD items
- [ ] **F2** Code Quality Review — `tsc --noEmit`, `eslint .`, `npm run build`, file sizes (<300 lines each)
- [ ] **F3** Real Manual QA — open browser, test 5 representative pages, verify no regression
- [ ] **F4** Scope Fidelity Review — no out-of-scope changes

---

## 3. Plan Analysis

```
TASK ANALYSIS:
- Total tasks: 54 (50 implementation + 4 final wave)

WAVE PARALLELIZATION:
- Wave 1: 10 tasks — 4 parallel (types) + 3 parallel (config) + 3 parallel (store/setup) = 3 batches
- Wave 2: 10 tasks — 1 client first, then 9 parallel resources
- Wave 3: 10 tasks — 10 parallel migrations
- Wave 4: 5 tasks — 1 install, 4 parallel stores
- Wave 5: 5 tasks — 1 generic, then 4 parallel resource hooks
- Wave 6: 3 tasks — SEQUENTIAL (each is large)
- Final Wave: 4 tasks — 4 parallel

MINIMUM PARALLEL BATCH: 5 (Wave 1 types extraction)
MAXIMUM PARALLEL BATCH: 10 (Wave 3 fetch migration)
```

---

## 4. Tag & Branch Strategy

| Event | Tag | Branch |
|---|---|---|
| Plan approved | — | `phase4-frontend-refactor` (cut from `phase3-complete`) |
| Wave 1 done | `phase4-wave-1-complete` | — |
| Wave 2 done | `phase4-wave-2-complete` | — |
| Wave 3 done | `phase4-wave-3-complete` | — |
| Wave 4 done | `phase4-wave-4-complete` | — |
| Wave 5 done | `phase4-wave-5-complete` | — |
| Wave 6 done | `phase4-wave-6-complete` | — |
| Final Wave passed | `phase4-complete` | (ready for merge) |

---

## 5. Estimated Effort

| Wave | Tasks | Wall-clock estimate |
|---|---|---|
| W1 | 10 | ~1.5 hours (types + config) |
| W2 | 10 | ~3 hours (client + 9 resource modules) |
| W3 | 10 | ~2 hours (96 fetch migrations) |
| W4 | 5 | ~1 hour (zustand stores) |
| W5 | 5 | ~1.5 hours (generic + resource hooks) |
| W6 | 3 | ~6 hours (3 God Components, sequential) |
| FW | 4 | ~1 hour (4 parallel reviews) |
| **Total** | **47** | **~16 hours** |

---

## 6. Open Decisions (resolve before W1 starts)

- [ ] **W1.4 Workflow types scope**: include `WorkflowBlockNode` shape (used in `WorkflowEditor.tsx:117`) or defer to `WorkflowBlock` backend schema (not yet extracted)?
- [ ] **W4 zustand version**: v4.5.7 (transitive, stable) or v5.x (latest, breaking changes)?
- [ ] **W2 fetch wrapper**: native `fetch` + custom wrapper OR `ky`/`wretch` library?
- [ ] **W6 split granularity**: full split (8/9/14 files) OR conservative split (4-5 files each)?

---

## 7. Ready to Start?

Two paths forward:

### A. Start Work (recommended)
- Cut branch `phase4-frontend-refactor` from `phase3-complete`
- Initialize boulder
- Dispatch Wave 1 (10 tasks, 3 parallel batches)

### B. Refine Plan First
- Adjust scope, reorder waves, split/merge tasks
- Resolve the 4 open decisions in section 6
- Re-run planning until you approve
