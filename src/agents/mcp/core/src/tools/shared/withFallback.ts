/**
 * withFallback — Standard fallback-to-simulated-data wrapper for MCP tools.
 *
 * Pattern: try external MCP call -> log warning on failure -> return generated fallback.
 *
 * Usage:
 *   const data = await withFallback(
 *     () => mcpManager.callTool(server, tool, args),
 *     () => generateSimulatedData(),
 *     "my_tool"
 *   );
 *
 * For tools that chain multiple MCP calls (e.g. A || B || C) or use
 * Promise.allSettled, inline the pattern manually with the standard comment:
 *   // Standard fallback-to-simulated pattern: try external MCP data, fall back to generated data
 */
export async function withFallback<T>(
  fn: () => Promise<any>,
  generateFallback: () => T,
  logPrefix: string
): Promise<T> {
  try {
    const data = await fn();
    if (data != null) return data;
  } catch (e) {
    console.error(`[${logPrefix}] 数据源不可用，使用模拟数据`);
  }
  return generateFallback();
}
