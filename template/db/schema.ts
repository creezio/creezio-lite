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

export const searchDocuments = sqliteTable('lite_search_documents', {
  id:integer('id').primaryKey({autoIncrement:true}),orgId:text('org_id').notNull().references(()=>organizations.id),
  moduleId:text('module_id').notNull(),recordId:text('record_id').notNull(),data:text('data').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('idx_search_document_entity').on(t.orgId,t.moduleId,t.recordId),check('search_document_json',sql`json_valid(${t.data})`)]);
export const searchSettings = sqliteTable('lite_search_settings', {
  orgId:text('org_id').notNull().references(()=>organizations.id),moduleId:text('module_id').notNull(),enabled:integer('enabled').notNull().default(1),
  fieldsJson:text('fields_json').notNull(),version:integer('version').notNull().default(1),
},t=>[primaryKey({columns:[t.orgId,t.moduleId]}),check('search_fields_json',sql`json_valid(${t.fieldsJson})`)]);
export const searchProgress = sqliteTable('lite_search_progress', {
  orgId:text('org_id').notNull().references(()=>organizations.id),source:text('source').notNull(),cursor:text('cursor').notNull().default(''),complete:integer('complete').notNull().default(0),
},t=>[primaryKey({columns:[t.orgId,t.source]})]);
export const accessTokens = sqliteTable('lite_access_tokens', {
  id:text('id').primaryKey(),orgId:text('org_id').notNull().references(()=>organizations.id),userId:text('user_id').notNull().references(()=>users.id),
  name:text('name').notNull(),mode:text('mode').notNull(),tokenHash:text('token_hash').notNull(),createdAt:text('created_at').notNull(),expiresAt:text('expires_at').notNull(),revokedAt:text('revoked_at'),
},t=>[uniqueIndex('idx_access_token_hash').on(t.tokenHash),index('idx_access_token_owner').on(t.orgId,t.userId),check('access_token_mode',sql`${t.mode} IN ('read','write')`)]);

export const accessGroups = sqliteTable('lite_access_groups', {
  orgId:text('org_id').notNull().references(()=>organizations.id),id:text('id').notNull(),name:text('name').notNull(),
  membersJson:text('members_json').notNull().default('[]'),version:integer('version').notNull().default(1),createdAt:text('created_at').notNull(),
},t=>[primaryKey({columns:[t.orgId,t.id]}),check('access_group_members_json',sql`json_valid(${t.membersJson})`)]);
export const apiPolicies = sqliteTable('lite_api_policies', {
  orgId:text('org_id').notNull().references(()=>organizations.id),groupId:text('group_id').notNull(),operationId:text('operation_id').notNull(),effect:text('effect').notNull(),
},t=>[primaryKey({columns:[t.orgId,t.groupId,t.operationId]}),check('api_policy_effect',sql`${t.effect} IN ('allow','deny')`)]);
export const policyVersions = sqliteTable('lite_policy_versions', {
  orgId:text('org_id').notNull().references(()=>organizations.id),groupId:text('group_id').notNull(),version:integer('version').notNull(),writeToken:text('write_token').notNull(),
},t=>[primaryKey({columns:[t.orgId,t.groupId]})]);
export const mcpPolicies = sqliteTable('lite_mcp_policies', {
  orgId:text('org_id').notNull().references(()=>organizations.id),name:text('name').notNull(),enabled:integer('enabled').notNull(),version:integer('version').notNull(),
},t=>[primaryKey({columns:[t.orgId,t.name]}),check('mcp_policy_enabled',sql`${t.enabled} IN (0,1)`)]);
export const mcpTools = sqliteTable('lite_mcp_tools', {
  orgId:text('org_id').notNull().references(()=>organizations.id),name:text('name').notNull(),operationId:text('operation_id').notNull(),description:text('description').notNull(),createdAt:text('created_at').notNull(),
},t=>[primaryKey({columns:[t.orgId,t.name]})]);
export const requestLogs = sqliteTable('lite_request_logs', {
  id:text('id').primaryKey(),orgId:text('org_id').notNull().references(()=>organizations.id),userId:text('user_id').notNull(),source:text('source').notNull(),
  method:text('method').notNull(),path:text('path').notNull(),status:integer('status').notNull(),durationMs:integer('duration_ms').notNull(),detailJson:text('detail_json').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('idx_request_logs_org_created').on(t.orgId,t.createdAt,t.id),check('request_log_json',sql`json_valid(${t.detailJson})`)]);
