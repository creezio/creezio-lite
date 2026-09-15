CREATE TABLE `lite_assistant_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`mode` text NOT NULL,
	`model` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`active_run` text,
	`locked_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `lite_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "assistant_mode" CHECK("lite_assistant_conversations"."mode" IN ('chat','work'))
);
--> statement-breakpoint
CREATE INDEX `idx_assistant_conversations_user` ON `lite_assistant_conversations` (`org_id`,`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `lite_assistant_messages` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `lite_assistant_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `lite_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "assistant_message_role" CHECK("lite_assistant_messages"."role" IN ('user','assistant'))
);
--> statement-breakpoint
CREATE INDEX `idx_assistant_messages_thread` ON `lite_assistant_messages` (`conversation_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `lite_assistant_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`trace_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `lite_assistant_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `lite_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "assistant_trace_json" CHECK(json_valid("lite_assistant_runs"."trace_json"))
);
--> statement-breakpoint
CREATE INDEX `idx_assistant_runs_thread` ON `lite_assistant_runs` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `lite_integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`slug` text NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`secret_box` text NOT NULL,
	`meta_json` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "integration_json" CHECK(json_valid("lite_integrations"."meta_json")),
	CONSTRAINT "integration_enabled" CHECK("lite_integrations"."enabled" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_integrations_org_slug` ON `lite_integrations` (`org_id`,`slug`);