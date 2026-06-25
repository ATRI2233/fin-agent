// 通用 extractData：从 MCP tool_call 返回体中提取数据数组
export function extractData(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw?.content && Array.isArray(raw.content)) {
    const texts = raw.content
      .filter((c: any) => c.type === "text" && c.text != null)
      .map((c: any) => c.text);
    const results: any[] = [];
    for (const t of texts) {
      try { results.push(JSON.parse(t)); }
      catch { if (t) results.push(t); }
    }
    return results;
  }
  return [];
}
