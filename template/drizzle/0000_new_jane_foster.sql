CREATE TABLE `lite_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`resource_id` text NOT NULL,
	`details` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_lite_audit_org` ON `lite_audit` (`org_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `lite_files` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`object_key` text NOT NULL,
	`size` integer NOT NULL,
	`content_type` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `lite_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lite_file_size" CHECK("lite_files"."size" > 0 AND "lite_files"."size" <= 10485760)
);
--> statement-breakpoint
CREATE INDEX `idx_lite_files_org` ON `lite_files` (`org_id`,`deleted_at`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_lite_files_key` ON `lite_files` (`object_key`);--> statement-breakpoint
CREATE TABLE `lite_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`accepted_at` text,
	`revoked_at` text,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lite_invite_role" CHECK("lite_invites"."role" IN ('admin','member','viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_lite_invites_token` ON `lite_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_lite_invites_org` ON `lite_invites` (`org_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `lite_members` (
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`org_id`, `user_id`),
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `lite_users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lite_member_role" CHECK("lite_members"."role" IN ('owner','admin','member','viewer'))
);
--> statement-breakpoint
CREATE INDEX `idx_lite_members_user` ON `lite_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `lite_orgs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lite_records` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`module_id` text NOT NULL,
	`data` text NOT NULL,
	`search_text` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `lite_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lite_record_json" CHECK(json_valid("lite_records"."data")),
	CONSTRAINT "lite_record_version" CHECK("lite_records"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `idx_lite_records_module` ON `lite_records` (`org_id`,`module_id`,`deleted_at`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `lite_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL
);
