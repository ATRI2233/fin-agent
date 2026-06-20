/**
 * React Query hooks wrapping `api/opencode.ts` for the OpenCode
 * configuration surface.
 *
 * The underlying `api/opencode.ts` exports only four generic
 * `opencodeGet / opencodePost / opencodePut / opencodeDelete`
 * wrappers — every domain endpoint is composed at the call site by
 * passing a path string (see `pages/MCPServersPage.tsx`,
 * `pages/ProvidersPage.tsx`, `pages/PermissionsPage.tsx`, etc.).
 *
 * This module binds the *paths* used by the framework pages to typed
 * React Query hooks so callers no longer construct URLs by hand.
 * Hook shape follows the conventions established in
 * `hooks/useExecutions.ts`:
 *
 * - Read hooks use `useQuery` with a `queryKey` derived from
 *   `opencodeKeys.<...>()` and forward the `AbortSignal` from
 *   `queryFn` (the underlying wrappers ignore it today, but the
 *   contract is preserved for future migration).
 * - Write hooks use `useMutation` and invalidate
 *   `opencodeKeys.all` on success so dependent queries re-fetch.
 *
 * Domain coverage matches what the existing pages already call:
 * config (scope + raw), providers, permissions, MCP servers,
 * skills, rules, and the agent-models proxy endpoints.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import * as opencodeApi from "../api/opencode";

/* ─── Query key registry ──────────────────────────────────────────── */

export const opencodeKeys = {
  all: ["opencode"] as const,
  configScope: () => [...opencodeKeys.all, "config", "scope"] as const,
  configRaw: (file: string, scope: string) =>
    [...opencodeKeys.all, "config", "raw", file, scope] as const,
  providers: () => [...opencodeKeys.all, "providers"] as const,
  permissions: () => [...opencodeKeys.all, "permissions"] as const,
  mcpServers: (scope: string) =>
    [...opencodeKeys.all, "mcp", "servers", scope] as const,
  skills: (scope: string) =>
    [...opencodeKeys.all, "skills", scope] as const,
  skillContent: (name: string, scope: string) =>
    [...opencodeKeys.all, "skills", "content", name, scope] as const,
  rules: () => [...opencodeKeys.all, "rules"] as const,
  agentModels: () => [...opencodeKeys.all, "agents", "models"] as const,
};

/* ─── Read hooks ──────────────────────────────────────────────────── */

/**
 * `GET /config/scope` — returns the active scope for each subsystem
 * (e.g. `{ mcp: "user" | "project" }`). Used by MCPServersPage and
 * SkillsPage on mount.
 */
export function useOpencodeConfigScope() {
  return useQuery({
    queryKey: opencodeKeys.configScope(),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      opencodeApi.opencodeGet<{ mcp?: string; skills?: string }>(
        "/config/scope",
      ),
  });
}

/**
 * `GET /config/<file>?scope=<scope>` — raw config blob for the
 * Monaco-backed raw editor (ConfigRawEditor.tsx).
 */
export function useOpencodeConfigRaw(
  file: string | undefined,
  scope: string,
) {
  return useQuery({
    queryKey: opencodeKeys.configRaw(file ?? "", scope),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      opencodeApi.opencodeGet<Record<string, unknown>>(
        `/config/${file}?scope=${scope}`,
      ),
    enabled: !!file,
  });
}

/**
 * `GET /providers` — provider registry used by ProvidersPage.
 */
export function useOpencodeProviders() {
  return useQuery({
    queryKey: opencodeKeys.providers(),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      opencodeApi.opencodeGet<Record<string, unknown>>("/providers"),
  });
}

/**
 * `GET /permissions` — permission rules + default action consumed by
 * PermissionsPage.
 */
export function useOpencodePermissions() {
  return useQuery({
    queryKey: opencodeKeys.permissions(),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      opencodeApi.opencodeGet<{
        rules: unknown[];
        defaultAction: string;
      }>("/permissions"),
  });
}

/**
 * `GET /mcp?scope=<scope>` — list MCP servers for the given scope.
 * Wraps the dictionary shape returned by the proxy into an array of
 * `{ name, ...config }` rows expected by MCPServersPage.
 */
export function useOpencodeMcpServers<TConfig>(
  scope: string,
) {
  return useQuery({
    queryKey: opencodeKeys.mcpServers(scope),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      opencodeApi.opencodeGet<Record<string, TConfig>>(
        `/mcp?scope=${scope}`,
      ),
  });
}

/**
 * `GET /skills?scope=<scope>` — list skill metadata for the given
 * scope (SkillsPage).
 */
export function useOpencodeSkills<TMeta>(scope: string) {
  return useQuery({
    queryKey: opencodeKeys.skills(scope),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      opencodeApi.opencodeGet<{ skills?: TMeta[] }>(
        `/skills?scope=${scope}`,
      ),
  });
}

/**
 * `GET /skills/<name>/content?scope=<scope>` — full skill body for
 * view / edit modals in SkillsPage.
 */
export function useOpencodeSkillContent<TContent>(
  name: string | undefined,
  scope: string,
) {
  return useQuery({
    queryKey: opencodeKeys.skillContent(name ?? "", scope),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      opencodeApi.opencodeGet<TContent>(
        `/skills/${name}/content?scope=${scope}`,
      ),
    enabled: !!name,
  });
}

/**
 * `GET /rules` — raw rules text for RulesEditor.
 */
export function useOpencodeRules() {
  return useQuery({
    queryKey: opencodeKeys.rules(),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      opencodeApi.opencodeGet<{ content?: string }>("/rules"),
  });
}

/**
 * `GET /agents/models` — current model mapping per agent
 * (useAgentModels / AgentsPage).
 */
