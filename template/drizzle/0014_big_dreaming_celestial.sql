CREATE TABLE `lite_password_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`username_norm` text NOT NULL,
	`email_norm` text NOT NULL,
	`password_salt` text,
	`password_hash` text,
	`password_iterations` integer,
	`activated_at` text,
	`disabled_at` text,
	`expires_at` text,
	`auth_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `lite_users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lite_password_account_version" CHECK("lite_password_accounts"."auth_version" >= 1),
	CONSTRAINT "lite_password_account_secret" CHECK(("lite_password_accounts"."password_salt" IS NULL AND "lite_password_accounts"."password_hash" IS NULL AND "lite_password_accounts"."password_iterations" IS NULL) OR ("lite_password_accounts"."password_salt" IS NOT NULL AND "lite_password_accounts"."password_hash" IS NOT NULL AND "lite_password_accounts"."password_iterations"=100000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lite_password_accounts_username` ON `lite_password_accounts` (`username_norm`);--> statement-breakpoint
CREATE UNIQUE INDEX `lite_password_accounts_email` ON `lite_password_accounts` (`email_norm`);--> statement-breakpoint
CREATE TABLE `lite_password_sessions` (
	`session_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`auth_version` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `lite_password_accounts`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lite_password_session_version" CHECK("lite_password_sessions"."auth_version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `lite_password_sessions_user` ON `lite_password_sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `lite_password_throttles` (
	`bucket_hash` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`window_expires_at` text NOT NULL,
	CONSTRAINT "lite_password_throttle_attempts" CHECK("lite_password_throttles"."attempts" >= 1)
);
--> statement-breakpoint
CREATE INDEX `lite_password_throttles_expiry` ON `lite_password_throttles` (`window_expires_at`);--> statement-breakpoint
CREATE TABLE `lite_password_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`consumed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `lite_password_accounts`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lite_password_token_purpose" CHECK("lite_password_tokens"."purpose" IN ('activation','reset'))
);
--> statement-breakpoint
CREATE INDEX `lite_password_tokens_user` ON `lite_password_tokens` (`user_id`,`purpose`,`expires_at`);