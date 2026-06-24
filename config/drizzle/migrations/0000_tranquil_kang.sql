CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_name` text NOT NULL,
	`title` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `execution_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text,
	`node_id` text,
	`agent_name` text,
	`event` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`trace_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `workflow_executions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `execution_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`node_id` text NOT NULL,
	`agent` text NOT NULL,
	`status` text NOT NULL,
	`input` text DEFAULT '{}' NOT NULL,
	`output` text,
	`session_id` text,
	`error` text,
	`started_at` integer,
	`completed_at` integer,
	`retry_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `workflow_executions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflow_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`trace_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`nodes` text DEFAULT '[]' NOT NULL,
	`edges` text DEFAULT '[]' NOT NULL,
	`trigger_type` text DEFAULT 'manual' NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
