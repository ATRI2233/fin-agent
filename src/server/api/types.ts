/** Fastify request decorator type augmentations.
 *
 * Extends the Fastify request object with project-specific properties
 * (`traceId`, `registry`) so route handlers can access them without
 * `(req as any)` casts. After creating this module, every route file
 * should import :type:`FastifyRequest` from Fastify and access
 * ``req.traceId`` / ``req.registry`` directly.
 *
 * **Usage in routes:**
 *
 * ```ts
 * import { FastifyRequest } from "fastify";
 * import type { Registry } from "../../infra/registry.js";
 *
 * app.get("/foo", async (req: FastifyRequest, reply) => {
 *   const traceId = req.traceId;
 *   const registry = req.registry as Registry;
 * });
 * ```
 */

import "fastify";
import type { Registry } from "../infra/registry.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Unique trace id injected on every request by the onRequest hook in app.ts. */
    traceId: string;
    /** DI container — resolved once per server lifecycle, set via onRequest hook. */
    registry: Registry;
  }
}
