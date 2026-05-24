/**
 * proxy — 可选全局代理引导
 *
 * 仅在环境变量 PROXY_URL 或 HTTP_PROXY 已设置时启用。
 * 不硬编码任何默认代理地址。
 */

const PROXY_URL = process.env.PROXY_URL || process.env.HTTP_PROXY || process.env.HTTPS_PROXY || "";
if (!PROXY_URL) {
  console.error("[proxy] 未配置代理，直接连接");
} else {
  // 设置环境变量，供 npx 子进程使用
  if (!process.env.HTTP_PROXY) process.env.HTTP_PROXY = PROXY_URL;
  if (!process.env.HTTPS_PROXY) process.env.HTTPS_PROXY = PROXY_URL;

  try {
    const { setGlobalDispatcher, ProxyAgent } = await import("undici");
    const agent = new ProxyAgent(PROXY_URL);
    setGlobalDispatcher(agent);
    console.error(`[proxy] 全局代理已启用: ${PROXY_URL}`);
  } catch (err) {
    console.error(`[proxy] 加载 undici ProxyAgent 失败，fetch 将直连:`, err);
  }
}
