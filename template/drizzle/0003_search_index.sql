-- Full-text index and transactional maintenance. Existing rows are backfilled by bounded requests.
CREATE VIRTUAL TABLE lite_search_fts USING fts5(document_id UNINDEXED, field_key UNINDEXED, value, tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER lite_search_document_insert AFTER INSERT ON lite_search_documents BEGIN
 
 INSERT INTO lite_search_fts(document_id,field_key,value)
 SELECT new.id,j.key,CASE j.type WHEN 'true' THEN 'true oui 1' WHEN 'false' THEN 'false non 0' ELSE CAST(j.value AS TEXT) END
 FROM json_each(new.data) j WHERE j.type NOT IN ('null','array','object') AND j.key NOT LIKE '\_%' ESCAPE '\';
 END;
--> statement-breakpoint
CREATE TRIGGER lite_search_document_update AFTER UPDATE ON lite_search_documents BEGIN
 DELETE FROM lite_search_fts WHERE document_id=old.id;
 INSERT INTO lite_search_fts(document_id,field_key,value)
 SELECT new.id,j.key,CASE j.type WHEN 'true' THEN 'true oui 1' WHEN 'false' THEN 'false non 0' ELSE CAST(j.value AS TEXT) END
 FROM json_each(new.data) j WHERE j.type NOT IN ('null','array','object') AND j.key NOT LIKE '\_%' ESCAPE '\';
 END;
--> statement-breakpoint
CREATE TRIGGER lite_search_document_delete AFTER DELETE ON lite_search_documents BEGIN DELETE FROM lite_search_fts WHERE document_id=old.id; END;
--> statement-breakpoint
CREATE VIEW lite_search_source_records(source,source_key,org_id,module_id,record_id,data,updated_at) AS
SELECT 'records' AS source,r.id AS source_key,r.org_id,r.module_id,r.id AS record_id,r.data,r.updated_at FROM lite_records r WHERE r.deleted_at IS NULL;
--> statement-breakpoint
CREATE VIEW lite_search_source_tasks(source,source_key,org_id,module_id,record_id,data,updated_at) AS
SELECT 'tasks',t.id,t.org_id,'tasks',t.id,json_object('title',t.title,'body',t.body,'status',t.status),t.updated_at FROM tasks t;
--> statement-breakpoint
CREATE VIEW lite_search_source_files(source,source_key,org_id,module_id,record_id,data,updated_at) AS
SELECT 'files',f.id,f.org_id,'files',f.id,json_object('name',f.name,'content_type',f.content_type),f.created_at FROM lite_files f WHERE f.deleted_at IS NULL;
--> statement-breakpoint
CREATE VIEW lite_search_source_members(source,source_key,org_id,module_id,record_id,data,updated_at) AS
SELECT 'members',m.user_id,m.org_id,'members',m.user_id,json_object('name',u.name,'email',u.email,'role',m.role),'1970-01-01' FROM lite_members m JOIN lite_users u ON u.id=m.user_id;
--> statement-breakpoint
CREATE VIEW lite_search_source_support(source,source_key,org_id,module_id,record_id,data,updated_at) AS
SELECT 'support','ticket:'||t.id,t.org_id,'support','ticket:'||t.id,json_object('title',t.sujet,'status',t.statut,'author',t.auteur,'_ticketId',t.id),t.updated_at FROM support_tickets t
UNION ALL
SELECT 'support','message:'||m.id,m.org_id,'support','message:'||m.id,json_object('title','Message de '||COALESCE(m.auteur,'l’équipe'),'body',m.corps,'author',m.auteur,'_ticketId',m.ticket_id),m.created_at FROM support_messages m;
--> statement-breakpoint
CREATE VIEW lite_search_source_audit(source,source_key,org_id,module_id,record_id,data,updated_at) AS
SELECT 'audit',a.id,a.org_id,'audit',a.id,json_object('action',a.action,'resource_id',a.resource_id,'user_name',COALESCE(u.name,'')),a.created_at FROM lite_audit a LEFT JOIN lite_users u ON u.id=a.user_id;
--> statement-breakpoint
CREATE TRIGGER lite_index_lite_records_insert AFTER INSERT ON lite_records BEGIN
 
 INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_records WHERE source='records' AND org_id=new.org_id AND source_key=new.id ON CONFLICT(org_id,module_id,record_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_lite_records_update AFTER UPDATE ON lite_records BEGIN
 DELETE FROM lite_search_documents WHERE org_id=old.org_id AND module_id=old.module_id AND record_id=old.id;
 INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_records WHERE source='records' AND org_id=new.org_id AND source_key=new.id ON CONFLICT(org_id,module_id,record_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_lite_records_delete AFTER DELETE ON lite_records BEGIN
 DELETE FROM lite_search_documents WHERE org_id=old.org_id AND module_id=old.module_id AND record_id=old.id;
 
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_tasks_insert AFTER INSERT ON tasks BEGIN
 
 INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_tasks WHERE source='tasks' AND org_id=new.org_id AND source_key=new.id ON CONFLICT(org_id,module_id,record_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_tasks_update AFTER UPDATE ON tasks BEGIN
 DELETE FROM lite_search_documents WHERE org_id=old.org_id AND module_id='tasks' AND record_id=old.id;
 INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_tasks WHERE source='tasks' AND org_id=new.org_id AND source_key=new.id ON CONFLICT(org_id,module_id,record_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_tasks_delete AFTER DELETE ON tasks BEGIN
 DELETE FROM lite_search_documents WHERE org_id=old.org_id AND module_id='tasks' AND record_id=old.id;
 
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_lite_files_insert AFTER INSERT ON lite_files BEGIN
 
 INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_files WHERE source='files' AND org_id=new.org_id AND source_key=new.id ON CONFLICT(org_id,module_id,record_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_lite_files_update AFTER UPDATE ON lite_files BEGIN
 DELETE FROM lite_search_documents WHERE org_id=old.org_id AND module_id='files' AND record_id=old.id;
 INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_files WHERE source='files' AND org_id=new.org_id AND source_key=new.id ON CONFLICT(org_id,module_id,record_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_lite_files_delete AFTER DELETE ON lite_files BEGIN
 DELETE FROM lite_search_documents WHERE org_id=old.org_id AND module_id='files' AND record_id=old.id;
 
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_lite_members_insert AFTER INSERT ON lite_members BEGIN
 
 INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_members WHERE source='members' AND org_id=new.org_id AND source_key=new.user_id ON CONFLICT(org_id,module_id,record_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_lite_members_update AFTER UPDATE ON lite_members BEGIN
 DELETE FROM lite_search_documents WHERE org_id=old.org_id AND module_id='members' AND record_id=old.user_id;
 INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_members WHERE source='members' AND org_id=new.org_id AND source_key=new.user_id ON CONFLICT(org_id,module_id,record_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_lite_members_delete AFTER DELETE ON lite_members BEGIN
 DELETE FROM lite_search_documents WHERE org_id=old.org_id AND module_id='members' AND record_id=old.user_id;
 
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_support_tickets_insert AFTER INSERT ON support_tickets BEGIN
 
 INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_support WHERE source='support' AND org_id=new.org_id AND source_key='ticket:'||new.id ON CONFLICT(org_id,module_id,record_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_support_tickets_update AFTER UPDATE ON support_tickets BEGIN
 DELETE FROM lite_search_documents WHERE org_id=old.org_id AND module_id='support' AND record_id='ticket:'||old.id;
 INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_support WHERE source='support' AND org_id=new.org_id AND source_key='ticket:'||new.id ON CONFLICT(org_id,module_id,record_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_support_tickets_delete AFTER DELETE ON support_tickets BEGIN
 DELETE FROM lite_search_documents WHERE org_id=old.org_id AND module_id='support' AND record_id='ticket:'||old.id;
 
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_support_messages_insert AFTER INSERT ON support_messages BEGIN
 
 INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_support WHERE source='support' AND org_id=new.org_id AND source_key='message:'||new.id ON CONFLICT(org_id,module_id,record_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_support_messages_update AFTER UPDATE ON support_messages BEGIN
 DELETE FROM lite_search_documents WHERE org_id=old.org_id AND module_id='support' AND record_id='message:'||old.id;
 INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_support WHERE source='support' AND org_id=new.org_id AND source_key='message:'||new.id ON CONFLICT(org_id,module_id,record_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_support_messages_delete AFTER DELETE ON support_messages BEGIN
 DELETE FROM lite_search_documents WHERE org_id=old.org_id AND module_id='support' AND record_id='message:'||old.id;
 
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_lite_audit_insert AFTER INSERT ON lite_audit BEGIN
 
 INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_audit WHERE source='audit' AND org_id=new.org_id AND source_key=new.id ON CONFLICT(org_id,module_id,record_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_lite_audit_update AFTER UPDATE ON lite_audit BEGIN
 DELETE FROM lite_search_documents WHERE org_id=old.org_id AND module_id='audit' AND record_id=old.id;
 INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_audit WHERE source='audit' AND org_id=new.org_id AND source_key=new.id ON CONFLICT(org_id,module_id,record_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_lite_audit_delete AFTER DELETE ON lite_audit BEGIN
 DELETE FROM lite_search_documents WHERE org_id=old.org_id AND module_id='audit' AND record_id=old.id;
 
END;
--> statement-breakpoint
CREATE TRIGGER lite_index_user_update AFTER UPDATE OF name,email ON lite_users BEGIN
 INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at)
 SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_members WHERE source='members' AND record_id=new.id
 ON CONFLICT(org_id,module_id,record_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;
END;
