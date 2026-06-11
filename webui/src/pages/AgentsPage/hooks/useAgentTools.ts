/**
 * Local hook bundling the AgentsPage tool catalogue: every available
 * tool (MCP + custom + builtin) plus a per-agent whitelist fetcher.
 *
 * The tool catalogue auto-fetches on mount via the Wave 5 `useFetch`
 * primitive so the page never has to wire a `useEffect` for the
 * initial load. The whitelist fetcher is exposed as a callable — the
 * Edit modal triggers it on demand when an agent is selected.
 *
 * All HTTP goes through the typed `opencodeGet` helper, so no raw
 * `fetch(` calls live in this module.
 *
 * @see ../../../hooks/useFetch for the underlying lifecycle hook.
 * @see ../../../api/opencode for the proxy wrappers.
 */

import { useCallback } from 'react';

import { useFetch } from '../../../hooks/useFetch';
import { opencodeGet } from '../../../api/opencode';

/**
 * Local tool descriptor used by the Edit modal's whitelist picker.
 *
 * `key` is a stable identifier — `${mcpServer}_${name}` for MCP tools,
 * `name` for custom / builtin tools — and is what the backend stores
 * in `tools_whitelist`. `source` is one of `'mcp' | 'custom' | 'builtin'`
 * and feeds the source filter. `mcpServer` is only populated for MCP
 * tools and drives the server filter.
 */
export interface AgentToolItem {
  key: string;
  title: string;
  description: string;
  source: 'mcp' | 'custom' | 'builtin';
  category?: string;
  mcpServer?: string;
}

/**
 * Hard-coded builtin tool catalogue — the opencode proxy does not
 * surface these via `/tools`, so we mirror the original page's
 * static list here. Keep entries in sync with the opencode CLI
 * builtins (see `agents/opencode/`).
 */
const BUILTIN_TOOLS: AgentToolItem[] = [
  { key: 'read', title: 'Read', description: '从磁盘读取文件', source: 'builtin', category: '文件' },
  { key: 'edit', title: 'Edit', description: '编辑磁盘文件', source: 'builtin', category: '文件' },
  { key: 'bash', title: 'Bash', description: '执行 Shell 命令', source: 'builtin', category: '系统' },
  { key: 'grep', title: 'Grep', description: '搜索文件内容', source: 'builtin', category: '文件' },
  { key: 'glob', title: 'Glob', description: '按模式查找文件', source: 'builtin', category: '文件' },
  { key: 'websearch', title: 'Web Search', description: '搜索网页', source: 'builtin', category: '网络' },
  { key: 'webfetch', title: 'Web Fetch', description: '获取 URL', source: 'builtin', category: '网络' },
  { key: 'lsp_diagnostics', title: 'LSP Diagnostics', description: '获取 LSP 错误/警告', source: 'builtin', category: '开发' },
];

/**
 * Single fetcher for the merged tool catalogue. Failures of the
 * individual sources (MCP / custom) are isolated so a missing MCP
 * endpoint does not take down the custom/builtin list; only a
 * catastrophic failure of the wrapper itself surfaces as a hook
 * error. Builtins are static and always appended last so user-
 * defined tools with matching names win on duplicate keys.
 */
async function fetchAllTools(_signal: AbortSignal): Promise<AgentToolItem[]> {
  const tools: AgentToolItem[] = [];

  // Fetch MCP tools — failures are isolated.
  try {
    const mcpData = await opencodeGet<Record<string, { tools?: unknown[] }>>('/mcp');
    for (const [serverName, serverConfig] of Object.entries(mcpData)) {
      const mcpTools = serverConfig.tools || [];
      if (Array.isArray(mcpTools)) {
        for (const raw of mcpTools) {
          const tool = raw as { name?: string; description?: string; category?: string };
          if (!tool.name) continue;
          tools.push({
            key: `${serverName}_${tool.name}`,
            title: tool.name,
            description: tool.description || '',
            source: 'mcp',
            category: tool.category || '其他',
            mcpServer: serverName,
          });
        }
      }
    }
  } catch (mcpErr) {
    console.error('Failed to fetch MCP tools:', mcpErr);
  }

  // Fetch custom (non-MCP) tools.
  try {
    const toolsData = await opencodeGet<Record<string, { description?: string; category?: string }>>('/tools');
    for (const [name, config] of Object.entries(toolsData)) {
      tools.push({
        key: name,
        title: name,
        description: config.description || '',
        source: 'custom',
        category: config.category || '自定义',
      });
    }
  } catch (toolsErr) {
    console.error('Failed to fetch custom tools:', toolsErr);
  }

  tools.push(...BUILTIN_TOOLS);
  return tools;
}

export interface UseAgentToolsResult {
  availableTools: AgentToolItem[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  /**
   * Fetch the whitelist for `agentName`. Resolves to an empty list
   * when the agent has no whitelist configured (treated as "allow all").
   */
  fetchToolsWhitelist: (agentName: string) => Promise<string[]>;
}

/**
 * Fetch the merged tool catalogue plus a per-agent whitelist fetcher.
 *
 * @returns `{ availableTools, loading, error, refetch, fetchToolsWhitelist }`.
 */
export function useAgentTools(): UseAgentToolsResult {
  const fetcher = useCallback(fetchAllTools, []);
  const { data, loading, error, refetch } = useFetch<AgentToolItem[]>(fetcher, []);

  const fetchToolsWhitelist = useCallback(
    async (agentName: string): Promise<string[]> => {
      try {
        const res = await opencodeGet<{ tools_whitelist?: string[] }>(
          `/agents/${encodeURIComponent(agentName)}/tools-whitelist`,
        );
        return res.tools_whitelist || [];
      } catch {
        // No whitelist configured for this agent — treat as "allow all".
        return [];
      }
    },
    [],
  );

  return {
    availableTools: data ?? [],
    loading,
    error,
    refetch,
    fetchToolsWhitelist,
  };
}
