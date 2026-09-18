CREATE TABLE `lite_generated_files` (
	`org_id` text NOT NULL,
	`intent_id` text NOT NULL,
	`generation` text NOT NULL,
	`file_id` text NOT NULL,
	`digest` text NOT NULL,
	`owner_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`capabilities_json` text NOT NULL,
	`object_key` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`org_id`, `intent_id`, `generation`),
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lite_generated_file_size" CHECK("lite_generated_files"."size">0 AND "lite_generated_files"."size"<=10485760),
	CONSTRAINT "lite_generated_file_capabilities" CHECK(json_valid("lite_generated_files"."capabilities_json")),
	CONSTRAINT "lite_generated_file_state" CHECK("lite_generated_files"."state" IN ('staging','staged','published','abandoned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lite_generated_files_id` ON `lite_generated_files` (`file_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `lite_generated_files_key` ON `lite_generated_files` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `lite_generated_files_published_intent` ON `lite_generated_files` (`org_id`,`intent_id`) WHERE "lite_generated_files"."state"='published';