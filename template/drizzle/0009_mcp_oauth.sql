CREATE TABLE `lite_oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`redirects_json` text NOT NULL,
	`auth_method` text NOT NULL,
	`secret_hash` text,
	`created_at` text NOT NULL,
	`revoked_at` text,
	CONSTRAINT "oauth_client_method" CHECK("lite_oauth_clients"."auth_method" IN ('none','client_secret_post','client_secret_basic')),
	CONSTRAINT "oauth_redirect_json" CHECK(json_valid("lite_oauth_clients"."redirects_json"))
);
--> statement-breakpoint
CREATE TABLE `lite_oauth_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`resource` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `lite_oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `lite_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_grant_org` ON `lite_oauth_grants` (`org_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `lite_oauth_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_limit_expiry` ON `lite_oauth_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `lite_oauth_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`scope` text NOT NULL,
	`resource` text NOT NULL,
	`challenge` text NOT NULL,
	`state` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text NOT NULL,
	`user_id` text,
	`csrf_hash` text,
	`code_hash` text,
	`org_id` text,
	`grant_id` text,
	FOREIGN KEY (`client_id`) REFERENCES `lite_oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "oauth_request_status" CHECK("lite_oauth_requests"."status" IN ('pending','approved','used','denied'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_oauth_code` ON `lite_oauth_requests` (`code_hash`);--> statement-breakpoint
CREATE INDEX `idx_oauth_request_expiry` ON `lite_oauth_requests` (`expires_at`);--> statement-breakpoint
CREATE TABLE `lite_oauth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`scope` text NOT NULL,
	`access_hash` text NOT NULL,
	`refresh_hash` text NOT NULL,
	`access_expires_at` text NOT NULL,
	`refresh_expires_at` text NOT NULL,
	`rotated_to` text,
	FOREIGN KEY (`grant_id`) REFERENCES `lite_oauth_grants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_oauth_access` ON `lite_oauth_tokens` (`access_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_oauth_refresh` ON `lite_oauth_tokens` (`refresh_hash`);--> statement-breakpoint
CREATE INDEX `idx_oauth_token_grant` ON `lite_oauth_tokens` (`grant_id`);