export function useOpencodeAgentModels() {
  return useQuery({
    queryKey: opencodeKeys.agentModels(),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      opencodeApi.opencodeGet<{ models?: Record<string, string> }>(
        "/agents/models",
      ),
    staleTime: 60_000,
  });
}

/* ─── Write hooks ─────────────────────────────────────────────────── */

/**
 * `PUT /config/scope` — persist a per-subsystem scope change
 * (MCPServersPage, SkillsPage). Invalidates all opencode queries so
 * dependent pages re-fetch.
 */
export function useSetOpencodeConfigScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, string>) =>
      opencodeApi.opencodePut<void>("/config/scope", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: opencodeKeys.all }),
  });
}

/**
 * `PUT /config/<file>?scope=<scope>` — persist raw config edits from
 * ConfigRawEditor.
 */
export function useUpdateOpencodeConfigRaw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      file: string;
      scope: string;
      data: Record<string, unknown>;
    }) =>
      opencodeApi.opencodePut<void>(
        `/config/${vars.file}?scope=${vars.scope}`,
        vars.data,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: opencodeKeys.all }),
  });
}

/**
 * `PUT /providers/<key>` — create or update a provider entry
 * (ProvidersPage handles both add + edit through this hook).
 */
export function useUpsertOpencodeProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      key: string;
      body: Record<string, unknown>;
    }) =>
      opencodeApi.opencodePut(`/providers/${vars.key}`, vars.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: opencodeKeys.all }),
  });
}

/**
 * `PUT /providers/active` — switch the active provider/model pair
 * (ProvidersPage).
 */
export function useSetOpencodeActiveProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { provider: string; model: string }) =>
      opencodeApi.opencodePut("/providers/active", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: opencodeKeys.all }),
  });
}

/**
 * `DELETE /providers/<name>` — remove a provider from the registry.
 */
export function useDeleteOpencodeProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      opencodeApi.opencodeDelete(`/providers/${name}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: opencodeKeys.all }),
  });
}

/**
 * `PUT /permissions` — replace the permission rules + default
 * action (PermissionsPage).
 */
export function useUpdateOpencodePermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      rules: unknown[];
      defaultAction: string;
    }) => opencodeApi.opencodePut("/permissions", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: opencodeKeys.all }),
  });
}

/**
 * `POST /mcp/<name>/toggle?scope=<scope>` — flip a server's enabled
 * flag without rewriting its full config (MCPServersPage).
 */
export function useToggleOpencodeMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; scope: string }) =>
      opencodeApi.opencodePost<{ enabled: boolean }>(
        `/mcp/${vars.name}/toggle?scope=${vars.scope}`,
        {},
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: opencodeKeys.all }),
  });
}

/**
 * `POST /mcp/<name>/move` — relocate a server between scopes.
 */
export function useMoveOpencodeMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; from: string }) =>
      opencodeApi.opencodePost<{ to: string }>(
        `/mcp/${vars.name}/move`,
        { from: vars.from },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: opencodeKeys.all }),
  });
}

/**
 * `PUT /mcp/<name>?scope=<scope>` — upsert a full MCP server config
 * (MCPServersPage edit modal).
 */
export function useUpsertOpencodeMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      name: string;
      scope: string;
      body: Record<string, unknown>;
    }) =>
      opencodeApi.opencodePut<void>(
        `/mcp/${vars.name}?scope=${vars.scope}`,
        vars.body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: opencodeKeys.all }),
  });
}

/**
 * `DELETE /mcp/<name>?scope=<scope>` — remove an MCP server.
 */
export function useDeleteOpencodeMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; scope: string }) =>
      opencodeApi.opencodeDelete<void>(
        `/mcp/${vars.name}?scope=${vars.scope}`,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: opencodeKeys.all }),
  });
}

/**
 * `PUT /skills/<name>/content?scope=<scope>` — persist skill body
 * edits (SkillsPage).
 */
export function useUpdateOpencodeSkillContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      name: string;
      scope: string;
      content: string;
    }) =>
      opencodeApi.opencodePut<void>(
        `/skills/${vars.name}/content?scope=${vars.scope}`,
        { content: vars.content },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: opencodeKeys.all }),
  });
}

/**
 * `POST /skills/<name>/toggle?scope=<scope>` — flip a skill's
 * enabled flag (SkillsPage).
 */
export function useToggleOpencodeSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; scope: string }) =>
      opencodeApi.opencodePost<{ enabled: boolean }>(
        `/skills/${vars.name}/toggle?scope=${vars.scope}`,
        {},
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: opencodeKeys.all }),
  });
}

/**
 * `POST /skills/<name>/move` — relocate a skill between scopes.
 */
export function useMoveOpencodeSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; from: string }) =>
      opencodeApi.opencodePost<{ to: string }>(
        `/skills/${vars.name}/move`,
        { from: vars.from },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: opencodeKeys.all }),
  });
}

/**
 * `DELETE /skills/<name>?scope=<scope>` — remove a skill.
 */
export function useDeleteOpencodeSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; scope: string }) =>
      opencodeApi.opencodeDelete<void>(
        `/skills/${vars.name}?scope=${vars.scope}`,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: opencodeKeys.all }),
  });
}

/**
 * `PUT /rules` — persist rules text edits (RulesEditor).
 */
export function useUpdateOpencodeRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      opencodeApi.opencodePut("/rules", { content }),
    onSuccess: () => qc.invalidateQueries({ queryKey: opencodeKeys.all }),
  });
}

/**
 * `POST /agents/batch-model` — apply a model to every agent in one
 * round-trip (useAgentModels / AgentsPage).
 */
export function useBatchSetOpencodeAgentModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (model: string) =>
      opencodeApi.opencodePost<Record<string, string>>(
        "/agents/batch-model",
        { model },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: opencodeKeys.all }),
  });
}