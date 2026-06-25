/**
 * Test fixture factories for Fin-Agent integration tests.
 *
 * These helpers provide type-safe methods for creating test database records,
 * isolating tests from direct Drizzle schema dependencies. When the DB schema
 * changes, only these factory functions need updating, not every test file.
 *
 * @module
 */

import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../src/server/infra/schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Drizzle client type bound to the project schema. */
export type DrizzleClient = BetterSQLite3Database<typeof schema>;

/** Result shape returned by {@link createTestWorkflow}. Excludes Drizzle
 * internal wrappers so callers can access fields without type gymnastics. */
export type WorkflowRecord = {
  id: string;
  name: string;
  description: string | null;
  nodes: unknown;
  edges: unknown;
  triggerType: string;
  config: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

/** Result shape returned by {@link createTestConversation}. */
export type ConversationRecord = {
  id: string;
  agentName: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Result shape returned by {@link createTestExecution}. */
export type ExecutionRecord = {
  id: string;
  workflowId: string;
  status: string;
  params: unknown;
  traceId: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Insert a test workflow record with sensible defaults.
 *
 * @param db        - Drizzle client bound to the project schema
 * @param overrides - Optional fields to override defaults (e.g. `{ name: "my-wf" }`)
 * @returns The inserted record values
 */
export function createTestWorkflow(
  db: DrizzleClient,
  overrides?: Partial<typeof schema.workflows.$inferInsert>,
): WorkflowRecord {
  const id = overrides?.id ?? crypto.randomUUID();
  const now = new Date();

  const values: typeof schema.workflows.$inferInsert = {
    id,
    name: "test-workflow",
    description: null,
    nodes: [],
    edges: [],
    triggerType: "manual",
    config: {},
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  db.insert(schema.workflows).values(values).run();
  return values as WorkflowRecord;
}

/**
 * Insert a test conversation record with sensible defaults.
 *
 * @param db        - Drizzle client bound to the project schema
 * @param overrides - Optional fields to override defaults
 * @returns The inserted record values
 */
export function createTestConversation(
  db: DrizzleClient,
  overrides?: Partial<typeof schema.conversations.$inferInsert>,
): ConversationRecord {
  const id = overrides?.id ?? crypto.randomUUID();
  const now = new Date();

  const values: typeof schema.conversations.$inferInsert = {
    id,
    agentName: "test-agent",
    title: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  db.insert(schema.conversations).values(values).run();
  return values as ConversationRecord;
}

/**
 * Insert a test workflow execution record with sensible defaults.
 *
 * @param db        - Drizzle client bound to the project schema
 * @param overrides - Optional fields to override defaults
 * @returns The inserted record values
 */
export function createTestExecution(
  db: DrizzleClient,
  overrides?: Partial<typeof schema.workflowExecutions.$inferInsert>,
): ExecutionRecord {
  const id = overrides?.id ?? crypto.randomUUID();
  const now = new Date();

  const values: typeof schema.workflowExecutions.$inferInsert = {
    id,
    workflowId: "wf-test",
    status: "pending",
    params: {},
    traceId: "tr-test",
    createdAt: now,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };

  db.insert(schema.workflowExecutions).values(values).run();
  return values as ExecutionRecord;
}

/**
 * Remove all test data from the database in FK-safe order.
 *
 * Deletes in reverse-dependency order so foreign-key constraints are not
 * violated. Call this in `afterEach` or `afterAll` when tests share a DB.
 *
 * @param db - Drizzle client bound to the project schema
 */
export function cleanTestData(db: DrizzleClient): void {
  // Leaf tables first (no dependents, or dependents already cascade-deleted).
  db.delete(schema.messages).run();
  db.delete(schema.executionLogs).run();
  db.delete(schema.executionNodes).run();

  // Parent tables after dependents are cleared.
  db.delete(schema.conversations).run();
  db.delete(schema.workflowExecutions).run();
  db.delete(schema.workflows).run();
}
