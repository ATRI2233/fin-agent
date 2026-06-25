import { FastifyPluginAsync } from "fastify";
import { Address6 } from "ip-address";
import { settings } from "../../infra/settings.js";
import { UnauthorizedError } from "../../infra/errors.js";

/** Auth plugin: API key + localhost bypass (H4 fix). */
const authPlugin: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (req, _reply) => {
    // Skip auth for health check
    if (req.url === settings.HEALTH_CHECK_PATH) return;

    // Localhost bypass
    if (settings.AUTH_SKIP_LOCALHOST) {
      const clientHost = req.ip || req.socket.remoteAddress;
      if (clientHost) {
        // Fast-path: exact IPv4 loopback checks
        if (
          clientHost === "127.0.0.1" ||
          clientHost === "::1" ||
          clientHost === "::ffff:127.0.0.1" ||
          (clientHost.startsWith("127.") && clientHost.split(".").length === 4)
        ) {
          return;
        }
        // Slow-path: try IPv6 parsing
        try {
          const addr = new Address6(clientHost);
          if (addr.isLoopback()) return;
        } catch {
          // Not a valid IP — fall through to API key check
        }
      }
    }

    // API key check
    const apiKey = req.headers["x-api-key"];
    if (!apiKey || apiKey !== settings.API_KEY) {
      throw new UnauthorizedError("Unauthorized", {
        reason: "invalid_api_key",
      });
    }
  });
};

export default authPlugin;
