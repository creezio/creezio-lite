CREATE TABLE `lite_search_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` text NOT NULL,
	`module_id` text NOT NULL,
	`record_id` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "search_document_json" CHECK(json_valid("lite_search_documents"."data"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_search_document_entity` ON `lite_search_documents` (`org_id`,`module_id`,`record_id`);--> statement-breakpoint
CREATE TABLE `lite_search_progress` (
	`org_id` text NOT NULL,
	`source` text NOT NULL,
	`cursor` text DEFAULT '' NOT NULL,
	`complete` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`org_id`, `source`),
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `lite_search_settings` (
	`org_id` text NOT NULL,
	`module_id` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`fields_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`org_id`, `module_id`),
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "search_fields_json" CHECK(json_valid("lite_search_settings"."fields_json"))
);
