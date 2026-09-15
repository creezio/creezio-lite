CREATE TABLE `lite_mail_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`mail_id` text NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mail_id`) REFERENCES `lite_mail_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mail_parts` ON `lite_mail_attachments` (`org_id`,`mail_id`);--> statement-breakpoint
CREATE TABLE `lite_mail_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`external_key` text NOT NULL,
	`status` text NOT NULL,
	`folder` text NOT NULL,
	`data_json` text NOT NULL,
	`read_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mail_external` ON `lite_mail_messages` (`org_id`,`external_key`);--> statement-breakpoint
CREATE INDEX `idx_mail_folder` ON `lite_mail_messages` (`org_id`,`folder`,`created_at`);--> statement-breakpoint
CREATE TABLE `lite_mail_receivers` (
	`org_id` text PRIMARY KEY NOT NULL,
	`integration_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`integration_id`) REFERENCES `lite_integrations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lite_mail_sync` (
	`integration_id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`cursor` text DEFAULT '' NOT NULL,
	`lock_until` text,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`integration_id`) REFERENCES `lite_integrations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `lite_orgs`(`id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint
CREATE VIEW lite_search_source_mail AS SELECT org_id,'mail' AS source,id AS source_key,'mail' AS module_id,id AS record_id,json_object('subject',json_extract(data_json,'$.subject'),'from_addr',json_extract(data_json,'$.from_addr'),'to_addr',json_extract(data_json,'$.to_addr'),'text_body',json_extract(data_json,'$.text_body')) AS data,updated_at FROM lite_mail_messages WHERE folder!='trash';
--> statement-breakpoint
CREATE TRIGGER lite_mail_search_insert AFTER INSERT ON lite_mail_messages WHEN NEW.folder!='trash' BEGIN
 INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_mail WHERE record_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER lite_mail_search_update AFTER UPDATE ON lite_mail_messages BEGIN
 DELETE FROM lite_search_documents WHERE org_id=OLD.org_id AND module_id='mail' AND record_id=OLD.id;
 INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_mail WHERE record_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER lite_mail_search_delete AFTER DELETE ON lite_mail_messages BEGIN
 DELETE FROM lite_search_documents WHERE org_id=OLD.org_id AND module_id='mail' AND record_id=OLD.id;
END;
