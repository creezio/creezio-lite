CREATE TABLE `lite_assistant_ui_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`run_id` text NOT NULL,
	`status` text NOT NULL,
	`result_json` text,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `lite_assistant_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `lite_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "assistant_ui_status" CHECK("lite_assistant_ui_actions"."status" IN ('pending','claimed','completed'))
);
--> statement-breakpoint
CREATE INDEX `idx_assistant_ui_expiry` ON `lite_assistant_ui_actions` (`org_id`,`user_id`,`expires_at`);