CREATE TABLE `sites_demo_content` (
	`org_id` text NOT NULL,
	`id` text NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`org_id`, `id`),
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sites_demo_json" CHECK(json_valid("sites_demo_content"."value_json"))
);
--> statement-breakpoint
CREATE TABLE `sites_demo_preferences` (
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`org_id`, `user_id`, `key`),
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `lite_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sites_demo_pref_json" CHECK(json_valid("sites_demo_preferences"."value_json"))
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'backlog' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`executor_kind` text DEFAULT 'human' NOT NULL,
	`assignee_user_id` text,
	`parent_task_id` text,
	`created_by` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`hermes_task_id` text,
	`hermes_status` text,
	`recurring_schedule` text,
	`source` text DEFAULT 'ui' NOT NULL,
	`result` text,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_user_id`) REFERENCES `lite_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `lite_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tasks_status" CHECK("tasks"."status" IN ('backlog','in_progress','blocked','done','cancelled')),
	CONSTRAINT "tasks_executor" CHECK("tasks"."executor_kind" = 'human')
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_org_status` ON `tasks` (`org_id`,`status`,`position`);--> statement-breakpoint
CREATE TABLE `sites_nav_overrides` (
	`org_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`value_json` text NOT NULL,
	PRIMARY KEY(`org_id`, `entry_id`),
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sites_nav_json" CHECK(json_valid("sites_nav_overrides"."value_json"))
);
--> statement-breakpoint
CREATE TABLE `support_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`ticket_id` text NOT NULL,
	`created_at` text NOT NULL,
	`origine` text DEFAULT 'client' NOT NULL,
	`auteur` text,
	`corps` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_support_messages_org_ticket` ON `support_messages` (`org_id`,`ticket_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `support_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sujet` text NOT NULL,
	`statut` text DEFAULT 'ouvert' NOT NULL,
	`auteur` text,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "support_status" CHECK("support_tickets"."statut" IN ('ouvert','repondu','resolu','ferme'))
);
--> statement-breakpoint
CREATE INDEX `idx_support_tickets_org` ON `support_tickets` (`org_id`,`updated_at`);