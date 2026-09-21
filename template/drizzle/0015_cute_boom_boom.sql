CREATE TABLE `sites_onboarding_content` (
	`org_id` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sites_onboarding_content_json" CHECK(json_valid("sites_onboarding_content"."value_json"))
);
--> statement-breakpoint
CREATE TABLE `sites_onboarding_preferences` (
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`org_id`, `user_id`, `key`),
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `lite_users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sites_onboarding_preferences_json" CHECK(json_valid("sites_onboarding_preferences"."value_json"))
);
