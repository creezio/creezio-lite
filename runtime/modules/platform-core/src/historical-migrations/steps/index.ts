/**
 * Registre des migrations historiques **plateforme** (TF gold N4).
 * Versions = schema_version brand.db (chaîne TF / héritée).
 * Les steps métier (catalogue, commandes, …) restent dans les marques.
 */

import type { HistoricalMigration } from "../types.js";

import agentTodos from "./017_agent_todos.js";
import apiKeys from "./020_api_keys.js";
import mcpOauth from "./022_mcp_oauth.js";
import users from "./023_users.js";
import usersKind from "./024_users_kind.js";
import desktopPresence from "./025_desktop_presence.js";
import collabIaKanban from "./026_collab_ia_kanban.js";
import mcpAdmin from "./027_mcp_admin.js";
import pluginProductHub from "./028_plugin_product_hub.js";
import unifiedTasks from "./029_unified_tasks.js";
import pluginPrdSections from "./030_plugin_prd_sections.js";
import aiRecurrenceQuotas from "./031_ai_recurrence_quotas.js";
import pluginAcl from "./032_plugin_acl.js";
import databaseAutomations from "./033_database_automations.js";
import emails from "./034_emails.js";
import usageAnalytics from "./035_usage_analytics.js";

/** Versions stables TF gold — ne pas renommer après apply en prod. */
export const PLATFORM_HISTORICAL_STEP_VERSIONS = [
  17, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35,
] as const;

export type PlatformHistoricalStepVersion =
  (typeof PLATFORM_HISTORICAL_STEP_VERSIONS)[number];

/**
 * Steps plateforme historiques (brand.db).
 * Couverture core.db pour plugin_* = `platformCoreMigrations` + migrate-legacy.
 */
export function platformHistoricalMigrations(): HistoricalMigration[] {
  return [
    agentTodos,
    apiKeys,
    mcpOauth,
    users,
    usersKind,
    desktopPresence,
    collabIaKanban,
    mcpAdmin,
    pluginProductHub,
    unifiedTasks,
    pluginPrdSections,
    aiRecurrenceQuotas,
    pluginAcl,
    databaseAutomations,
    emails,
    usageAnalytics,
  ].sort((a, b) => a.version - b.version);
}

/** Lookup par name (O2 — compose marques sans wraps fichiers). */
export function platformHistoricalMigrationByName(
  name: string,
): HistoricalMigration {
  const m = platformHistoricalMigrations().find((x) => x.name === name);
  if (!m) {
    throw new Error(`platformHistoricalMigrations: ${name} manquant`);
  }
  return m;
}

