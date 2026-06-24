import { FastifyPluginAsync } from "fastify";
import { ConversationRepo } from "../../../modules/conversation/repo.js";
import { ValidationError, WorkflowNotFoundError } from "../../../infra/errors.js";

const conversationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/conversations", async (req, reply) => {
    const list = ConversationRepo.list(50, 0);
    return { data: list, trace_id: (req as any).traceId };
  });

  app.post("/conversations", async (req, reply) => {
    const body = req.body as any || {};
    const title = typeof body?.title === "string" ? body.title : undefined;
    const conv = ConversationRepo.create("fin-orchestrator", title);
    return { data: conv, trace_id: (req as any).traceId };
  });

  app.get("/conversations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const conv = ConversationRepo.get(id);
    if (!conv) {
      throw new WorkflowNotFoundError(`Conversation ${id} not found`);
    }
    return { data: conv, trace_id: (req as any).traceId };
  });

  app.delete("/conversations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    ConversationRepo.delete(id);
    return { data: null, trace_id: (req as any).traceId };
  });

  app.get("/conversations/:id/messages", async (req, reply) => {
    const { id } = req.params as { id: string };
    const msgs = ConversationRepo.getMessages(id, 100, 0);
    return { data: msgs, trace_id: (req as any).traceId };
  });

  app.post("/conversations/:id/messages", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any || {};
    const role = body?.role;
    const content = body?.content;
    if (!["user", "assistant", "system"].includes(role)) {
      throw new ValidationError("Invalid role; must be user, assistant, or system");
    }
    if (typeof content !== "string" || !content) {
      throw new ValidationError("content must be a non-empty string");
    }
    const conv = ConversationRepo.get(id);
    if (!conv) {
      throw new WorkflowNotFoundError(`Conversation ${id} not found`);
    }
    const msg = ConversationRepo.appendMessage(id, role, content);
    return { data: msg, trace_id: (req as any).traceId };
  });
};

export default conversationRoutes;
