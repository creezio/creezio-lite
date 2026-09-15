/**
 * Mount api-kernel `/api/v1/modules/nav/*` (dbLayer brand).
 *
 * - GET    /                    → catalogue résolu session `{ items }`
 * - GET    /catalog             → brut + overrides (admin)
 * - PUT    /overrides           → upsert partiel
 * - PUT    /overrides/reorder   → `{ ids }`
 * - DELETE /overrides/:entryId  → retour défaut
 *
 * Permission admin : `platform.access.manage` (par opération).
 * GET / : session (bordure) — filtrage rôle dans le handler.
 *
 * Décision owner (documentée dans AGENTS.md) : owner voit tout ce qui est
 * `available` ; `hidden` s'applique quand même (y compris pour l'owner).
 */

import type {
  ApiMount,
  ApiRequest,
  ApiResponse,
  ModuleOperation,
} from "@creezio/api-kernel";
import {
  defaultOsCatalogEntries,
  listOsNavEntries,
  resolveNavCatalog,
  type NavCatalogEntry,
  type NavCatalogFeatures,
} from "@creezio/shell-ui";

import { registerOsNavAdminEntry } from "./admin-entry.js";
import {
  deleteNavOverride,
  listNavOverrides,
  reorderNavOverrides,
  toNavCatalogOverrides,
  upsertNavOverride,
  type NavDb,
  type NavOverridePatch,
  type NavStoredOverride,
} from "./store.js";

export const NAV_MANAGE_PERMISSION = "platform.access.manage";

export type NavActor = {
  role?: string;
  permissions?: readonly string[];
  impersonating?: boolean;
  sub?: string;
};

/** Optional asynchronous persistence; synchronous SQLite remains the default. */
export type NavPersistence = {
  list(): Promise<NavStoredOverride[]> | NavStoredOverride[];
  upsert(patch: NavOverridePatch, actor?: string): Promise<NavStoredOverride> | NavStoredOverride;
  reorder(ids: readonly string[], actor?: string): Promise<NavStoredOverride[]> | NavStoredOverride[];
  remove(id: string): Promise<unknown> | unknown;
};

export type NavMountOptions = {
  persistence?: NavPersistence;
  /** Entrées métier (`collectNavItems`). */
  collectModuleEntries?: () => readonly NavCatalogEntry[];
  collectPluginEntries?: () => readonly NavCatalogEntry[];
  collectExtraEntries?: () => readonly NavCatalogEntry[];
  features?: NavCatalogFeatures;
  /**
   * Entrées OS. Défaut = `listOsNavEntries()` après seed
   * (`defaultOsCatalogEntries()`).
   */
  osEntries?: (() => readonly NavCatalogEntry[]) | readonly NavCatalogEntry[];
  /** Session injectée (app-runtime : cookie / Bearer). Absente = pas de garde locale. */
  getSession?: (
    req: ApiRequest,
  ) => Promise<NavActor | null> | NavActor | null;
};

const OPERATIONS: ModuleOperation[] = [
  {
    id: "list",
    method: "GET",
    path: "/",
    description: "Catalogue de nav résolu pour la session (sidebar)",
    roles: ["owner", "collaborator"],
  },
  {
    id: "catalog",
    method: "GET",
    path: "/catalog",
    description: "Catalogue brut + overrides (admin)",
    permission: NAV_MANAGE_PERMISSION,
    roles: ["owner"],
  },
  {
    id: "upsert-override",
    method: "PUT",
    path: "/overrides",
    description: "Upsert partiel d'un override sidebar",
    permission: NAV_MANAGE_PERMISSION,
    roles: ["owner"],
  },
  {
    id: "reorder",
    method: "PUT",
    path: "/overrides/reorder",
    description: "Réordonne les entrées (ids dans l'ordre voulu)",
    permission: NAV_MANAGE_PERMISSION,
    roles: ["owner"],
  },
  {
    id: "delete-override",
    method: "DELETE",
    path: "/overrides/:entryId",
    description: "Supprime l'override (retour défaut kit/marque)",
    permission: NAV_MANAGE_PERMISSION,
    roles: ["owner"],
  },
];

