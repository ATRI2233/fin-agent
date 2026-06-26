ALTER TABLE messages ADD COLUMN agent TEXT;--> statement-breakpoint
ALTER TABLE messages ADD COLUMN workflow_id TEXT;--> statement-breakpoint
ALTER TABLE messages ADD COLUMN execution_id TEXT;--> statement-breakpoint
ALTER TABLE messages ADD COLUMN extra_data TEXT DEFAULT '{}';--> statement-breakpoint
CREATE INDEX idx_messages_execution ON messages(execution_id);--> statement-breakpoint
CREATE INDEX idx_messages_workflow ON messages(workflow_id);
