import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";

export const workflowExecutions = sqliteTable("workflow_executions", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").notNull(),
  status: text("status").notNull().default("pending"),
  params: text("params", { mode: "json" }).notNull().default("{}"),
  traceId: text("trace_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const executionNodes = sqliteTable("execution_nodes", {
  id: text("id").primaryKey(),
  executionId: text("execution_id")
    .notNull()
    .references(() => workflowExecutions.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  agent: text("agent").notNull(),
  status: text("status").notNull(),
  input: text("input", { mode: "json" }).notNull().default("{}"),
  output: text("output", { mode: "json" }),
  sessionId: text("session_id"),
  tokenUsage: text("token_usage", { mode: "json" }),
  error: text("error"),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  retryCount: integer("retry_count").notNull().default(0),
});

export const executionLogs = sqliteTable("execution_logs", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").references(() => workflowExecutions.id, {
    onDelete: "set null",
  }),
  nodeId: text("node_id"),
  agentName: text("agent_name"),
  event: text("event").notNull(),
  payload: text("payload", { mode: "json" }).notNull().default("{}"),
  traceId: text("trace_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const workflows = sqliteTable("workflows", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  nodes: text("nodes", { mode: "json" }).notNull().default("[]"),
  edges: text("edges", { mode: "json" }).notNull().default("[]"),
  triggerType: text("trigger_type").notNull().default("manual"),
  config: text("config", { mode: "json" }).notNull().default("{}"),
  status: text("status").notNull().default("draft"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type Execution = InferSelectModel<typeof workflowExecutions>;
export type NewExecution = InferInsertModel<typeof workflowExecutions>;
export type ExecutionNode = InferSelectModel<typeof executionNodes>;
export type NewExecutionNode = InferInsertModel<typeof executionNodes>;
export type ExecutionLog = InferSelectModel<typeof executionLogs>;
export type NewExecutionLog = InferInsertModel<typeof executionLogs>;
export type Workflow = InferSelectModel<typeof workflows>;
export type NewWorkflow = InferInsertModel<typeof workflows>;
