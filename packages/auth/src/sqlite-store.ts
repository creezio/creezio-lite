/**
 * Store auth persisté dans sqlite **core** (Phase I1).
 */

import crypto from "node:crypto";
import { AUTH_CORE_SQL } from "./schema.js";
import { hashPassword, hashToken, newToken, verifyPassword } from "./password.js";
import type {
  AuthAccountPublic,
  AuthSession,
  AuthStore,
  AuthUser,
} from "./types.js";
import {
  openNodeSqliteDatabase,
  type OpenSqliteDatabase,
  type SqliteDatabase,
} from "./sqlite-driver.js";

function now(): string {
  return new Date().toISOString();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toPublic(u: AuthUser): AuthAccountPublic {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    stayLoggedIn: u.stayLoggedIn,
  };
}

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  stay_logged_in: number;
  created_at: string;
  updated_at: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string | null;
  created_at: string;
};

export type SqliteAuthStore = AuthStore & {
  close(): void;
  readonly dbPath: string;
};

export type CreateSqliteAuthStoreOptions = {
  /** Chemin sqlite core (`resolveCoreDbPath` / `SqliteRuntime.paths.core`). */
  coreDbPath: string;
  /** Injecteur DB (better-sqlite3) ; défaut = node:sqlite. */
  openDatabase?: OpenSqliteDatabase;
};

function userFromRow(r: UserRow): AuthUser {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    stayLoggedIn: Boolean(r.stay_logged_in),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createSqliteAuthStore(
  opts: CreateSqliteAuthStoreOptions,
): SqliteAuthStore {
  const open = opts.openDatabase || openNodeSqliteDatabase;
  const db: SqliteDatabase = open(opts.coreDbPath);

  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(AUTH_CORE_SQL);

  function getUserById(id: string): UserRow | null {
    const row = db
      .prepare(`SELECT * FROM creezio_users WHERE id = ?`)
      .get(id) as UserRow | undefined;
    return row || null;
  }

  function sessionFrom(token: string, row: SessionRow): AuthSession | null {
    if (row.expires_at && Date.parse(row.expires_at) < Date.now()) {
      db.prepare(`DELETE FROM creezio_sessions WHERE token_hash = ?`).run(
        row.token_hash,
      );
      return null;
    }
    const userRow = getUserById(row.user_id);
    if (!userRow) return null;
    const user = userFromRow(userRow);
    return {
      id: row.id,
      userId: row.user_id,
      token,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      user,
    };
  }

  const store: SqliteAuthStore = {
    dbPath: opts.coreDbPath,

    close() {
      db.close?.();
    },

    async register(input) {
      const email = normalizeEmail(input.email);
      if (!email || !input.password) {
        throw new Error("email_and_password_required");
      }
      const existing = db
        .prepare(`SELECT id FROM creezio_users WHERE email = ?`)
        .get(email) as { id: string } | undefined;
      if (existing) throw new Error("email_taken");
      const ts = now();
      const user: AuthUser = {
        id: crypto.randomUUID(),
        email,
        displayName: (input.displayName || email.split("@")[0] || email).trim(),
        stayLoggedIn: false,
        createdAt: ts,
        updatedAt: ts,
      };
      db.prepare(
        `INSERT INTO creezio_users
        (id, email, password_hash, display_name, stay_logged_in, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)`,
      ).run(
        user.id,
        user.email,
        hashPassword(input.password),
        user.displayName,
        user.createdAt,
        user.updatedAt,
      );
      return user;
    },

    async login(input) {
      const email = normalizeEmail(input.email);
      const userRow = db
        .prepare(`SELECT * FROM creezio_users WHERE email = ?`)
        .get(email) as UserRow | undefined;
      if (!userRow) throw new Error("invalid_credentials");
      if (!verifyPassword(input.password, userRow.password_hash)) {
        throw new Error("invalid_credentials");
      }
      if (input.stayLoggedIn !== undefined) {
        userRow.stay_logged_in = input.stayLoggedIn ? 1 : 0;
        userRow.updated_at = now();
        db.prepare(
          `UPDATE creezio_users SET stay_logged_in = ?, updated_at = ? WHERE id = ?`,
        ).run(userRow.stay_logged_in, userRow.updated_at, userRow.id);
      }
      const token = newToken();
      const sessionId = crypto.randomUUID();
      const createdAt = now();
      const expiresAt = userRow.stay_logged_in
        ? null
        : new Date(Date.now() + 12 * 3600_000).toISOString();
      const tokenHash = hashToken(token);
      db.prepare(
        `INSERT INTO creezio_sessions
        (id, user_id, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)`,
      ).run(sessionId, userRow.id, tokenHash, expiresAt, createdAt);
      return sessionFrom(token, {
        id: sessionId,
        user_id: userRow.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_at: createdAt,
      })!;
    },

    async logout(token) {
      const th = hashToken(token);
      const existing = db
        .prepare(`SELECT id FROM creezio_sessions WHERE token_hash = ?`)
        .get(th);
      if (!existing) return false;
      db.prepare(`DELETE FROM creezio_sessions WHERE token_hash = ?`).run(th);
      return true;
    },

    async getSession(token) {
      const row = db
        .prepare(`SELECT * FROM creezio_sessions WHERE token_hash = ?`)
        .get(hashToken(token)) as SessionRow | undefined;
      if (!row) return null;
      return sessionFrom(token, row);
    },

    async getAccount(token) {
      const s = await store.getSession(token);
      return s ? toPublic(s.user) : null;
    },

    async changePassword(input) {
      const s = await store.getSession(input.token);
      if (!s) throw new Error("unauthorized");
      const userRow = getUserById(s.userId);
      if (!userRow) throw new Error("unauthorized");
      if (!verifyPassword(input.currentPassword, userRow.password_hash)) {
        throw new Error("invalid_credentials");
      }
      db.prepare(
        `UPDATE creezio_users SET password_hash = ?, updated_at = ? WHERE id = ?`,
      ).run(hashPassword(input.newPassword), now(), userRow.id);
      return true;
    },

    async setStayLoggedIn(token, value) {
      const s = await store.getSession(token);
      if (!s) return false;
      db.prepare(
        `UPDATE creezio_users SET stay_logged_in = ?, updated_at = ? WHERE id = ?`,
      ).run(value ? 1 : 0, now(), s.userId);
      return true;
    },
  };

  return store;
}
