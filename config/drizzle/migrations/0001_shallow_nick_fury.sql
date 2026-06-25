ALTER TABLE `execution_nodes` ADD `token_usage` text;--> statement-breakpoint
CREATE INDEX `idx_messages_conversation_created_at` ON `messages` (`conversation_id`,`created_at`);