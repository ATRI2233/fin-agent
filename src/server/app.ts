import Fastify from "fastify";
import cors from "@fastify/cors";
import { settings } from "./infra/settings.js";
import { createLogger } from "./infra/logging.js";
import { Registry } from "./infra/registry.js";
import { FinAgentError, ErrorCode } from "./infra/errors.js";

// Load type augmentations for req.traceId / req.registry
import "./api/types.js";

import authPlugin from "./api/plugins/auth.js";
import conversationRoutes from "./api/v1/routes/conversations.js";
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

  // ── Decorate request with typed registry & traceId ──
  app.decorateRequest("registry", null);
  app.addHook("onRequest", async (req) => {
    req.registry = registry;
  });

  // ── CORS ──
  // The CORS spec forbids `Access-Control-Allow-Origin: *` together with
  // `credentials: true` — browsers reject such responses. Instead we keep an
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

  // ── Auth ──
  app.register(authPlugin);

  // ── Trace injection ──
  app.addHook("onRequest", async (req) => {
    const traceId =
      req.headers[settings.TRACE_ID_HEADER.toLowerCase()]?.toString() ||
      crypto.randomUUID();
    req.traceId = traceId;
  });

  // ── v1 routers ──
  app.register(conversationRoutes, { prefix: "/api/v1" });
  app.register(workflowRoutes, { prefix: "/api/v1" });
  app.register(executionRoutes, { prefix: "/api/v1" });
  app.register(agentRoutes, { prefix: "/api/v1" });
  app.register(mcpRoutes, { prefix: "/api/v1" });

  // ── Health check ──
  app.get("/api/v1/health", async (req, reply) => {
    return {
      data: { status: "ok", version: "2.1" },
      trace_id: req.traceId,
    };
  });

  // ── Error handler ──
  app.setErrorHandler((err, req, reply) => {
    if ("httpStatus" in err && err instanceof FinAgentError) {
      const finErr = err as FinAgentError;
      const traceId = req.traceId || "unknown";
      reply.status(finErr.httpStatus).send(finErr.toEnvelope(traceId));
      return;
    }
    if ((err as any).validation) {
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
      code: ErrorCode.DATABASE_FAILURE,
      message: "Internal server error",
      data: null,
      trace_id: req.traceId || "unknown",
    });
  });

  return app;
}
