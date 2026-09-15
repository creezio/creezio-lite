/**
 * Store SQL access-control (core.db de la marque) :
 * - `access_role_overrides` — ajustements allow/deny par rôle ;
 * - `access_user_overrides` — ajustements allow/deny PAR COMPTE (attribution
 *   de permissions de modules à un compte précis, prime sur le rôle) ;
 * - `access_user_roles` — assignation rôle ↔ compte (quand la marque n'a pas
 *   de SoT métier via configureAccessControl.getUserRole) ;
 * - `access_audit_log` — journal des changements (qui, quoi, quand).
 *
 * Schéma idempotent (IF NOT EXISTS) exécuté à l'ouverture — même contrat que
 * le store plateforme (brand-platform-store).
 */
import type {
  AccessAuditEntry,
  AccessEffect,
  AccessOverride,
  AccessUserOverride,
  AccessUserRole,
} from "./types.js";

/** Handle DB minimal (better-sqlite3 / driver kit). */
export type AccessDbHandle = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => unknown;
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
  };
};

export const ACCESS_CONTROL_CORE_SQL = `
CREATE TABLE IF NOT EXISTS access_role_overrides (
  role        TEXT NOT NULL,
  permission  TEXT NOT NULL,
  effect      TEXT NOT NULL CHECK (effect IN ('allow','deny')),
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (role, permission)
);

CREATE TABLE IF NOT EXISTS access_user_overrides (
  user_id     TEXT NOT NULL,
  permission  TEXT NOT NULL,
  effect      TEXT NOT NULL CHECK (effect IN ('allow','deny')),
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE IF NOT EXISTS access_user_roles (
  user_id     TEXT PRIMARY KEY,
  role        TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS access_audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  actor           TEXT NOT NULL,
  action          TEXT NOT NULL,
  role            TEXT,
  permission      TEXT,
  effect          TEXT,
  target_user_id  TEXT,
  detail_json     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_access_audit_log_created
  ON access_audit_log(created_at DESC);
`;

export type AccessControlStore = {
  listOverrides: () => AccessOverride[];
  listOverridesByRole: (role: string) => AccessOverride[];
  setOverride: (
    role: string,
    permission: string,
    effect: AccessEffect,
    actor: string,
  ) => void;
  clearOverride: (role: string, permission: string) => void;
  listUserOverrides: (userId: string) => AccessUserOverride[];
  listAllUserOverrides: () => AccessUserOverride[];
  setUserOverride: (
    userId: string,
    permission: string,
    effect: AccessEffect,
    actor: string,
  ) => void;
  clearUserOverride: (userId: string, permission: string) => void;
  getUserRole: (userId: string) => string | null;
  setUserRole: (userId: string, role: string | null, actor: string) => void;
  listUserRoles: () => AccessUserRole[];
  logAudit: (entry: {
    actor: string;
    action: string;
    role?: string | null;
    permission?: string | null;
    effect?: string | null;
    targetUserId?: string | null;
    detail?: Record<string, unknown> | null;
  }) => void;
  listAudit: (limit: number) => AccessAuditEntry[];
};

type OverrideSqlRow = {
  role: string;
  permission: string;
  effect: string;
  updated_by: string | null;
  updated_at: string;
};

function toOverride(row: OverrideSqlRow): AccessOverride {
  return {
    role: String(row.role),
    permission: String(row.permission),
    effect: row.effect === "deny" ? "deny" : "allow",
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    updatedAt: String(row.updated_at),
  };
}

