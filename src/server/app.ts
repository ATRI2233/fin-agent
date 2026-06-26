import Fastify from "fastify";
import cors from "@fastify/cors";
import { settings } from "./infra/settings.js";
import { createLogger, APP_VERSION } from "./infra/logging.js";
import { Registry } from "./infra/registry.js";
import { FinAgentError, ErrorCode } from "./infra/errors.js";

// Load type augmentations for req.traceId / req.registry
import "./api/types.js";

import authPlugin from "./api/plugins/auth.js";
import workflowRoutes from "./api/v1/routes/workflows.js";
import executionRoutes from "./api/v1/routes/executions.js";
import agentRoutes from "./api/v1/routes/agents.js";
import mcpRoutes from "./api/v1/routes/mcp.js";

const log = createLogger("app");

export function createApp(registry: Registry): ReturnType<typeof Fastify> {
  const app = Fastify({
    logger: createLogger("fastify"),
    ajv: {
      customOptions: {
        strict: false,
      },
    },
  });

  // â”€â”€ Decorate request with typed registry & traceId â”€â”€
  app.decorateRequest("registry", null);
  app.addHook("onRequest", async (req) => {
    req.registry = registry;
  });

  // â”€â”€ CORS â”€â”€
  // The CORS spec forbids `Access-Control-Allow-Origin: *` together with
  // `credentials: true` â€?browsers reject such responses. Instead we keep an
  // explicit allow-list (from settings) and reflect the request Origin back
  // only when it matches, so credentialed requests stay spec-compliant.
  const allowedOrigins = new Set(
    settings.CORS_ALLOWED_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  );
  app.register(cors, {
    origin(origin, cb) {
      // Same-origin / non-browser requests (no Origin header) are always allowed.
      if (!origin || allowedOrigins.has(origin)) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
  });

  // â”€â”€ Auth â”€â”€
  app.register(authPlugin);

  // â”€â”€ Trace injection â”€â”€
  app.addHook("onRequest", async (req) => {
    const traceId =
      req.headers[settings.TRACE_ID_HEADER.toLowerCase()]?.toString() ||
      crypto.randomUUID();
    req.traceId = traceId;
  });

  // â”€â”€ v1 routers â”€â”€
  app.register(workflowRoutes, { prefix: "/api/v1" });
  app.register(executionRoutes, { prefix: "/api/v1" });
  app.register(agentRoutes, { prefix: "/api/v1" });
  app.register(mcpRoutes, { prefix: "/api/v1" });

  // â”€â”€ Health check â”€â”€
  app.get(settings.HEALTH_CHECK_PATH, async (req, _reply) => {
    return {
      data: { status: "ok", version: APP_VERSION },
      trace_id: req.traceId,
    };
  });

  // â”€â”€ Error handler â”€â”€
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof FinAgentError) {
      const finErr = err as FinAgentError;
      const traceId = req.traceId || "unknown";
      reply.status(finErr.httpStatus).send(finErr.toEnvelope(traceId));
      return;
    }
    if ("validation" in err && Array.isArray((err as unknown as Record<string, unknown>).validation)) {
      reply.status(422).send({
        code: ErrorCode.VALIDATION_FAILED,
        message: err.message,
        data: null,
        trace_id: req.traceId || "unknown",
      });
      return;
    }
    log.error({ err, req: req.id }, "Unhandled error");
    reply.status(500).send({
      code: ErrorCode.INTERNAL_FAILURE,
      message: "Internal server error",
      data: null,
      trace_id: req.traceId || "unknown",
    });
  });

  return app;
}
