/**
 * @creezio/database — Admin Database natif + automations row-level.
 *
 * Fail-closed : CRUD métier impossible sans `configureDatabasePolicy({ crudAllowlist })`.
 * Ne pas confondre avec `@creezio/automations` (lifecycle plugins/org — V3 prototype).
 */

export type {
  SqliteDatabase,
  SqliteStatement,
  SqliteRunResult,
  OpenSqliteDatabase,
} from "./sqlite-driver.js";
export { openNodeSqliteDatabase } from "./sqlite-driver.js";

export { DATABASE_CORE_SQL } from "./schema.js";

export type {
  DatabaseEngineAdapters,
  DatabaseWebhookBrand,
} from "./adapters.js";
export {
  configureDatabaseEngine,
  configureDatabaseWebhookBrand,
  getDatabaseEngineAdapters,
  getDatabaseWebhookBrand,
} from "./adapters.js";

export {
  isSafeIdentifier,
  quoteIdent,
  isSystemTable,
} from "./identifiers.js";

export {
  DEFAULT_FORBIDDEN_WRITE_TABLES,
  CRUD_WHITELIST,
  FORBIDDEN_WRITE_TABLES,
  configureDatabasePolicy,
  getCrudAllowlist,
  getForbiddenWriteTables,
  canCrudTable,
  canAutomateTable,
} from "./whitelist.js";

export type {
  CompareOp,
  ConditionRule,
  ConditionGroup,
  ConditionContext,
} from "./conditions.js";
export { evaluateConditions, parseConditions } from "./conditions.js";

export type { CatalogEntry, ColumnInfo } from "./catalog.js";
export { listCatalog, getTableMeta } from "./catalog.js";

export type { BrowseFilter, BrowseOptions } from "./query.js";
export { jsonRow, browseTable, getRowByRowid } from "./query.js";

export { logDatabaseAccess, listAccessLog } from "./access-log.js";

export type { SavedViewConfig, SavedView } from "./views.js";
export {
  listSavedViews,
  createSavedView,
  updateSavedView,
  deleteSavedView,
} from "./views.js";

export type {
  AutomationTriggerType,
  WebhookAction,
  PluginAction,
  N8nAction,
  AutomationAction,
  Automation,
} from "./automations-store.js";
export {
  listAutomations,
  getAutomation,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  listAutomationRuns,
} from "./automations-store.js";

export {
  syncAutomationTriggers,
  syncAllAutomationTriggers,
} from "./triggers.js";

export type { WebhookDeliveryResult } from "./webhooks.js";
export {
  assertWebhookUrl,
  signWebhookBody,
  deliverWebhook,
  retryDelaySeconds,
  MAX_WEBHOOK_ATTEMPTS,
} from "./webhooks.js";

export type { AutomationEvent } from "./engine.js";
export {
  processAutomationEvent,
  processPendingEvents,
  processRetries,
  fireButtonAutomations,
  startAutomationWorker,
} from "./engine.js";

export { insertRow, updateRow, deleteRow } from "./crud.js";
export { exportTable } from "./export.js";

export type {
  DatabaseStoreDef,
  DatabaseStoreInfo,
  DatabaseStoreLayer,
} from "./stores.js";
export {
  clearDatabaseStores,
  getDatabaseStore,
  listDatabaseStores,
  registerDatabaseStore,
  resolveDatabaseStore,
  unregisterDatabaseStore,
} from "./stores.js";

export type { AdminDatabaseRouteDeps } from "./http/admin-routes.js";
export { createAdminDatabaseRoutes } from "./http/admin-routes.js";
