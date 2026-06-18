/**
 * Canonical Agent types + view-models.
 *
 * Consolidated from 4 previously-duplicated declarations:
 * - ChatPage.tsx (Agent)
 * - AgentsPage.tsx (AgentMeta)
 * - WorkflowEditor.tsx (PaletteAgent)
 * - FrameworkAgentDetail.tsx (AgentDetail)
 *
 * The canonical `Agent` mirrors the backend `_to_summary()` shape from
 * `framework/services/agent_query_service.py` (with the optional
 * `system_prompt`, `model`, `tools_whitelist`, and `tags` fields that
 * the registry carries but the public API does not always surface).
 *
 * View-models use `Pick<>` over the canonical type so renaming a field
 * on `Agent` automatically propagates to every consumer.
 */

/**
 * Canonical Agent shape — the union of every field the backend can return
 * or the frontend can display. View-models below derive from this.
 *
 * `mode` is a string-literal union to keep editor autocomplete honest; the
 * backend sometimes returns the raw value before the registry has
 * normalised it, so we document the canonical set here.
 */
export interface Agent {
  /** Registry key, e.g. "Macro-Scout". */
  name: string;
  /** Human-readable one-liner. */
  description: string;
  /**
   * Agent role:
   * - `primary` — top-level orchestrator
   * - `subagent` — invoked by a primary or workflow
   * - `debate` — participant in a debate node
   */
  mode: 'primary' | 'subagent' | 'debate';

  /** Optional system prompt (registry-only, not on the public API). */
  system_prompt?: string;
  /** Optional model identifier the agent is bound to. */
  model?: string;
  /** Optional tools-whitelist (subset of MCP server tools the agent may call). */
  tools_whitelist?: string[];
  /** Optional free-form tags for grouping in the UI. */
  tags?: string[];
}

/**
 * Table-row projection of an Agent — what `AgentsPage` lists in its
 * Ant Design table. Mirrors the original `AgentMeta` declaration.
 */
export type AgentMeta = Pick<Agent, 'name' | 'description' | 'mode'>;

/**
 * Drilldown view-model used by `FrameworkAgentDetail`. Adds execution
 * telemetry to the canonical Agent.
 *
 * - `executions` — total execution count
 * - `success_rate` — percent (0-100) of completed vs failed
 * - `last_active` — ISO timestamp of most recent invocation
 */
export type AgentDetail = Agent & {
  executions?: number;
  success_rate?: number;
  last_active?: string;
};

/**
 * Drag-drop palette entry used by `WorkflowEditor`. Adds a UI-only
 * `color` hint for the node chrome. Palette special-cases
 * (input/output/debate) live alongside in `BUILTIN_NODES`, not in this
 * shared type.
 */
export type PaletteAgent = Pick<Agent, 'name' | 'description' | 'mode'> & {
  color?: string;
};

/**
 * MCP tool descriptor — surfaced in the agent-detail tool list and the
 * agents-page tool manager. `server` and `category` are optional because
 * some callers only have a flat name/description pair.
 */
export interface ToolItem {
  /** Tool key as registered with the MCP server. */
  name: string;
  /** Human-readable one-liner describing what the tool does. */
  description: string;
  /** Originating MCP server (e.g. "ashare-mcp-server", "fred-mcp-server"). Empty for builtins. */
  server?: string;
  /** UI grouping label (e.g. "行情", "风控"). */
  category?: string;
  /** Tool source: builtin (Read/Edit/Bash), mcp (MCP server), or custom (user-defined). */
  source?: 'builtin' | 'mcp' | 'custom';
  /** Whether the tool is enabled. */
  enabled?: boolean;
}
