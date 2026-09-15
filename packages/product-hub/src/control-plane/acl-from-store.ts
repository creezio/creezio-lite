/**
 * Helper I4 — construire `PluginControlPlaneAcl` depuis un store Product Hub
 * (sqlite ou mémoire enrichi). Chemin unique recommandé pour demobrand / marques.
 */

import {
  resolvePluginAclActorFromHeaders,
  type PluginAclActor,
  type PluginAclPolicy,
} from "../acl.js";
import type { PluginControlPlaneAcl } from "./types.js";

/** Surface minimale requise (SqliteProductHubStore / stubs tests). */
export type PluginHubAclStoreSurface = {
  getAclPolicy(pluginId: string): PluginAclPolicy;
  listAclPolicies(): PluginAclPolicy[];
  bindPluginOrg(pluginId: string, ownerOrgId: string): void;
  upsertAcl(entry: {
    pluginId: string;
    orgIds: string[];
    userIds: string[];
    ownerOrgId?: string;
  }): void;
  clearAcl(pluginId: string): void;
};

export type CreatePluginControlPlaneAclFromStoreOptions = {
  store: PluginHubAclStoreSurface;
  /**
   * Org fallback si actor.orgId absent à l'install (sandbox).
   * Défaut : `org-default`.
   */
  fallbackOwnerOrgId?: string;
  /** Défaut true — install bootstrap réservée aux admins/owners. */
  requireAdminToBootstrapInstall?: boolean;
  /** Hooks additionnels (ex. openPlugin runtime marque). */
  onInstalled?: (pluginId: string, actor: PluginAclActor) => void;
  onUninstalled?: (pluginId: string) => void;
};

/**
 * ACL control-plane branchée sur le store Product Hub.
 *
 * ```ts
 * const plane = await startHostPluginControlPlane({
 *   ctx, pluginsHost, productHubStore: hub,
 *   acl: createPluginControlPlaneAclFromStore({
 *     store: hub,
 *     onInstalled: (id, actor) => runtime.openPlugin(id),
 *   }),
 * });
 * ```
 */
export function createPluginControlPlaneAclFromStore(
  opts: CreatePluginControlPlaneAclFromStoreOptions,
): PluginControlPlaneAcl {
  const fallback = opts.fallbackOwnerOrgId || "org-default";
  return {
    resolveActor: (headers) => resolvePluginAclActorFromHeaders(headers),
    getPolicy: (pluginId) => opts.store.getAclPolicy(pluginId),
    listPolicies: () => opts.store.listAclPolicies(),
    requireAdminToBootstrapInstall:
      opts.requireAdminToBootstrapInstall !== false,
    onInstalled(pluginId, actor) {
      const ownerOrgId = actor.orgId || fallback;
      opts.store.bindPluginOrg(pluginId, ownerOrgId);
      opts.store.upsertAcl({
        pluginId,
        orgIds: [ownerOrgId],
        userIds: [],
        ownerOrgId,
      });
      opts.onInstalled?.(pluginId, actor);
    },
    onUninstalled(pluginId) {
      opts.store.clearAcl(pluginId);
      opts.onUninstalled?.(pluginId);
    },
  };
}
