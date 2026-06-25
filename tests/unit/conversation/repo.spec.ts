import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "path";
import * as schema from "../../../src/server/infra/schema.js";
import { ConversationRepo } from "../../../src/server/modules/conversation/repo.js";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let repo: ConversationRepo;

beforeAll(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  const migrationsPath = resolve(process.cwd(), "config", "drizzle", "migrations");
  migrate(db, { migrationsFolder: migrationsPath });
  repo = new ConversationRepo(db);
});

afterAll(() => {
  sqlite.close();
});

beforeEach(() => {
  db.delete(schema.messages).run();
  db.delete(schema.conversations).run();
});

/* ------------------------------------------------------------------ */
/*  Conversation CRUD                                                  */
/* ------------------------------------------------------------------ */

describe("ConversationRepo", () => {
  describe("create", () => {
    it("creates a conversation and get retrieves it by id", () => {
      const conv = repo.create("test-agent", "Test Title");

      expect(conv).toEqual({
        id: expect.any(String),
        agentName: "test-agent",
        title: "Test Title",
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });

      const retrieved = repo.get(conv.id);
      expect(retrieved).toBeDefined();
      // Fields match; dates compared at second-level precision because
      // SQLite stores timestamps as integer seconds.
      expect(retrieved!.id).toBe(conv.id);
      expect(retrieved!.agentName).toBe(conv.agentName);
      expect(retrieved!.title).toBe(conv.title);
      // Dates are compared with 1-second tolerance because SQLite stores
      // timestamps as integer seconds, so the JS Date from `repo.get()`
      // may differ from the one returned by `repo.create()` by up to 999ms.
      expect(Math.abs(retrieved!.createdAt.getTime() - conv.createdAt.getTime())).toBeLessThanOrEqual(1000);
      expect(Math.abs(retrieved!.updatedAt.getTime() - conv.updatedAt.getTime())).toBeLessThanOrEqual(1000);
    });

    it("sets title to null when no title is provided", () => {
      const conv = repo.create("test-agent");

      expect(conv.title).toBeNull();
    });

    it("creates a conversation with a non-empty id", () => {
      const conv = repo.create("agent");

      expect(conv.id).toBeTruthy();
      expect(typeof conv.id).toBe("string");
    });
  });

  describe("get", () => {
    it("returns undefined for a non-existent conversation", () => {
      const result = repo.get("non-existent-id");
      expect(result).toBeUndefined();
    });
  });

  describe("delete", () => {
    it("removes the conversation so get returns undefined", () => {
      const conv = repo.create("agent", "to-delete");

      repo.delete(conv.id);

      expect(repo.get(conv.id)).toBeUndefined();
    });

    it("does not throw when deleting a non-existent conversation", () => {
      expect(() => repo.delete("non-existent-id")).not.toThrow();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  list                                                               */
  /* ------------------------------------------------------------------ */

  describe("list", () => {
    it("returns conversations ordered by updatedAt DESC", () => {
      const base = new Date("2025-06-01T00:00:00Z");
      db.insert(schema.conversations).values([
        {
          id: "c-oldest",
          agentName: "agent-a",
          title: "Oldest",
          createdAt: base,
          updatedAt: new Date(base.getTime() + 1000),
        },
        {
          id: "c-middle",
          agentName: "agent-b",
          title: "Middle",
          createdAt: base,
          updatedAt: new Date(base.getTime() + 2000),
        },
        {
          id: "c-newest",
          agentName: "agent-c",
          title: "Newest",
          createdAt: base,
          updatedAt: new Date(base.getTime() + 3000),
        },
      ]).run();

      const all = repo.list(10, 0);

      expect(all).toHaveLength(3);
      expect(all[0].title).toBe("Newest");
      expect(all[1].title).toBe("Middle");
      expect(all[2].title).toBe("Oldest");
    });

    it("respects limit and offset", () => {
      const base = new Date("2025-06-01T00:00:00Z");
      for (let i = 0; i < 5; i++) {
        db.insert(schema.conversations)
          .values({
            id: `c${i}`,
            agentName: `agent-${i}`,
            title: `Conversation ${i}`,
            createdAt: base,
            updatedAt: new Date(base.getTime() + i * 1000),
          })
          .run();
      }

      const page1 = repo.list(2, 0);
      expect(page1).toHaveLength(2);
      // Newest first: indices 4, 3
      expect(page1[0].title).toBe("Conversation 4");
      expect(page1[1].title).toBe("Conversation 3");

      const page2 = repo.list(2, 2);
      expect(page2).toHaveLength(2);
      expect(page2[0].title).toBe("Conversation 2");
      expect(page2[1].title).toBe("Conversation 1");
    });

    it("returns an empty array when there are no conversations", () => {
      const result = repo.list(10, 0);
      expect(result).toEqual([]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  appendMessage                                                      */
  /* ------------------------------------------------------------------ */

  describe("appendMessage", () => {
    it("creates a message with the correct role and content", () => {
      const conv = repo.create("agent", "Test");

      const msg = repo.appendMessage(conv.id, "user", "Hello, world!");

      expect(msg).toEqual({
        id: expect.any(String),
        conversationId: conv.id,
        role: "user",
        content: "Hello, world!",
        createdAt: expect.any(Date),
      });
    });

    it("persists the message so getMessages returns it", () => {
      const conv = repo.create("agent", "Test");

      repo.appendMessage(conv.id, "user", "persist me");

      const msgs = repo.getMessages(conv.id, 10, 0);
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe("persist me");
    });

    it("updates the conversation's updatedAt timestamp", () => {
      const conv = repo.create("agent", "Test");

      // Set a known past timestamp directly in the DB so we can
      // deterministically verify that appendMessage bumps it forward.
      const past = new Date("2020-01-01T00:00:00Z");
      db.update(schema.conversations)
        .set({ updatedAt: past })
        .where(eq(schema.conversations.id, conv.id))
        .run();

      repo.appendMessage(conv.id, "assistant", "I am updated");

      const after = repo.get(conv.id)!;
      expect(after.updatedAt.getTime()).toBeGreaterThan(past.getTime());
    });
  });

  /* ------------------------------------------------------------------ */
  /*  getMessages                                                        */
  /* ------------------------------------------------------------------ */

  describe("getMessages", () => {
    it("returns messages ordered by createdAt ASC", () => {
      const conv = repo.create("agent", "ordering");

      // Each appendMessage call creates a distinct createdAt value
      const m1 = repo.appendMessage(conv.id, "user", "first");
      const m2 = repo.appendMessage(conv.id, "assistant", "second");
      const m3 = repo.appendMessage(conv.id, "user", "third");

      const msgs = repo.getMessages(conv.id, 10, 0);

      expect(msgs).toHaveLength(3);
      expect(msgs[0].content).toBe("first");
      expect(msgs[1].content).toBe("second");
      expect(msgs[2].content).toBe("third");
    });

    it("respects limit and offset", () => {
      const conv = repo.create("agent", "pagination");

      for (let i = 0; i < 5; i++) {
        repo.appendMessage(conv.id, "user", `msg-${i}`);
      }

      const page1 = repo.getMessages(conv.id, 2, 0);
      expect(page1).toHaveLength(2);
      expect(page1[0].content).toBe("msg-0");
      expect(page1[1].content).toBe("msg-1");

      const page2 = repo.getMessages(conv.id, 2, 2);
      expect(page2).toHaveLength(2);
      expect(page2[0].content).toBe("msg-2");
      expect(page2[1].content).toBe("msg-3");
    });

    it("returns an empty array for a non-existent conversation", () => {
      const msgs = repo.getMessages("no-such-conversation", 10, 0);
      expect(msgs).toEqual([]);
    });

    it("returns an empty array after the parent conversation is deleted (cascade)", () => {
      const conv = repo.create("agent", "cascade-test");
      repo.appendMessage(conv.id, "user", "will be cascaded");
      repo.appendMessage(conv.id, "assistant", "me too");

      // Verify messages exist before delete
      expect(repo.getMessages(conv.id, 10, 0)).toHaveLength(2);

      // Delete the conversation
      repo.delete(conv.id);

      // Messages should have been removed by ON DELETE CASCADE
      expect(repo.getMessages(conv.id, 10, 0)).toHaveLength(0);
      expect(repo.get(conv.id)).toBeUndefined();
    });
  });
});
