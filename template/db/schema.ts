import { sqliteTable, text, integer, primaryKey, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const users = sqliteTable('lite_users', {id:text('id').primaryKey(),email:text('email').notNull(),name:text('name').notNull()});
export const organizations = sqliteTable('lite_orgs', {id:text('id').primaryKey(),name:text('name').notNull(),createdAt:text('created_at').notNull()});
export const members = sqliteTable('lite_members', {
  orgId:text('org_id').notNull().references(()=>organizations.id,{onDelete:'cascade'}),
  userId:text('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),role:text('role').notNull(),
}, t=>[primaryKey({columns:[t.orgId,t.userId]}),index('idx_lite_members_user').on(t.userId),check('lite_member_role',sql`${t.role} IN ('owner','admin','member','viewer')`)]);
export const records = sqliteTable('lite_records', {
  id:text('id').primaryKey(),orgId:text('org_id').notNull().references(()=>organizations.id),moduleId:text('module_id').notNull(),
  data:text('data').notNull(),searchText:text('search_text').notNull(),version:integer('version').notNull().default(1),
  createdBy:text('created_by').notNull().references(()=>users.id),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),deletedAt:text('deleted_at'),
},t=>[index('idx_lite_records_module').on(t.orgId,t.moduleId,t.deletedAt,t.updatedAt,t.id),check('lite_record_json',sql`json_valid(${t.data})`),check('lite_record_version',sql`${t.version} >= 1`)]);
export const files = sqliteTable('lite_files', {
  id:text('id').primaryKey(),orgId:text('org_id').notNull().references(()=>organizations.id),name:text('name').notNull(),
  objectKey:text('object_key').notNull(),size:integer('size').notNull(),contentType:text('content_type').notNull(),
  createdBy:text('created_by').notNull().references(()=>users.id),createdAt:text('created_at').notNull(),deletedAt:text('deleted_at'),
},t=>[index('idx_lite_files_org').on(t.orgId,t.deletedAt,t.createdAt,t.id),uniqueIndex('idx_lite_files_key').on(t.objectKey),check('lite_file_size',sql`${t.size} > 0 AND ${t.size} <= 10485760`)]);
export const auditLog = sqliteTable('lite_audit', {
  id:text('id').primaryKey(),orgId:text('org_id').notNull().references(()=>organizations.id),userId:text('user_id').notNull(),
  action:text('action').notNull(),resourceId:text('resource_id').notNull(),details:text('details').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('idx_lite_audit_org').on(t.orgId,t.createdAt,t.id)]);
export const invitations = sqliteTable('lite_invites', {
  id:text('id').primaryKey(),orgId:text('org_id').notNull().references(()=>organizations.id),email:text('email').notNull(),role:text('role').notNull(),
  tokenHash:text('token_hash').notNull(),expiresAt:text('expires_at').notNull(),createdAt:text('created_at').notNull(),acceptedAt:text('accepted_at'),revokedAt:text('revoked_at'),
},t=>[uniqueIndex('idx_lite_invites_token').on(t.tokenHash),index('idx_lite_invites_org').on(t.orgId,t.createdAt),check('lite_invite_role',sql`${t.role} IN ('admin','member','viewer')`)]);

// Sites storage adapters keep the native API contracts; org_id scopes each query.
export const navOverrides = sqliteTable('sites_nav_overrides', {
  orgId:text('org_id').notNull().references(()=>organizations.id),entryId:text('entry_id').notNull(),valueJson:text('value_json').notNull(),
},t=>[primaryKey({columns:[t.orgId,t.entryId]}),check('sites_nav_json',sql`json_valid(${t.valueJson})`)]);
export const demoContent = sqliteTable('sites_demo_content', {
  orgId:text('org_id').notNull().references(()=>organizations.id),id:text('id').notNull(),valueJson:text('value_json').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.orgId,t.id]}),check('sites_demo_json',sql`json_valid(${t.valueJson})`)]);
export const demoPreferences = sqliteTable('sites_demo_preferences', {
  orgId:text('org_id').notNull().references(()=>organizations.id),userId:text('user_id').notNull().references(()=>users.id),key:text('key').notNull(),valueJson:text('value_json').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.orgId,t.userId,t.key]}),check('sites_demo_pref_json',sql`json_valid(${t.valueJson})`)]);
export const supportTickets = sqliteTable('support_tickets', {
  id:text('id').primaryKey(),orgId:text('org_id').notNull().references(()=>organizations.id),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),sujet:text('sujet').notNull(),statut:text('statut').notNull().default('ouvert'),auteur:text('auteur'),
},t=>[index('idx_support_tickets_org').on(t.orgId,t.updatedAt),check('support_status',sql`${t.statut} IN ('ouvert','repondu','resolu','ferme')`)]);
export const supportMessages = sqliteTable('support_messages', {
  id:text('id').primaryKey(),orgId:text('org_id').notNull().references(()=>organizations.id),ticketId:text('ticket_id').notNull().references(()=>supportTickets.id,{onDelete:'cascade'}),createdAt:text('created_at').notNull(),origine:text('origine').notNull().default('client'),auteur:text('auteur'),corps:text('corps').notNull(),
},t=>[index('idx_support_messages_org_ticket').on(t.orgId,t.ticketId,t.createdAt)]);
export const nativeTasks = sqliteTable('tasks', {
  id:text('id').primaryKey(),orgId:text('org_id').notNull().references(()=>organizations.id),title:text('title').notNull(),body:text('body').notNull().default(''),status:text('status').notNull().default('backlog'),position:integer('position').notNull().default(0),executorKind:text('executor_kind').notNull().default('human'),assigneeUserId:text('assignee_user_id').references(()=>users.id),parentTaskId:text('parent_task_id'),createdBy:text('created_by').notNull().references(()=>users.id),priority:integer('priority').notNull().default(0),hermesTaskId:text('hermes_task_id'),hermesStatus:text('hermes_status'),recurringSchedule:text('recurring_schedule'),source:text('source').notNull().default('ui'),result:text('result'),lastSyncedAt:text('last_synced_at'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[index('idx_tasks_org_status').on(t.orgId,t.status,t.position),check('tasks_status',sql`${t.status} IN ('backlog','in_progress','blocked','done','cancelled')`),check('tasks_executor',sql`${t.executorKind} = 'human'`)]);