export const usageEvents = sqliteTable('lite_usage_events', {
  id:integer('id').primaryKey({autoIncrement:true}),orgId:text('org_id').notNull().references(()=>organizations.id),userId:text('user_id').notNull(),username:text('username').notNull(),userKind:text('user_kind').notNull(),userRole:text('user_role').notNull(),
  eventType:text('event_type').notNull(),category:text('category').notNull(),label:text('label').notNull(),path:text('path'),sessionId:text('session_id'),durationMs:integer('duration_ms').notNull().default(0),createdAt:text('created_at').notNull(),
},t=>[index('idx_usage_org_created').on(t.orgId,t.createdAt,t.id),index('idx_usage_org_user_created').on(t.orgId,t.userId,t.createdAt)]);

export const integrations = sqliteTable('lite_integrations', {
  id:text('id').primaryKey(),orgId:text('org_id').notNull().references(()=>organizations.id),slug:text('slug').notNull(),provider:text('provider').notNull(),label:text('label').notNull(),
  secretBox:text('secret_box').notNull(),metaJson:text('meta_json').notNull(),enabled:integer('enabled').notNull().default(1),version:integer('version').notNull().default(1),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('idx_integrations_org_slug').on(t.orgId,t.slug),check('integration_json',sql`json_valid(${t.metaJson})`),check('integration_enabled',sql`${t.enabled} IN (0,1)`)]);
