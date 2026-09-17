CREATE TABLE lite_access_receipts (
 org_id TEXT PRIMARY KEY NOT NULL REFERENCES lite_orgs(id) ON DELETE CASCADE,
 receipt_json TEXT NOT NULL CONSTRAINT access_receipt_json CHECK(json_valid(receipt_json)),
 version INTEGER NOT NULL DEFAULT 1 CONSTRAINT access_receipt_version CHECK(version >= 1),
 updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE lite_access_epochs (
 org_id TEXT PRIMARY KEY NOT NULL REFERENCES lite_orgs(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0 CONSTRAINT access_epoch_revision CHECK(revision >= 0),
 write_token TEXT
);
--> statement-breakpoint
INSERT INTO lite_access_epochs(org_id) SELECT id FROM lite_orgs;
--> statement-breakpoint
CREATE TRIGGER lite_access_org_insert AFTER INSERT ON lite_orgs BEGIN INSERT INTO lite_access_epochs(org_id) VALUES(NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER lite_members_access_insert AFTER INSERT ON lite_members BEGIN UPDATE lite_access_epochs SET revision=revision+1 WHERE org_id=NEW.org_id; END;
--> statement-breakpoint
CREATE TRIGGER lite_members_access_update AFTER UPDATE ON lite_members BEGIN UPDATE lite_access_epochs SET revision=revision+1 WHERE org_id=NEW.org_id; UPDATE lite_access_epochs SET revision=revision+1 WHERE org_id=OLD.org_id AND OLD.org_id!=NEW.org_id; END;
--> statement-breakpoint
CREATE TRIGGER lite_members_access_delete AFTER DELETE ON lite_members BEGIN UPDATE lite_access_epochs SET revision=revision+1 WHERE org_id=OLD.org_id; END;
--> statement-breakpoint
CREATE TRIGGER lite_access_groups_access_insert AFTER INSERT ON lite_access_groups BEGIN UPDATE lite_access_epochs SET revision=revision+1 WHERE org_id=NEW.org_id; END;
--> statement-breakpoint
CREATE TRIGGER lite_access_groups_access_update AFTER UPDATE ON lite_access_groups BEGIN UPDATE lite_access_epochs SET revision=revision+1 WHERE org_id=NEW.org_id; UPDATE lite_access_epochs SET revision=revision+1 WHERE org_id=OLD.org_id AND OLD.org_id!=NEW.org_id; END;
--> statement-breakpoint
CREATE TRIGGER lite_access_groups_access_delete AFTER DELETE ON lite_access_groups BEGIN UPDATE lite_access_epochs SET revision=revision+1 WHERE org_id=OLD.org_id; END;
--> statement-breakpoint
CREATE TRIGGER lite_api_policies_access_insert AFTER INSERT ON lite_api_policies BEGIN UPDATE lite_access_epochs SET revision=revision+1 WHERE org_id=NEW.org_id; END;
--> statement-breakpoint
CREATE TRIGGER lite_api_policies_access_update AFTER UPDATE ON lite_api_policies BEGIN UPDATE lite_access_epochs SET revision=revision+1 WHERE org_id=NEW.org_id; UPDATE lite_access_epochs SET revision=revision+1 WHERE org_id=OLD.org_id AND OLD.org_id!=NEW.org_id; END;
--> statement-breakpoint
CREATE TRIGGER lite_api_policies_access_delete AFTER DELETE ON lite_api_policies BEGIN UPDATE lite_access_epochs SET revision=revision+1 WHERE org_id=OLD.org_id; END;
--> statement-breakpoint
CREATE TRIGGER lite_access_receipts_access_insert AFTER INSERT ON lite_access_receipts BEGIN UPDATE lite_access_epochs SET revision=revision+1 WHERE org_id=NEW.org_id; END;
--> statement-breakpoint
CREATE TRIGGER lite_access_receipts_access_update AFTER UPDATE ON lite_access_receipts BEGIN UPDATE lite_access_epochs SET revision=revision+1 WHERE org_id=NEW.org_id; UPDATE lite_access_epochs SET revision=revision+1 WHERE org_id=OLD.org_id AND OLD.org_id!=NEW.org_id; END;
--> statement-breakpoint
CREATE TRIGGER lite_access_receipts_access_delete AFTER DELETE ON lite_access_receipts BEGIN UPDATE lite_access_epochs SET revision=revision+1 WHERE org_id=OLD.org_id; END;
