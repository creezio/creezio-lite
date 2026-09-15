/**
 * Admin Plugins L3 — opérations CRUD binding + caps (Phase I5).
 * UI-agnostique : consommé par demobrand / console / marques.
 */

import type { PluginAclCapability, PluginAclEntry } from "../acl.js";
import { decidePluginAccess, type PluginAclActor } from "../acl.js";

export type PluginAclAdminStore = {
  listAcl(): PluginAclEntry[];
  getAcl(pluginId: string): PluginAclEntry;
  upsertAcl(entry: PluginAclEntry): void;
  clearAcl(pluginId: string): void;
  bindPluginOrg(pluginId: string, ownerOrgId: string): void;
  getPluginOwnerOrg(pluginId: string): string | null;
  getAclPolicy(pluginId: string): import("../acl.js").PluginAclPolicy;
};

export type PluginAclAdminRow = {
  pluginId: string;
  ownerOrgId: string | null;
  orgIds: string[];
  userIds: string[];
  capabilities: Array<{
    subjectKind: "org" | "user";
    subjectId: string;
    capability: PluginAclCapability;
  }>;
};

export type UpsertPluginAclAdminInput = {
  pluginId: string;
  ownerOrgId: string;
  /** Orgs membres (see/execute par défaut si pas de caps). */
  orgIds?: string[];
  userIds?: string[];
  /** Caps explicites (see / install / execute). */
  orgCapabilities?: Array<{
    orgId: string;
    capabilities: PluginAclCapability[];
  }>;
};

export function listPluginAclAdmin(store: PluginAclAdminStore): PluginAclAdminRow[] {
  return store.listAcl().map((e) => ({
    pluginId: e.pluginId,
    ownerOrgId: e.ownerOrgId ?? store.getPluginOwnerOrg(e.pluginId),
    orgIds: [...e.orgIds],
    userIds: [...e.userIds],
    capabilities: [...(e.capabilities || [])],
  }));
}

export function getPluginAclAdmin(
  store: PluginAclAdminStore,
  pluginId: string,
): PluginAclAdminRow | null {
  const owner = store.getPluginOwnerOrg(pluginId);
  const entry = store.getAcl(pluginId);
  if (!owner && entry.orgIds.length === 0 && entry.userIds.length === 0) {
    return null;
  }
  return {
    pluginId,
    ownerOrgId: entry.ownerOrgId ?? owner,
    orgIds: [...entry.orgIds],
    userIds: [...entry.userIds],
    capabilities: [...(entry.capabilities || [])],
  };
}

export function upsertPluginAclAdmin(
  store: PluginAclAdminStore,
  input: UpsertPluginAclAdminInput,
): PluginAclAdminRow {
  const pluginId = input.pluginId.trim();
  if (!pluginId) throw new Error("plugin_id_required");
  const ownerOrgId = input.ownerOrgId.trim();
  if (!ownerOrgId) throw new Error("owner_org_required");
  const orgIds = input.orgIds?.length ? input.orgIds : [ownerOrgId];
  const capabilities = (input.orgCapabilities || []).flatMap((g) =>
    g.capabilities.map((capability) => ({
      subjectKind: "org" as const,
      subjectId: g.orgId,
      capability,
    })),
  );
  store.bindPluginOrg(pluginId, ownerOrgId);
  store.upsertAcl({
    pluginId,
    orgIds,
    userIds: input.userIds || [],
    ownerOrgId,
    ...(capabilities.length > 0 ? { capabilities } : {}),
  });
  return getPluginAclAdmin(store, pluginId)!;
}

export function clearPluginAclAdmin(
  store: PluginAclAdminStore,
  pluginId: string,
): boolean {
  const before = getPluginAclAdmin(store, pluginId);
  store.clearAcl(pluginId);
  return Boolean(before);
}

/** Preview décision (UI Admin — deny cross-org). */
export function previewPluginAclAccess(
  store: PluginAclAdminStore,
  pluginId: string,
  actor: PluginAclActor,
  action: PluginAclCapability,
) {
  return decidePluginAccess(store.getAclPolicy(pluginId), actor, action);
}