function json(status: number, body: unknown): ApiResponse {
  return { status, body };
}

function resolveOsEntries(opts: NavMountOptions): NavCatalogEntry[] {
  if (opts.osEntries) {
    const raw =
      typeof opts.osEntries === "function" ? opts.osEntries() : opts.osEntries;
    return [...raw];
  }
  const listed = listOsNavEntries();
  if (listed.length > 0) return listed;
  return defaultOsCatalogEntries();
}

function applyStoredIcons(
  entries: NavCatalogEntry[],
  overrides: readonly NavStoredOverride[],
): NavCatalogEntry[] {
  const byId = new Map(overrides.map((o) => [o.entryId, o]));
  return entries.map((entry) => {
    const icon = byId.get(entry.id)?.icon;
    return icon ? { ...entry, icon } : entry;
  });
}

function sessionItems(
  entries: NavCatalogEntry[],
  actor: NavActor | null,
): Array<{
  id: string;
  href: string;
  label: string;
  order: number;
  group?: string;
  permission?: string;
  icon: string;
}> {
  const isOwner = actor?.role === "owner" && !actor.impersonating;
  const perms = new Set(actor?.permissions ?? []);
  const out = [];
  for (const e of entries) {
    if (!e.available) continue;
    if (
      !isOwner &&
      e.permission &&
      e.permission.length > 0 &&
      !perms.has(e.permission)
    ) {
      continue;
    }
    out.push({
      id: e.id,
      href: e.href,
      label: e.label,
      order: e.order,
      ...(e.group ? { group: e.group } : {}),
      ...(e.permission ? { permission: e.permission } : {}),
      icon: e.icon,
    });
  }
  return out;
}

async function requireManage(
  opts: NavMountOptions,
  req: ApiRequest,
): Promise<{ actor: NavActor | null } | ApiResponse> {
  if (!opts.getSession) return { actor: null };
  const actor = await opts.getSession(req);
  if (!actor) {
    return json(401, { ok: false, error: "unauthenticated" });
  }
  if (actor.role === "owner" && !actor.impersonating) {
    return { actor };
  }
  if (actor.permissions?.includes(NAV_MANAGE_PERMISSION)) {
    return { actor };
  }
  return json(403, {
    ok: false,
    error: "permission_denied",
    permission: NAV_MANAGE_PERMISSION,
  });
}

function parseOverridePatch(body: unknown): NavOverridePatch | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  const entryId = String(raw.entryId ?? raw.entry_id ?? "").trim();
  if (!entryId) return null;
  const patch: NavOverridePatch = { entryId };
  if (typeof raw.hidden === "boolean") patch.hidden = raw.hidden;
  if (raw.order === null) patch.order = null;
  else if (typeof raw.order === "number" && Number.isFinite(raw.order)) {
    patch.order = raw.order;
  }
  if (raw.label === null) patch.label = null;
  else if (typeof raw.label === "string") patch.label = raw.label;
  if (raw.icon === null) patch.icon = null;
  else if (typeof raw.icon === "string") patch.icon = raw.icon;
  if (raw.group === null) patch.group = null;
  else if (
    raw.group === "core" ||
    raw.group === "brand" ||
    raw.group === "plugin" ||
    raw.group === "admin"
  ) {
    patch.group = raw.group;
  }
  if (raw.permission === null) patch.permission = null;
  else if (typeof raw.permission === "string") patch.permission = raw.permission;
  return patch;
}

/**
 * Mount `/api/v1/modules/nav/*`.
 * `osEntries` défaut = registre OS NAV-1 (`listOsNavEntries` / seed).
 */
