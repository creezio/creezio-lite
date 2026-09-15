/**
 * Persist des overrides sidebar en brand.db (table `nav_overrides`).
 * Jamais le catalogue entier — seulement hidden / order / label / icon / group / permission.
 */

import type {
  NavCatalogGroup,
  NavOverride,
} from "@creezio/shell-ui";

export type NavDb = {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => unknown;
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
};

/** Override stocké — `NavOverride` NAV-1 + `icon` (colonne plan §3.5). */
export type NavStoredOverride = NavOverride & {
  icon?: string;
  updatedBy?: string;
  updatedAt?: string;
};

export type NavOverridePatch = {
  entryId: string;
  hidden?: boolean;
  order?: number | null;
  label?: string | null;
  icon?: string | null;
  group?: NavCatalogGroup | null;
  permission?: string | null;
};

const GROUPS = new Set<string>(["core", "brand", "plugin", "admin"]);

type OverrideRow = {
  entry_id: string;
  hidden: number;
  sort_order: number | null;
  label: string | null;
  icon: string | null;
  grp: string | null;
  permission: string | null;
  updated_by: string | null;
  updated_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function asGroup(raw: string | null | undefined): NavCatalogGroup | undefined {
  if (raw && GROUPS.has(raw)) return raw as NavCatalogGroup;
  return undefined;
}

function rowToOverride(row: OverrideRow): NavStoredOverride {
  const out: NavStoredOverride = {
    entryId: row.entry_id,
    hidden: Number(row.hidden) === 1,
  };
  if (row.sort_order != null) out.order = Number(row.sort_order);
  if (typeof row.label === "string" && row.label) out.label = row.label;
  if (typeof row.icon === "string" && row.icon) out.icon = row.icon;
  const group = asGroup(row.grp);
  if (group) out.group = group;
  if (typeof row.permission === "string" && row.permission) {
    out.permission = row.permission;
  }
  if (row.updated_by) out.updatedBy = row.updated_by;
  if (row.updated_at) out.updatedAt = row.updated_at;
  return out;
}

export function listNavOverrides(db: NavDb): NavStoredOverride[] {
  try {
    const rows = db
      .prepare(
        `SELECT entry_id, hidden, sort_order, label, icon, grp, permission, updated_by, updated_at
         FROM nav_overrides ORDER BY entry_id`,
      )
      .all() as OverrideRow[];
    return rows.map(rowToOverride);
  } catch {
    return [];
  }
}

export function getNavOverride(
  db: NavDb,
  entryId: string,
): NavStoredOverride | null {
  try {
    const row = db
      .prepare(
        `SELECT entry_id, hidden, sort_order, label, icon, grp, permission, updated_by, updated_at
         FROM nav_overrides WHERE entry_id = ?`,
      )
      .get(entryId) as OverrideRow | undefined;
    return row ? rowToOverride(row) : null;
  } catch {
    return null;
  }
}

function emptyStored(entryId: string): NavStoredOverride {
  return { entryId, hidden: false };
}

/** Merge partiel : les champs absents du patch conservent la row existante. */
export function mergeNavOverridePatch(
  existing: NavStoredOverride | null,
  patch: NavOverridePatch,
): NavStoredOverride {
  const base = existing ?? emptyStored(patch.entryId);
  const next: NavStoredOverride = { ...base, entryId: patch.entryId };
  if (typeof patch.hidden === "boolean") next.hidden = patch.hidden;
  if (patch.order === null) delete next.order;
  else if (typeof patch.order === "number" && Number.isFinite(patch.order)) {
    next.order = patch.order;
  }
  if (patch.label === null || patch.label === "") delete next.label;
  else if (typeof patch.label === "string") next.label = patch.label;
  if (patch.icon === null || patch.icon === "") delete next.icon;
  else if (typeof patch.icon === "string") next.icon = patch.icon;
  if (patch.group === null) delete next.group;
  else if (patch.group && GROUPS.has(patch.group)) next.group = patch.group;
  if (patch.permission === null || patch.permission === "") {
    delete next.permission;
  } else if (typeof patch.permission === "string") {
    next.permission = patch.permission;
  }
  return next;
}

export function upsertNavOverride(
  db: NavDb,
  patch: NavOverridePatch,
  updatedBy?: string,
): NavStoredOverride {
  const next = mergeNavOverridePatch(getNavOverride(db, patch.entryId), patch);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO nav_overrides
       (entry_id, hidden, sort_order, label, icon, grp, permission, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(entry_id) DO UPDATE SET
       hidden = excluded.hidden,
       sort_order = excluded.sort_order,
       label = excluded.label,
       icon = excluded.icon,
       grp = excluded.grp,
       permission = excluded.permission,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  ).run(
    next.entryId,
    next.hidden ? 1 : 0,
    next.order ?? null,
    next.label ?? null,
    next.icon ?? null,
    next.group ?? null,
    next.permission ?? null,
    updatedBy ?? null,
    ts,
  );
  next.updatedBy = updatedBy;
  next.updatedAt = ts;
  return next;
}

export function deleteNavOverride(db: NavDb, entryId: string): boolean {
  try {
    db.prepare(`DELETE FROM nav_overrides WHERE entry_id = ?`).run(entryId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Réordonne : `ids[i]` reçoit `sort_order = (i + 1) * 10`.
 * Les ids inconnus du catalogue sont tout de même persistés (upsert order).
 */
export function reorderNavOverrides(
  db: NavDb,
  ids: readonly string[],
  updatedBy?: string,
): NavStoredOverride[] {
  const out: NavStoredOverride[] = [];
  ids.forEach((id, i) => {
    if (typeof id !== "string" || !id.trim()) return;
    out.push(
      upsertNavOverride(
        db,
        { entryId: id.trim(), order: (i + 1) * 10 },
        updatedBy,
      ),
    );
  });
  return out;
}

/** Projette vers `NavOverride` NAV-1 (sans icon / audit). */
export function toNavCatalogOverrides(
  rows: readonly NavStoredOverride[],
): NavOverride[] {
  return rows.map((row) => {
    const o: NavOverride = { entryId: row.entryId };
    if (typeof row.hidden === "boolean") o.hidden = row.hidden;
    if (typeof row.order === "number") o.order = row.order;
    if (row.label) o.label = row.label;
    if (row.group) o.group = row.group;
    if (row.permission) o.permission = row.permission;
    return o;
  });
}
