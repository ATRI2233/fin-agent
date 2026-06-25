import { eq, desc, asc } from "drizzle-orm";
import type { Database } from "../../infra/db.js";
import { db, wrapDbCall } from "../../infra/db.js";
import { conversations, messages } from "../../infra/schema.js";

export interface Conversation {
  id: string;
  agentName: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: Date;
}

/** Repository for conversation persistence. */
export class ConversationRepo {
  constructor(private db: Database) {}

  create(agentName: string, title?: string): Conversation {
    const now = new Date();
    const id = crypto.randomUUID();
    return wrapDbCall("create conversation", () => {
      this.db.insert(conversations)
        .values({ id, agentName, title: title ?? null, createdAt: now, updatedAt: now })
        .run();
      return { id, agentName, title: title ?? null, createdAt: now, updatedAt: now };
    });
  }

  get(id: string): Conversation | undefined {
    return wrapDbCall("get conversation", () => {
      const row = this.db.select().from(conversations).where(eq(conversations.id, id)).get();
      if (!row) return undefined;
      return {
        id: row.id,
        agentName: row.agentName,
        title: row.title,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  list(limit: number, offset: number): Conversation[] {
    return wrapDbCall("list conversations", () => {
      const rows = this.db
        .select()
        .from(conversations)
        .orderBy(desc(conversations.updatedAt))
        .limit(limit)
        .offset(offset)
        .all();
      return rows.map((r) => ({
        id: r.id,
        agentName: r.agentName,
        title: r.title,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    });
  }

  appendMessage(conversationId: string, role: string, content: string): Message {
    const now = new Date();
    const id = crypto.randomUUID();
    return wrapDbCall("append message", () => {
      this.db.update(conversations)
        .set({ updatedAt: now })
        .where(eq(conversations.id, conversationId))
        .run();

      this.db.insert(messages)
        .values({ id, conversationId, role, content, createdAt: now })
        .run();

      return { id, conversationId, role, content, createdAt: now };
    });
  }

  getMessages(conversationId: string, limit: number, offset: number): Message[] {
    return wrapDbCall("get messages", () => {
      const rows = this.db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.createdAt))
        .limit(limit)
        .offset(offset)
        .all();
      return rows.map((r) => ({
        id: r.id,
        conversationId: r.conversationId,
        role: r.role,
        content: r.content,
        createdAt: r.createdAt,
      }));
    });
  }

  delete(id: string): void {
    wrapDbCall("delete conversation", () => {
      this.db.delete(conversations).where(eq(conversations.id, id)).run();
    });
  }
}

/** Default instance bound to the global production db. */
export const conversationRepo = new ConversationRepo(db);
