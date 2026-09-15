/**
 * Auth SoT via env `CREEZIO_CORE_DB_PATH` / `DB_PATH` (process Next/CRM) — M8.
 */

import {
  ensureCoreDbParent,
  resolveCoreDbPathFromEnv,
} from "@creezio/platform-core";
import { hashPassword } from "./password.js";
import { openNodeSqliteDatabase } from "./sqlite-driver.js";
import {
  createSqliteAuthStore,
  type SqliteAuthStore,
} from "./sqlite-store.js";

let cached: SqliteAuthStore | null = null;
let cachedPath: string | null = null;

export function getKitAuthStore(): SqliteAuthStore | null {
  const corePath = resolveCoreDbPathFromEnv();
  if (!corePath) return null;
  if (cached && cachedPath === corePath) return cached;
  try {
    ensureCoreDbParent(corePath);
    if (cached) {
      try {
        cached.close();
      } catch {
        /* ok */
      }
    }
    cached = createSqliteAuthStore({ coreDbPath: corePath });
    cachedPath = corePath;
    return cached;
  } catch {
    return null;
  }
}

export type KitAuthResult =
  | { ok: true; action: "login_ok" | "registered" | "updated"; email: string }
  | { ok: false; error: string; skipped?: boolean };

/**
 * Migrate one-shot (hors chemin login nominal) — brand → kit credentials.
 * Ne pas appeler en dual-write systématique.
 */
export async function migrateBrandCredentialsToKit(opts: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<KitAuthResult> {
  const email = opts.username.trim().toLowerCase();
  if (!email || !opts.password) {
    return { ok: false, error: "missing_credentials", skipped: true };
  }
  const store = getKitAuthStore();
  if (!store) {
    return { ok: false, error: "core_db_unavailable", skipped: true };
  }

  try {
    await store.login({ email, password: opts.password });
    return { ok: true, action: "login_ok", email };
  } catch {
    /* not yet / bad hash */
  }

  try {
    await store.register({
      email,
      password: opts.password,
      displayName: opts.displayName || opts.username,
    });
    return { ok: true, action: "registered", email };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg !== "email_taken") {
      return { ok: false, error: msg };
    }
  }

  try {
    const db = openNodeSqliteDatabase(store.dbPath);
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS creezio_users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          stay_logged_in INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      const ts = new Date().toISOString();
      db.prepare(
        `UPDATE creezio_users
         SET password_hash = ?, display_name = ?, updated_at = ?
         WHERE email = ?`,
      ).run(
        hashPassword(opts.password),
        (opts.displayName || opts.username).trim(),
        ts,
        email,
      );
    } finally {
      db.close?.();
    }
    await store.login({ email, password: opts.password });
    return { ok: true, action: "updated", email };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Authentification kit d’abord — ok si mot de passe valide côté kit. */
export async function authenticateViaKit(opts: {
  username: string;
  password: string;
}): Promise<KitAuthResult> {
  const email = opts.username.trim().toLowerCase();
  if (!email || !opts.password) {
    return { ok: false, error: "missing_credentials", skipped: true };
  }
  const store = getKitAuthStore();
  if (!store) {
    return { ok: false, error: "core_db_unavailable", skipped: true };
  }
  try {
    await store.login({ email, password: opts.password });
    return { ok: true, action: "login_ok", email };
  } catch {
    return { ok: false, error: "invalid_credentials" };
  }
}

/** Compte kit pour dry-run / tests. */
export function countKitAuthUsers(): number {
  const store = getKitAuthStore();
  if (!store) return -1;
  try {
    const db = openNodeSqliteDatabase(store.dbPath);
    try {
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM creezio_users`)
        .get() as { n?: number } | undefined;
      return Number(row?.n || 0);
    } finally {
      db.close?.();
    }
  } catch {
    return -1;
  }
}
