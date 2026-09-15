CREATE TABLE `lite_access_groups` (
	`org_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`members_json` text DEFAULT '[]' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`org_id`, `id`),
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "access_group_members_json" CHECK(json_valid("lite_access_groups"."members_json"))
);
--> statement-breakpoint
CREATE TABLE `lite_api_policies` (
	`org_id` text NOT NULL,
	`group_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`effect` text NOT NULL,
	PRIMARY KEY(`org_id`, `group_id`, `operation_id`),
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "api_policy_effect" CHECK("lite_api_policies"."effect" IN ('allow','deny'))
);
--> statement-breakpoint
CREATE TABLE `lite_mcp_policies` (
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer NOT NULL,
	`version` integer NOT NULL,
	PRIMARY KEY(`org_id`, `name`),
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mcp_policy_enabled" CHECK("lite_mcp_policies"."enabled" IN (0,1))
);
--> statement-breakpoint
CREATE TABLE `lite_mcp_tools` (
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`operation_id` text NOT NULL,
	`description` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`org_id`, `name`),
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `lite_policy_versions` (
	`org_id` text NOT NULL,
	`group_id` text NOT NULL,
	`version` integer NOT NULL,
	`write_token` text NOT NULL,
	PRIMARY KEY(`org_id`, `group_id`),
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `lite_request_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`status` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`detail_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "request_log_json" CHECK(json_valid("lite_request_logs"."detail_json"))
);
--> statement-breakpoint
CREATE INDEX `idx_request_logs_org_created` ON `lite_request_logs` (`org_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `lite_usage_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`user_kind` text NOT NULL,
	`user_role` text NOT NULL,
	`event_type` text NOT NULL,
	`category` text NOT NULL,
	`label` text NOT NULL,
	`path` text,
	`session_id` text,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_usage_org_created` ON `lite_usage_events` (`org_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_usage_org_user_created` ON `lite_usage_events` (`org_id`,`user_id`,`created_at`);