export function createNavMount(opts: NavMountOptions = {}): ApiMount {
  registerOsNavAdminEntry();
  return {
    dbLayer: "brand",
    accessJustification:
      "GET / est le catalogue sidebar (session bordure) ; les routes admin portent platform.access.manage par opération",
    operations: OPERATIONS,
    handle: async ({ req, subPath, db }) => {
      if (!db && !opts.persistence) {
        return json(503, { ok: false, error: "db_unavailable" });
      }
      const method = req.method.toUpperCase();
      const parts = subPath.split("/").filter(Boolean);
      const head = parts[0] || "";
      const navDb = db as unknown as NavDb;

      if (parts.length === 0) {
        if (method !== "GET") {
          return json(405, { ok: false, error: "method_not_allowed" });
        }
        let actor: NavActor | null = null;
        if (opts.getSession) {
          actor = await opts.getSession(req);
          if (!actor) {
            return json(401, { ok: false, error: "unauthenticated" });
          }
        }
        const overrides = await (opts.persistence ? opts.persistence.list() : listNavOverrides(navDb));
        const resolved = resolveNavCatalog({
          os: resolveOsEntries(opts),
          modules: opts.collectModuleEntries?.() ?? [],
          plugins: opts.collectPluginEntries?.() ?? [],
          extras: opts.collectExtraEntries?.() ?? [],
          overrides: toNavCatalogOverrides(overrides),
          features: opts.features,
          includeHidden: false,
        });
        const entries = applyStoredIcons(resolved.entries, overrides);
        return json(200, {
          ok: true,
          items: sessionItems(entries, actor),
        });
      }

      if (head === "catalog" && parts.length === 1) {
        if (method !== "GET") {
          return json(405, { ok: false, error: "method_not_allowed" });
        }
        const guard = await requireManage(opts, req);
        if ("status" in guard) return guard;
        const overrides = await (opts.persistence ? opts.persistence.list() : listNavOverrides(navDb));
        const hiddenIds = new Set(
          overrides.filter((o) => o.hidden).map((o) => o.entryId),
        );
        const resolved = resolveNavCatalog({
          os: resolveOsEntries(opts),
          modules: opts.collectModuleEntries?.() ?? [],
          plugins: opts.collectPluginEntries?.() ?? [],
          extras: opts.collectExtraEntries?.() ?? [],
          overrides: toNavCatalogOverrides(overrides),
          features: opts.features,
          includeHidden: true,
        });
        const entries = applyStoredIcons(resolved.entries, overrides).map(
          (e) => ({
            ...e,
            hidden: hiddenIds.has(e.id),
          }),
        );
        return json(200, {
          ok: true,
          entries,
          overrides,
          errors: resolved.errors,
          warnings: resolved.warnings,
        });
      }

      if (head === "overrides" && parts[1] === "reorder" && parts.length === 2) {
        if (method !== "PUT") {
          return json(405, { ok: false, error: "method_not_allowed" });
        }
        const guard = await requireManage(opts, req);
        if ("status" in guard) return guard;
        const body = req.body as { ids?: unknown } | null;
        const ids = Array.isArray(body?.ids) ? body.ids : null;
        if (!ids || !ids.every((id) => typeof id === "string")) {
          return json(400, { ok: false, error: "invalid_body" });
        }
        const updated = await (opts.persistence ? opts.persistence.reorder(ids as string[], guard.actor?.sub) : reorderNavOverrides(navDb, ids as string[], guard.actor?.sub));
        return json(200, { ok: true, overrides: updated });
      }

      if (head === "overrides" && parts.length === 1) {
        if (method !== "PUT") {
          return json(405, { ok: false, error: "method_not_allowed" });
        }
        const guard = await requireManage(opts, req);
        if ("status" in guard) return guard;
        const patch = parseOverridePatch(req.body);
        if (!patch) {
          return json(400, { ok: false, error: "invalid_body" });
        }
        const override = await (opts.persistence ? opts.persistence.upsert(patch, guard.actor?.sub) : upsertNavOverride(navDb, patch, guard.actor?.sub));
        return json(200, { ok: true, override });
      }

      if (head === "overrides" && parts.length === 2) {
        if (method !== "DELETE") {
          return json(405, { ok: false, error: "method_not_allowed" });
        }
        const guard = await requireManage(opts, req);
        if ("status" in guard) return guard;
        const entryId = decodeURIComponent(parts[1] || "").trim();
        if (!entryId) {
          return json(400, { ok: false, error: "entry_id_required" });
        }
        await (opts.persistence ? opts.persistence.remove(entryId) : deleteNavOverride(navDb, entryId));
        return json(200, { ok: true, entryId });
      }

      return json(404, { ok: false, error: "not_found" });
    },
  };
}
