import { FastifyPluginAsync } from "fastify";
import type { IConversationService } from "../../../modules/conversation/service.js";
import type { CreateConversationBody, CreateMessageBody, IdParam } from "../../types.js";

const conversationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/conversations", async (req, _reply) => {
    const svc = req.registry!.resolve<IConversationService>("IConversationService");
    return { data: svc.listConversations(), trace_id: req.traceId };
  });

  app.post("/conversations", async (req, _reply) => {
    const body = req.body as CreateConversationBody;
    const svc = req.registry!.resolve<IConversationService>("IConversationService");
    const conv = svc.createConversation(body.title, body.agent_name);
    return { data: conv, trace_id: req.traceId };
  });

  app.get("/conversations/:id", async (req, _reply) => {
    const { id } = req.params as IdParam;
    const svc = req.registry!.resolve<IConversationService>("IConversationService");
    const conv = svc.getConversation(id);
    return { data: { conversation: conv, messages: svc.getMessages(id) }, trace_id: req.traceId };
  });

  app.delete("/conversations/:id", async (req, _reply) => {
    const { id } = req.params as IdParam;
    const svc = req.registry!.resolve<IConversationService>("IConversationService");
    svc.deleteConversation(id);
    return { data: null, trace_id: req.traceId };
  });

  app.get("/conversations/:id/messages", async (req, _reply) => {
    const { id } = req.params as IdParam;
    const svc = req.registry!.resolve<IConversationService>("IConversationService");
    return { data: svc.getMessages(id), trace_id: req.traceId };
  });

  app.post("/conversations/:id/messages", async (req, _reply) => {
    const { id } = req.params as IdParam;
    const body = req.body as CreateMessageBody;
    const svc = req.registry!.resolve<IConversationService>("IConversationService");
    const msg = svc.addMessage(id, body.role, body.content);
    return { data: msg, trace_id: req.traceId };
  });
};

export default conversationRoutes;
