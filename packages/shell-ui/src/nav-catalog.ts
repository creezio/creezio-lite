/**
 * Catalogue de nav OS — SoT unique des entrées primaires (Phase A).
 *
 * Types + merge pur + registre runtime. Zéro React, zéro lucide, zéro DB.
 * Cible produit : docs/plans/PLAN-NAV-CATALOG.md (§3.1–3.2).
 *
 * Overrides persistés + mount HTTP + écran admin = Phase B (`@creezio/nav`).
 */

export type NavCatalogSource = "os" | "module" | "plugin" | "extra";
export type NavCatalogGroup = "core" | "brand" | "plugin" | "admin";

export type NavCatalogEntry = {
  /** Stable, never a href (hrefs change). Ex. "os.granola", "module.prospects". */
  id: string;
  href: string;
  label: string;
  /** Nom lucide, pas un composant — sérialisable JSON / brand.db. */
  icon: string;
  group: NavCatalogGroup;
  order: number;
  permission?: string;
  /** Défaut kit/marque avant override admin. */
  defaultVisible: boolean;
  source: NavCatalogSource;
  /** false = feature-off, jamais listé même si override visible. */
  available: boolean;
};

export type NavOverride = {
  entryId: string;
  hidden?: boolean;
  order?: number;
  label?: string;
  group?: NavCatalogGroup;
  permission?: string;
};

export type NavCatalogFeatures = {
  plugins?: boolean;
  fleet?: boolean;
};

export type NavCatalogError = {
  code: "id_collision" | "href_collision";
  message: string;
  id?: string;
  href?: string;
};

export type ResolveNavCatalogInput = {
  os?: readonly NavCatalogEntry[];
  modules?: readonly NavCatalogEntry[];
  plugins?: readonly NavCatalogEntry[];
  extras?: readonly NavCatalogEntry[];
  overrides?: readonly NavOverride[];
  features?: NavCatalogFeatures;
  /**
   * Tests / doctor : throw sur collision d'`id`.
   * Runtime (défaut) : collecter dans `errors[]` et ignorer le doublon.
   */
  throwOnIdCollision?: boolean;
  /** Conserver les entrées `hidden` (admin catalog). Défaut false. */
  includeHidden?: boolean;
};

export type ResolveNavCatalogResult = {
  entries: NavCatalogEntry[];
  errors: NavCatalogError[];
  warnings: NavCatalogError[];
};

/** Noms lucide autorisés (résolus côté `shell-ui/ui` par `resolveNavIcon`). */
export const NAV_ICON_ALLOWLIST = [
  "Activity",
  "Bot",
  "Braces",
  "Cable",
  "Circle",
  "Database",
  "FileText",
  "KeyRound",
  "LayoutDashboard",
  "List",
  "ListTodo",
  "Mail",
  "NotebookPen",
  "Package",
  "ScrollText",
  "Settings",
  "Shield",
  "ShieldCheck",
  "SlidersHorizontal",
  "SquarePen",
  "Workflow",
] as const;

export type NavIconName = (typeof NAV_ICON_ALLOWLIST)[number];

const NAV_ICON_ALLOWLIST_SET = new Set<string>(NAV_ICON_ALLOWLIST);

export function isKnownNavIcon(name: string): boolean {
  return NAV_ICON_ALLOWLIST_SET.has(name);
}

const SOURCE_RANK: Record<NavCatalogSource, number> = {
  os: 0,
  plugin: 1,
  extra: 2,
  module: 3,
};

function cloneEntry(entry: NavCatalogEntry): NavCatalogEntry {
  return { ...entry };
}

function isPluginFeatureEntry(entry: NavCatalogEntry): boolean {
  return (
    entry.source === "plugin" ||
    entry.group === "plugin" ||
    entry.href === "/admin/plugins"
  );
}

function isFleetFeatureEntry(entry: NavCatalogEntry): boolean {
  return (
    entry.id === "os.fleet" ||
    entry.id.startsWith("os.fleet.") ||
    entry.href === "/admin/fleet"
  );
}

function applyFeatures(
  entry: NavCatalogEntry,
  features: NavCatalogFeatures | undefined,
): boolean {
  if (features?.plugins === false && isPluginFeatureEntry(entry)) {
    return false;
  }
  if (features?.fleet === false && isFleetFeatureEntry(entry)) {
    return false;
  }
  return entry.available;
}

/**
 * Merge déterministe os + modules + extras + plugins + overrides + features.
 * Collision d'`id` = erreur (throw si `throwOnIdCollision`). Collision
 * d'`href` = warning, le provider le plus spécifique gagne (`module` > `os`).
 */