export const assistantConversations = sqliteTable('lite_assistant_conversations', {
  id:text('id').primaryKey(),orgId:text('org_id').notNull().references(()=>organizations.id),userId:text('user_id').notNull().references(()=>users.id),title:text('title').notNull(),mode:text('mode').notNull(),model:text('model').notNull(),
  version:integer('version').notNull().default(1),activeRun:text('active_run'),lockedUntil:text('locked_until'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[index('idx_assistant_conversations_user').on(t.orgId,t.userId,t.updatedAt),check('assistant_mode',sql`${t.mode} IN ('chat','work')`)]);
export const assistantMessages = sqliteTable('lite_assistant_messages', {
  sequence:integer('sequence').primaryKey({autoIncrement:true}),id:text('id').notNull(),conversationId:text('conversation_id').notNull().references(()=>assistantConversations.id,{onDelete:'cascade'}),orgId:text('org_id').notNull().references(()=>organizations.id),userId:text('user_id').notNull().references(()=>users.id),role:text('role').notNull(),content:text('content').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('idx_assistant_messages_thread').on(t.conversationId,t.sequence),check('assistant_message_role',sql`${t.role} IN ('user','assistant')`)]);
export const assistantRuns = sqliteTable('lite_assistant_runs', {
  id:text('id').primaryKey(),conversationId:text('conversation_id').notNull().references(()=>assistantConversations.id,{onDelete:'cascade'}),orgId:text('org_id').notNull().references(()=>organizations.id),userId:text('user_id').notNull().references(()=>users.id),traceJson:text('trace_json').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('idx_assistant_runs_thread').on(t.conversationId,t.createdAt),check('assistant_trace_json',sql`json_valid(${t.traceJson})`)]);

export const mailMessages=sqliteTable('lite_mail_messages',{
 id:text('id').primaryKey(),orgId:text('org_id').notNull().references(()=>organizations.id,{onDelete:'cascade'}),
 externalKey:text('external_key').notNull(),status:text('status').notNull(),folder:text('folder').notNull(),dataJson:text('data_json').notNull(),
 readAt:text('read_at'),version:integer('version').notNull().default(1),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('idx_mail_external').on(t.orgId,t.externalKey),index('idx_mail_folder').on(t.orgId,t.folder,t.createdAt)]);
export const mailAttachments=sqliteTable('lite_mail_attachments',{
 id:text('id').primaryKey(),orgId:text('org_id').notNull().references(()=>organizations.id,{onDelete:'cascade'}),
 mailId:text('mail_id').notNull().references(()=>mailMessages.id,{onDelete:'cascade'}),objectKey:text('object_key').notNull(),filename:text('filename').notNull(),contentType:text('content_type').notNull(),sizeBytes:integer('size_bytes').notNull(),
},t=>[index('idx_mail_parts').on(t.orgId,t.mailId)]);
export const mailReceivers=sqliteTable('lite_mail_receivers',{
 orgId:text('org_id').primaryKey().references(()=>organizations.id,{onDelete:'cascade'}),integrationId:text('integration_id').notNull().references(()=>integrations.id,{onDelete:'cascade'}),
 tokenHash:text('token_hash').notNull(),updatedAt:text('updated_at').notNull(),
});
export const mailSync=sqliteTable('lite_mail_sync',{
 integrationId:text('integration_id').primaryKey().references(()=>integrations.id,{onDelete:'cascade'}),orgId:text('org_id').notNull().references(()=>organizations.id,{onDelete:'cascade'}),
 cursor:text('cursor').notNull().default(''),lockUntil:text('lock_until'),version:integer('version').notNull().default(1),updatedAt:text('updated_at').notNull(),
});

export const assistantUiActions = sqliteTable('lite_assistant_ui_actions', {
  id:text('id').primaryKey(),conversationId:text('conversation_id').notNull().references(()=>assistantConversations.id,{onDelete:'cascade'}),
  orgId:text('org_id').notNull().references(()=>organizations.id),userId:text('user_id').notNull().references(()=>users.id),
  targetWindowId:text('target_window_id'),actionType:text('action_type'),payloadJson:text('payload_json'),createdAt:text('created_at'),claimedAt:text('claimed_at'),completedAt:text('completed_at'),
  runId:text('run_id').notNull(),status:text('status').notNull(),resultJson:text('result_json'),expiresAt:text('expires_at').notNull(),
},t=>[index('idx_assistant_ui_expiry').on(t.orgId,t.userId,t.expiresAt),check('assistant_ui_status',sql`${t.status} IN ('pending','claimed','completed')`)]);

// OAuth clients are public registrations; grants are bound to an existing member.
export const oauthClients=sqliteTable('lite_oauth_clients',{
 id:text('id').primaryKey(),name:text('name').notNull(),redirectsJson:text('redirects_json').notNull(),authMethod:text('auth_method').notNull(),secretHash:text('secret_hash'),createdAt:text('created_at').notNull(),revokedAt:text('revoked_at'),
},t=>[check('oauth_client_method',sql`${t.authMethod} IN ('none','client_secret_post','client_secret_basic')`),check('oauth_redirect_json',sql`json_valid(${t.redirectsJson})`)]);
export const oauthRequests=sqliteTable('lite_oauth_requests',{
 id:text('id').primaryKey(),clientId:text('client_id').notNull().references(()=>oauthClients.id,{onDelete:'cascade'}),redirectUri:text('redirect_uri').notNull(),scope:text('scope').notNull(),resource:text('resource').notNull(),challenge:text('challenge').notNull(),state:text('state').notNull(),expiresAt:text('expires_at').notNull(),status:text('status').notNull(),
 userId:text('user_id'),csrfHash:text('csrf_hash'),codeHash:text('code_hash'),orgId:text('org_id'),grantId:text('grant_id'),
},t=>[uniqueIndex('idx_oauth_code').on(t.codeHash),index('idx_oauth_request_expiry').on(t.expiresAt),check('oauth_request_status',sql`${t.status} IN ('pending','approved','used','denied')`)]);
export const oauthGrants=sqliteTable('lite_oauth_grants',{
 id:text('id').primaryKey(),clientId:text('client_id').notNull().references(()=>oauthClients.id,{onDelete:'cascade'}),orgId:text('org_id').notNull().references(()=>organizations.id,{onDelete:'cascade'}),userId:text('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),scope:text('scope').notNull(),resource:text('resource').notNull(),createdAt:text('created_at').notNull(),expiresAt:text('expires_at').notNull(),revokedAt:text('revoked_at'),
},t=>[index('idx_oauth_grant_org').on(t.orgId,t.createdAt)]);
export const oauthTokens=sqliteTable('lite_oauth_tokens',{
 id:text('id').primaryKey(),grantId:text('grant_id').notNull().references(()=>oauthGrants.id,{onDelete:'cascade'}),scope:text('scope').notNull(),accessHash:text('access_hash').notNull(),refreshHash:text('refresh_hash').notNull(),accessExpiresAt:text('access_expires_at').notNull(),refreshExpiresAt:text('refresh_expires_at').notNull(),rotatedTo:text('rotated_to'),
},t=>[uniqueIndex('idx_oauth_access').on(t.accessHash),uniqueIndex('idx_oauth_refresh').on(t.refreshHash),index('idx_oauth_token_grant').on(t.grantId)]);
export const oauthLimits=sqliteTable('lite_oauth_limits',{
 id:text('id').primaryKey(),count:integer('count').notNull(),expiresAt:text('expires_at').notNull(),
},t=>[index('idx_oauth_limit_expiry').on(t.expiresAt)]);

export const browserSessions=sqliteTable('lite_browser_sessions',{
 orgId:text('org_id').notNull().references(()=>organizations.id,{onDelete:'cascade'}),userId:text('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),kind:text('kind').notNull(),windowId:text('window_id').notNull(),leaseUntil:text('lease_until').notNull(),path:text('path').notNull(),
},t=>[primaryKey({columns:[t.orgId,t.userId,t.kind]}),check('browser_session_kind',sql`${t.kind} IN ('desktop','controller')`)]);
export const browserEvents=sqliteTable('lite_browser_events',{
 id:text('id').primaryKey(),orgId:text('org_id').notNull().references(()=>organizations.id,{onDelete:'cascade'}),userId:text('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),windowId:text('window_id'),actionId:text('action_id'),runId:text('run_id'),conversationId:text('conversation_id'),event:text('event').notNull(),detailJson:text('detail_json').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('idx_browser_events_owner_time').on(t.orgId,t.userId,t.createdAt),index('idx_browser_events_conversation').on(t.orgId,t.userId,t.conversationId,t.createdAt)]);

// Signed public-ingress fencing only. Not a guest-token store; no request body.
export const publicIngressClaims = sqliteTable('lite_public_ingress_claims', {
  tenantId: text('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  entryId: text('entry_id').notNull(),
  eventId: text('event_id').notNull(),
  digestHex: text('digest_hex').notNull(),
  state: text('state').notNull(),
  generation: integer('generation').notNull(),
  token: text('token').notNull(),
  attempts: integer('attempts').notNull(),
  leaseUntil: text('lease_until').notNull(),
  snapshotJson: text('snapshot_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [
  primaryKey({ columns: [t.tenantId, t.entryId, t.eventId] }),
  check('ingress_claim_state', sql`${t.state} IN ('processing','retryable','completed','permanent_failure','attempts_exhausted')`),
  check('ingress_claim_generation', sql`${t.generation} >= 1`),
  check('ingress_claim_attempts', sql`${t.attempts} >= 1`),
  check('ingress_claim_snapshot_json', sql`${t.snapshotJson} IS NULL OR json_valid(${t.snapshotJson})`),
]);

// Native adoption receipts. The epoch guards every group/membership/policy/receipt mutation.
export const accessReceipts = sqliteTable('lite_access_receipts', {
  orgId:text('org_id').primaryKey().notNull().references(()=>organizations.id,{onDelete:'cascade'}),
  receiptJson:text('receipt_json').notNull(),version:integer('version').notNull().default(1),updatedAt:text('updated_at').notNull(),
},t=>[check('access_receipt_json',sql`json_valid(${t.receiptJson})`),check('access_receipt_version',sql`${t.version} >= 1`)]);
export const accessEpochs = sqliteTable('lite_access_epochs', {
  orgId:text('org_id').primaryKey().notNull().references(()=>organizations.id,{onDelete:'cascade'}),
  revision:integer('revision').notNull().default(0),writeToken:text('write_token'),
},t=>[check('access_epoch_revision',sql`${t.revision} >= 0`)]);

export const generatedFiles = sqliteTable('lite_generated_files', {
 orgId:text('org_id').notNull().references(()=>organizations.id,{onDelete:'cascade'}),intentId:text('intent_id').notNull(),generation:text('generation').notNull(),
 fileId:text('file_id').notNull(),digest:text('digest').notNull(),ownerId:text('owner_id').notNull(),actorId:text('actor_id').notNull(),
 name:text('name').notNull(),contentType:text('content_type').notNull(),size:integer('size').notNull(),capabilitiesJson:text('capabilities_json').notNull(),
 objectKey:text('object_key').notNull(),state:text('state').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.orgId,t.intentId,t.generation]}),uniqueIndex('lite_generated_files_id').on(t.fileId),uniqueIndex('lite_generated_files_key').on(t.objectKey),
 uniqueIndex('lite_generated_files_published_intent').on(t.orgId,t.intentId).where(sql`${t.state}='published'`),
 check('lite_generated_file_size',sql`${t.size}>0 AND ${t.size}<=10485760`),check('lite_generated_file_capabilities',sql`json_valid(${t.capabilitiesJson})`),
 check('lite_generated_file_state',sql`${t.state} IN ('staging','staged','published','abandoned')`)]);

// Standalone password authentication. Accounts bind only to an explicit lite_users id.
export const passwordAccounts=sqliteTable('lite_password_accounts',{
 userId:text('user_id').primaryKey().references(()=>users.id,{onDelete:'cascade'}),usernameNorm:text('username_norm').notNull(),emailNorm:text('email_norm').notNull(),
 passwordSalt:text('password_salt'),passwordHash:text('password_hash'),passwordIterations:integer('password_iterations'),activatedAt:text('activated_at'),disabledAt:text('disabled_at'),expiresAt:text('expires_at'),
 authVersion:integer('auth_version').notNull().default(1),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('lite_password_accounts_username').on(t.usernameNorm),uniqueIndex('lite_password_accounts_email').on(t.emailNorm),check('lite_password_account_version',sql`${t.authVersion} >= 1`),check('lite_password_account_secret',sql`(${t.passwordSalt} IS NULL AND ${t.passwordHash} IS NULL AND ${t.passwordIterations} IS NULL) OR (${t.passwordSalt} IS NOT NULL AND ${t.passwordHash} IS NOT NULL AND ${t.passwordIterations}=100000)`) ]);
export const passwordSessions=sqliteTable('lite_password_sessions',{
 sessionHash:text('session_hash').primaryKey(),userId:text('user_id').notNull().references(()=>passwordAccounts.userId,{onDelete:'cascade'}),authVersion:integer('auth_version').notNull(),createdAt:text('created_at').notNull(),expiresAt:text('expires_at').notNull(),revokedAt:text('revoked_at'),
},t=>[index('lite_password_sessions_user').on(t.userId,t.expiresAt),check('lite_password_session_version',sql`${t.authVersion} >= 1`)]);
export const passwordTokens=sqliteTable('lite_password_tokens',{
 tokenHash:text('token_hash').primaryKey(),userId:text('user_id').notNull().references(()=>passwordAccounts.userId,{onDelete:'cascade'}),purpose:text('purpose').notNull(),expiresAt:text('expires_at').notNull(),createdAt:text('created_at').notNull(),consumedAt:text('consumed_at'),
},t=>[index('lite_password_tokens_user').on(t.userId,t.purpose,t.expiresAt),check('lite_password_token_purpose',sql`${t.purpose} IN ('activation','reset')`)]);
export const passwordThrottles=sqliteTable('lite_password_throttles',{
 bucketHash:text('bucket_hash').primaryKey(),attempts:integer('attempts').notNull(),windowExpiresAt:text('window_expires_at').notNull(),
},t=>[index('lite_password_throttles_expiry').on(t.windowExpiresAt),check('lite_password_throttle_attempts',sql`${t.attempts} >= 1`)]);
