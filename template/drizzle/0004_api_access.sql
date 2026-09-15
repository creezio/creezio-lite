CREATE TABLE `lite_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `lite_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "access_token_mode" CHECK("lite_access_tokens"."mode" IN ('read','write'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_access_token_hash` ON `lite_access_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_access_token_owner` ON `lite_access_tokens` (`org_id`,`user_id`);