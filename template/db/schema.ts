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
