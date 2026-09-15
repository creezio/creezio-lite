CREATE TABLE `lite_browser_events` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`window_id` text,
	`action_id` text,
	`run_id` text,
	`conversation_id` text,
	`event` text NOT NULL,
	`detail_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `lite_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_browser_events_owner_time` ON `lite_browser_events` (`org_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_browser_events_conversation` ON `lite_browser_events` (`org_id`,`user_id`,`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `lite_browser_sessions` (
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`window_id` text NOT NULL,
	`lease_until` text NOT NULL,
	`path` text NOT NULL,
	PRIMARY KEY(`org_id`, `user_id`, `kind`),
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `lite_users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "browser_session_kind" CHECK("lite_browser_sessions"."kind" IN ('desktop','controller'))
);
--> statement-breakpoint
ALTER TABLE `lite_assistant_ui_actions` ADD `target_window_id` text;--> statement-breakpoint
ALTER TABLE `lite_assistant_ui_actions` ADD `action_type` text;--> statement-breakpoint
ALTER TABLE `lite_assistant_ui_actions` ADD `payload_json` text;--> statement-breakpoint
ALTER TABLE `lite_assistant_ui_actions` ADD `created_at` text;--> statement-breakpoint
ALTER TABLE `lite_assistant_ui_actions` ADD `claimed_at` text;--> statement-breakpoint
ALTER TABLE `lite_assistant_ui_actions` ADD `completed_at` text;