/**
 * Registre plugins organisation (contrat L3 — Notion §2–4).
 *
 * - Mémoire : tests / dry-run
 * - Fichier : `createFileOrgPluginRegistry` (Phase I6) — console ops
 * Cloud registry / auto-promotion = hors scope.
 */

export type PropagationLevel = "L1-core" | "L2-vertical" | "L3-org" | "L4-user";

export type OrgPluginVisibility =
  | "owner_only"
  | "org_selected"
  | "org_all"
  | "pending_review"
  | "promoted_vertical"
  | "promoted_kit";

export type OrgPluginRecord = {
  pluginId: string;
  /** Marque / produit métier (L2) */
  brandId: string;
  /** Organisation cliente (L3) */
  orgId: string;
  /** Créateur (L4) */
  createdByUserId: string;
  name: string;
  version: string;
  visibility: OrgPluginVisibility;
  /** Niveaux où le plugin est actuellement déployé */
  deployedAt: PropagationLevel[];
  /** Kit package version minimale requise (si promu) */
  minKitVersion?: string;
  /** Tags n8n / Product Hub */
  n8nTag?: string;
  createdAt: string;
  updatedAt: string;
  notes?: string;
};

export type OrgPluginRegistry = {
  list(filter?: {
    brandId?: string;
    orgId?: string;
    visibility?: OrgPluginVisibility;
  }): OrgPluginRecord[];
  get(pluginId: string): OrgPluginRecord | null;
  upsert(record: Omit<OrgPluginRecord, "updatedAt"> & { updatedAt?: string }): OrgPluginRecord;
  /** Remontée terrain → review org */
  submitForOrgReview(pluginId: string): OrgPluginRecord;
  /** Org → candidat vertical (L2) */
  proposeVerticalPromotion(pluginId: string): OrgPluginRecord;
  /** Vertical → candidat kit (L1) — review humaine */
  proposeKitPromotion(pluginId: string): OrgPluginRecord;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function createMemoryOrgPluginRegistry(
  seed: OrgPluginRecord[] = [],
): OrgPluginRegistry {
  const map = new Map<string, OrgPluginRecord>();
  for (const r of seed) map.set(r.pluginId, { ...r });

  return {
    list(filter) {
      let rows = [...map.values()];
      if (filter?.brandId)
        rows = rows.filter((r) => r.brandId === filter.brandId);
      if (filter?.orgId) rows = rows.filter((r) => r.orgId === filter.orgId);
      if (filter?.visibility)
        rows = rows.filter((r) => r.visibility === filter.visibility);
      return rows.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
    },
    get(pluginId) {
      return map.get(pluginId) ?? null;
    },
    upsert(record) {
      const updatedAt = record.updatedAt || nowIso();
      const next: OrgPluginRecord = { ...record, updatedAt };
      map.set(next.pluginId, next);
      return next;
    },
    submitForOrgReview(pluginId) {
      const cur = map.get(pluginId);
      if (!cur) throw new Error(`Plugin inconnu: ${pluginId}`);
      const next: OrgPluginRecord = {
        ...cur,
        visibility: "pending_review",
        deployedAt: uniqueLevels([...cur.deployedAt, "L4-user", "L3-org"]),
        updatedAt: nowIso(),
      };
      map.set(pluginId, next);
      return next;
    },
    proposeVerticalPromotion(pluginId) {
      const cur = map.get(pluginId);
      if (!cur) throw new Error(`Plugin inconnu: ${pluginId}`);
      const next: OrgPluginRecord = {
        ...cur,
        visibility: "promoted_vertical",
        deployedAt: uniqueLevels([
          ...cur.deployedAt,
          "L4-user",
          "L3-org",
          "L2-vertical",
        ]),
        updatedAt: nowIso(),
      };
      map.set(pluginId, next);
      return next;
    },
    proposeKitPromotion(pluginId) {
      const cur = map.get(pluginId);
      if (!cur) throw new Error(`Plugin inconnu: ${pluginId}`);
      const next: OrgPluginRecord = {
        ...cur,
        visibility: "promoted_kit",
        deployedAt: uniqueLevels([
          ...cur.deployedAt,
          "L4-user",
          "L3-org",
          "L2-vertical",
          "L1-core",
        ]),
        updatedAt: nowIso(),
      };
      map.set(pluginId, next);
      return next;
    },
  };
}

function uniqueLevels(levels: PropagationLevel[]): PropagationLevel[] {
  return [...new Set(levels)];
}

/** Contrat JSON exportable (console / API). */
export type OrgPluginRegistrySnapshot = {
  generatedAt: string;
  count: number;
  plugins: OrgPluginRecord[];
};

export function snapshotOrgPluginRegistry(
  registry: OrgPluginRegistry,
): OrgPluginRegistrySnapshot {
  const plugins = registry.list();
  return {
    generatedAt: nowIso(),
    count: plugins.length,
    plugins,
  };
}