export function createSqliteAccessStore(opts: {
  db: AccessDbHandle;
}): AccessControlStore {
  const { db } = opts;
  db.exec(ACCESS_CONTROL_CORE_SQL);

  function listOverrides(): AccessOverride[] {
    const rows = db
      .prepare(
        `SELECT role, permission, effect, updated_by, updated_at
         FROM access_role_overrides ORDER BY role, permission`,
      )
      .all() as OverrideSqlRow[];
    return rows.map(toOverride);
  }

  function listOverridesByRole(role: string): AccessOverride[] {
    const rows = db
      .prepare(
        `SELECT role, permission, effect, updated_by, updated_at
         FROM access_role_overrides WHERE role = ? ORDER BY permission`,
      )
      .all(role) as OverrideSqlRow[];
    return rows.map(toOverride);
  }

  function setOverride(
    role: string,
    permission: string,
    effect: AccessEffect,
    actor: string,
  ): void {
    db.prepare(
      `INSERT INTO access_role_overrides (role, permission, effect, updated_by, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(role, permission) DO UPDATE SET
         effect = excluded.effect,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    ).run(role, permission, effect, actor);
  }

  function clearOverride(role: string, permission: string): void {
    db.prepare(
      `DELETE FROM access_role_overrides WHERE role = ? AND permission = ?`,
    ).run(role, permission);
  }

  type UserOverrideSqlRow = {
    user_id: string;
    permission: string;
    effect: string;
    updated_by: string | null;
    updated_at: string;
  };

  function toUserOverride(row: UserOverrideSqlRow): AccessUserOverride {
    return {
      userId: String(row.user_id),
      permission: String(row.permission),
      effect: row.effect === "deny" ? "deny" : "allow",
      updatedBy: row.updated_by ? String(row.updated_by) : null,
      updatedAt: String(row.updated_at),
    };
  }

  function listUserOverrides(userId: string): AccessUserOverride[] {
    const rows = db
      .prepare(
        `SELECT user_id, permission, effect, updated_by, updated_at
         FROM access_user_overrides WHERE user_id = ? ORDER BY permission`,
      )
      .all(userId) as UserOverrideSqlRow[];
    return rows.map(toUserOverride);
  }

  function listAllUserOverrides(): AccessUserOverride[] {
    const rows = db
      .prepare(
        `SELECT user_id, permission, effect, updated_by, updated_at
         FROM access_user_overrides ORDER BY user_id, permission`,
      )
      .all() as UserOverrideSqlRow[];
    return rows.map(toUserOverride);
  }

  function setUserOverride(
    userId: string,
    permission: string,
    effect: AccessEffect,
    actor: string,
  ): void {
    db.prepare(
      `INSERT INTO access_user_overrides (user_id, permission, effect, updated_by, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, permission) DO UPDATE SET
         effect = excluded.effect,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    ).run(userId, permission, effect, actor);
  }

  function clearUserOverride(userId: string, permission: string): void {
    db.prepare(
      `DELETE FROM access_user_overrides WHERE user_id = ? AND permission = ?`,
    ).run(userId, permission);
  }

  function getUserRole(userId: string): string | null {
    const row = db
      .prepare(`SELECT role FROM access_user_roles WHERE user_id = ?`)
      .get(userId) as { role?: string } | undefined;
    return row?.role ? String(row.role) : null;
  }

  function setUserRole(userId: string, role: string | null, actor: string): void {
    if (role === null) {
      db.prepare(`DELETE FROM access_user_roles WHERE user_id = ?`).run(userId);
      return;
    }
    db.prepare(
      `INSERT INTO access_user_roles (user_id, role, updated_by, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         role = excluded.role,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    ).run(userId, role, actor);
  }

  function listUserRoles(): AccessUserRole[] {
    const rows = db
      .prepare(
        `SELECT user_id, role, updated_by, updated_at
         FROM access_user_roles ORDER BY user_id`,
      )
      .all() as Array<{
      user_id: string;
      role: string;
      updated_by: string | null;
      updated_at: string;
    }>;
    return rows.map((r) => ({
      userId: String(r.user_id),
      role: String(r.role),
      updatedBy: r.updated_by ? String(r.updated_by) : null,
      updatedAt: String(r.updated_at),
    }));
  }

  function logAudit(entry: {
    actor: string;
    action: string;
    role?: string | null;
    permission?: string | null;
    effect?: string | null;
    targetUserId?: string | null;
    detail?: Record<string, unknown> | null;
  }): void {
    db.prepare(
      `INSERT INTO access_audit_log
         (actor, action, role, permission, effect, target_user_id, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.actor,
      entry.action,
      entry.role ?? null,
      entry.permission ?? null,
      entry.effect ?? null,
      entry.targetUserId ?? null,
      entry.detail ? JSON.stringify(entry.detail) : null,
    );
  }

  function listAudit(limit: number): AccessAuditEntry[] {
    const rows = db
      .prepare(
        `SELECT id, actor, action, role, permission, effect, target_user_id,
                detail_json, created_at
         FROM access_audit_log ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      id: number;
      actor: string;
      action: string;
      role: string | null;
      permission: string | null;
      effect: string | null;
      target_user_id: string | null;
      detail_json: string | null;
      created_at: string;
    }>;
    return rows.map((r) => {
      let detail: Record<string, unknown> | null = null;
      if (r.detail_json) {
        try {
          const parsed = JSON.parse(r.detail_json) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            detail = parsed as Record<string, unknown>;
          }
        } catch {
          detail = null;
        }
      }
      return {
        id: Number(r.id),
        actor: String(r.actor),
        action: String(r.action),
        role: r.role ? String(r.role) : null,
        permission: r.permission ? String(r.permission) : null,
        effect: r.effect ? String(r.effect) : null,
        targetUserId: r.target_user_id ? String(r.target_user_id) : null,
        detail,
        createdAt: String(r.created_at),
      };
    });
  }

  return {
    listOverrides,
    listOverridesByRole,
    setOverride,
    clearOverride,
    listUserOverrides,
    listAllUserOverrides,
    setUserOverride,
    clearUserOverride,
    getUserRole,
    setUserRole,
    listUserRoles,
    logAudit,
    listAudit,
  };
}

/* ── Slot runtime (enregistré par app-runtime au mount de la surface) ── */

let currentStore: AccessControlStore | null = null;

export function registerAccessControlStore(store: AccessControlStore): void {
  currentStore = store;
}

export function getAccessControlStore(): AccessControlStore | null {
  return currentStore;
}

export function resetAccessControlStoreForTests(): void {
  currentStore = null;
}