export function resolveNavCatalog(
  input: ResolveNavCatalogInput,
): ResolveNavCatalogResult {
  const errors: NavCatalogError[] = [];
  const warnings: NavCatalogError[] = [];
  const byId = new Map<string, NavCatalogEntry>();
  const byHref = new Map<string, string>();

  const buckets: { source: NavCatalogSource; items: readonly NavCatalogEntry[] }[] =
    [
      { source: "os", items: input.os ?? [] },
      { source: "plugin", items: input.plugins ?? [] },
      { source: "extra", items: input.extras ?? [] },
      { source: "module", items: input.modules ?? [] },
    ];

  for (const bucket of buckets) {
    for (const raw of bucket.items) {
      const entry = cloneEntry(raw);
      if (!entry.source) entry.source = bucket.source;

      const existingId = byId.get(entry.id);
      if (existingId) {
        const err: NavCatalogError = {
          code: "id_collision",
          message: `Nav catalog: collision d'id "${entry.id}" (${existingId.source} vs ${entry.source})`,
          id: entry.id,
        };
        errors.push(err);
        if (input.throwOnIdCollision) {
          throw new Error(err.message);
        }
        continue;
      }

      const hrefOwnerId = byHref.get(entry.href);
      if (hrefOwnerId) {
        const owner = byId.get(hrefOwnerId);
        const ownerRank = owner ? SOURCE_RANK[owner.source] : -1;
        const nextRank = SOURCE_RANK[entry.source];
        warnings.push({
          code: "href_collision",
          message: `Nav catalog: collision d'href "${entry.href}" (${hrefOwnerId} vs ${entry.id}) — le plus spécifique gagne`,
          href: entry.href,
          id: entry.id,
        });
        if (nextRank > ownerRank) {
          byId.delete(hrefOwnerId);
          byId.set(entry.id, entry);
          byHref.set(entry.href, entry.id);
        }
        continue;
      }

      byId.set(entry.id, entry);
      byHref.set(entry.href, entry.id);
    }
  }

  const overrideById = new Map(
    (input.overrides ?? []).map((o) => [o.entryId, o]),
  );

  const entries: NavCatalogEntry[] = [];
  for (const entry of byId.values()) {
    const available = applyFeatures(entry, input.features);
    const override = overrideById.get(entry.id);
    if (override?.hidden && !input.includeHidden) {
      continue;
    }
    entries.push({
      ...entry,
      available,
      label: override?.label ?? entry.label,
      order: override?.order ?? entry.order,
      group: override?.group ?? entry.group,
      permission: override?.permission ?? entry.permission,
    });
  }

  entries.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { entries, errors, warnings };
}

/* ── Registre runtime OS (Node-safe) ── */

const osNavEntries = new Map<string, NavCatalogEntry>();
let defaultsRegistered = false;

export function registerOsNavEntry(entry: NavCatalogEntry): () => void {
  const prev = osNavEntries.get(entry.id);
  if (prev) {
    if (prev.href === entry.href && prev.label === entry.label) {
      return () => {
        osNavEntries.delete(entry.id);
      };
    }
    throw new Error(
      `Nav catalog: collision d'id "${entry.id}" (déjà enregistré: ${prev.href})`,
    );
  }
  osNavEntries.set(entry.id, {
    ...entry,
    source: entry.source || "os",
  });
  return () => {
    osNavEntries.delete(entry.id);
  };
}

export function listOsNavEntries(): NavCatalogEntry[] {
  return [...osNavEntries.values()].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );
}

/** Seed des entrées OS primaires actuelles. Idempotent. */
export function registerDefaultOsNavEntries(): void {
  if (defaultsRegistered) return;
  defaultsRegistered = true;
  for (const entry of DEFAULT_OS_NAV_ENTRIES) {
    if (!osNavEntries.has(entry.id)) {
      registerOsNavEntry(entry);
    }
  }
}

export function defaultOsCatalogEntries(): NavCatalogEntry[] {
  registerDefaultOsNavEntries();
  return listOsNavEntries();
}

/** Tests uniquement — vide le registre et autorise un re-seed. */
export function resetOsNavRegistryForTests(): void {
  osNavEntries.clear();
  defaultsRegistered = false;
}

const DEFAULT_OS_NAV_ENTRIES: readonly NavCatalogEntry[] = [
  {
    id: "os.taches",
    href: "/taches",
    label: "Tâches",
    icon: "ListTodo",
    group: "core",
    order: 10,
    defaultVisible: true,
    source: "os",
    available: true,
  },
  {
    id: "os.mails",
    href: "/mails",
    label: "Mails",
    icon: "Mail",
    group: "core",
    order: 20,
    defaultVisible: true,
    source: "os",
    available: true,
  },
  {
    id: "os.granola",
    href: "/granola",
    label: "Granola",
    icon: "NotebookPen",
    group: "core",
    order: 30,
    defaultVisible: true,
    source: "os",
    available: true,
  },
  {
    id: "os.grokbot",
    href: "/grokbot",
    label: "GrokBot",
    icon: "Bot",
    group: "core",
    order: 40,
    defaultVisible: true,
    source: "os",
    available: true,
  },
  {
    id: "os.parametres",
    href: "/parametres",
    label: "Préférences",
    icon: "SlidersHorizontal",
    group: "core",
    order: 50,
    defaultVisible: true,
    source: "os",
    available: true,
  },
  {
    id: "os.collaborateurs",
    href: "/collaborateurs",
    label: "Collaborateurs",
    icon: "Shield",
    group: "core",
    order: 60,
    defaultVisible: true,
    source: "os",
    available: true,
  },
];

/**
 * Contrat `GET /api/v1/modules/nav` — catalogue résolu session.
 * `{ items: [{ id, href, label, order, group?, permission?, icon }] }`
 */
export type NavCatalogSessionItem = {
  id: string;
  href: string;
  label: string;
  order: number;
  group?: string;
  permission?: string;
  icon: string;
};

/** Parse le body JSON du mount nav (tolérant : items manquants → []). */
export function parseNavCatalogSessionItems(
  body: unknown,
): NavCatalogSessionItem[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const raw = (body as { items?: unknown }).items;
  if (!Array.isArray(raw)) return [];
  const out: NavCatalogSessionItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const href = typeof r.href === "string" ? r.href.trim() : "";
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const icon = typeof r.icon === "string" && r.icon.trim() ? r.icon.trim() : "Circle";
    const order =
      typeof r.order === "number" && Number.isFinite(r.order) ? r.order : 0;
    if (!id || !href || !label) continue;
    const item: NavCatalogSessionItem = { id, href, label, order, icon };
    if (typeof r.group === "string" && r.group) item.group = r.group;
    if (typeof r.permission === "string" && r.permission) {
      item.permission = r.permission;
    }
    out.push(item);
  }
  return out;
}
