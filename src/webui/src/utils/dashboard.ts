/**
 * Dashboard utility helpers.
 *
 * Pure functions for deriving view-models from domain types. Kept out of
 * the component layer so they can be reused and unit-tested.
 */
import type { ToolItem } from '../domain/agent';
import type { ServerGroup } from '../components/dashboard/McpServersPanel';

/**
 * Group tools by their `server` field and sort groups by tool count
 * (descending). Tools without a `server` key are bucketed under
 * "unknown".
 */
export function groupToolsByServer(tools: ToolItem[]): ServerGroup[] {
  if (!Array.isArray(tools) || tools.length === 0) return [];
  const map: Record<string, ServerGroup> = {};
  for (const tool of tools) {
    const key = tool.server || 'unknown';
    (map[key] ??= { name: key, tools: [] }).tools.push(tool);
  }
  return Object.values(map).sort((a, b) => b.tools.length - a.tools.length);
}