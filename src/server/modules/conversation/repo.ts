import { eq, desc, asc } from "drizzle-orm";
import type { Database } from "../../infra/db.js";
import { db } from "../../infra/db.js";
import { conversations, messages } from "../../infra/schema.js";
import { DatabaseError } from "../../infra/errors.js";

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

/** Factory: returns a ConversationRepo bound to a specific db instance. */
export function createConversationRepo(db: Database) {
  return {
    create(agentName: string, title?: string): Conversation {
      const now = new Date();
      const id = crypto.randomUUID();
      try {
        db.insert(conversations)
          .values({ id, agentName, title: title ?? null, createdAt: now, updatedAt: now })
          .run();
        return { id, agentName, title: title ?? null, createdAt: now, updatedAt: now };
      } catch (e) {
        throw new DatabaseError("Failed to create conversation", { cause: String(e) });
      }
    },

    get(id: string): Conversation | undefined {
      try {
        const row = db.select().from(conversations).where(eq(conversations.id, id)).get();
        if (!row) return undefined;
        return {
          id: row.id,
          agentName: row.agentName,
          title: row.title,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      } catch (e) {
        throw new DatabaseError("Failed to get conversation", { cause: String(e) });
      }
    },

    list(limit: number, offset: number): Conversation[] {
      try {
        const rows = db
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
      } catch (e) {
        throw new DatabaseError("Failed to list conversations", { cause: String(e) });
      }
    },

    appendMessage(conversationId: string, role: string, content: string): Message {
      const now = new Date();
      const id = crypto.randomUUID();
      try {
        db.update(conversations)
          .set({ updatedAt: now })
          .where(eq(conversations.id, conversationId))
          .run();

        db.insert(messages)
          .values({ id, conversationId, role, content, createdAt: now })
          .run();

        return { id, conversationId, role, content, createdAt: now };
      } catch (e) {
        throw new DatabaseError("Failed to append message", { cause: String(e) });
      }
    },

    getMessages(conversationId: string, limit: number, offset: number): Message[] {
      try {
        const rows = db
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
      } catch (e) {
        throw new DatabaseError("Failed to get messages", { cause: String(e) });
      }
    },

    delete(id: string): void {
      try {
        db.delete(conversations).where(eq(conversations.id, id)).run();
      } catch (e) {
        throw new DatabaseError("Failed to delete conversation", { cause: String(e) });
      }
    },
  };
}

/** Default instance bound to the global production db. */
export const ConversationRepo = createConversationRepo(db);
