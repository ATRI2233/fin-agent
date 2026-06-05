// 在子进程启动时注入，让 Node.js fetch 走代理（可选）
// 仅在 HTTP_PROXY 等环境变量设置时才启用
// 通过 NODE_OPTIONS="--import ./proxy-bootstrap.mjs" 加载
import { setGlobalDispatcher, ProxyAgent } from "undici";

const PROXY_URL = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || "";
if (PROXY_URL) {
  setGlobalDispatcher(new ProxyAgent(PROXY_URL));
}
