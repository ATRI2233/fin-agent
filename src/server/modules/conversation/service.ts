import type { IConversationRepo, Conversation, Message } from "./repo.js";
import { ConversationNotFoundError, ValidationError } from "../../infra/errors.js";

export interface IConversationService {
  listConversations(): Conversation[];
  createConversation(title?: string): Conversation;
  getConversation(id: string): Conversation;
  deleteConversation(id: string): void;
  getMessages(id: string): Message[];
  addMessage(id: string, role: string, content: string): Message;
}

export class ConversationService implements IConversationService {
  constructor(private repo: IConversationRepo) {}

  listConversations(): Conversation[] {
    return this.repo.list(50, 0);
  }

  createConversation(title?: string): Conversation {
    return this.repo.create("fin-orchestrator", title);
  }

  getConversation(id: string): Conversation {
    const conv = this.repo.get(id);
    if (!conv) {
      throw new ConversationNotFoundError(`Conversation ${id} not found`);
    }
    return conv;
  }

  deleteConversation(id: string): void {
    this.repo.delete(id);
  }

  getMessages(id: string): Message[] {
    return this.repo.getMessages(id, 100, 0);
  }

  addMessage(id: string, role: string, content: string): Message {
    if (!["user", "assistant", "system"].includes(role)) {
      throw new ValidationError("Invalid role; must be user, assistant, or system");
    }
    if (typeof content !== "string" || !content) {
      throw new ValidationError("content must be a non-empty string");
    }
    const conv = this.repo.get(id);
    if (!conv) {
      throw new ConversationNotFoundError(`Conversation ${id} not found`);
    }
    return this.repo.appendMessage(id, role, content);
  }
}
