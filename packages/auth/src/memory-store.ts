/**
 * Store auth mémoire — tests + sandbox sans sqlite.
 */

import crypto from "node:crypto";
import { hashPassword, hashToken, newToken, verifyPassword } from "./password.js";
import type {
  AuthAccountPublic,
  AuthSession,
  AuthStore,
  AuthUser,
} from "./types.js";

type UserRow = AuthUser & { passwordHash: string };
type SessionRow = {
  id: string;
  userId: string;
  tokenHash: string;
  token: string;
  expiresAt: string | null;
  createdAt: string;
};

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

export function createMemoryAuthStore(): AuthStore {
  const users = new Map<string, UserRow>();
  const byEmail = new Map<string, string>();
  const sessions = new Map<string, SessionRow>();

  function sessionFrom(row: SessionRow): AuthSession | null {
    const user = users.get(row.userId);
    if (!user) return null;
    if (row.expiresAt && Date.parse(row.expiresAt) < Date.now()) {
      sessions.delete(row.tokenHash);
      return null;
    }
    return {
      id: row.id,
      userId: row.userId,
      token: row.token,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        stayLoggedIn: user.stayLoggedIn,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }

  const store: AuthStore = {
    async register(input) {
      const email = normalizeEmail(input.email);
      if (!email || !input.password) {
        throw new Error("email_and_password_required");
      }
      if (byEmail.has(email)) throw new Error("email_taken");
      const ts = now();
      const user: UserRow = {
        id: crypto.randomUUID(),
        email,
        displayName: (input.displayName || email.split("@")[0] || email).trim(),
        stayLoggedIn: false,
        createdAt: ts,
        updatedAt: ts,
        passwordHash: hashPassword(input.password),
      };
      users.set(user.id, user);
      byEmail.set(email, user.id);
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        stayLoggedIn: user.stayLoggedIn,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };
    },

    async login(input) {
      const email = normalizeEmail(input.email);
      const userId = byEmail.get(email);
      if (!userId) throw new Error("invalid_credentials");
      const user = users.get(userId)!;
      if (!verifyPassword(input.password, user.passwordHash)) {
        throw new Error("invalid_credentials");
      }
      if (input.stayLoggedIn !== undefined) {
        user.stayLoggedIn = Boolean(input.stayLoggedIn);
        user.updatedAt = now();
      }
      const token = newToken();
      const row: SessionRow = {
        id: crypto.randomUUID(),
        userId: user.id,
        token,
        tokenHash: hashToken(token),
        expiresAt: user.stayLoggedIn
          ? null
          : new Date(Date.now() + 12 * 3600_000).toISOString(),
        createdAt: now(),
      };
      sessions.set(row.tokenHash, row);
      return sessionFrom(row)!;
    },

    async logout(token) {
      return sessions.delete(hashToken(token));
    },

    async getSession(token) {
      const row = sessions.get(hashToken(token));
      if (!row) return null;
      return sessionFrom(row);
    },

    async getAccount(token) {
      const s = await store.getSession(token);
      return s ? toPublic(s.user) : null;
    },

    async changePassword(input) {
      const s = await store.getSession(input.token);
      if (!s) throw new Error("unauthorized");
      const user = users.get(s.userId)!;
      if (!verifyPassword(input.currentPassword, user.passwordHash)) {
        throw new Error("invalid_credentials");
      }
      user.passwordHash = hashPassword(input.newPassword);
      user.updatedAt = now();
      return true;
    },

    async setStayLoggedIn(token, value) {
      const s = await store.getSession(token);
      if (!s) return false;
      const user = users.get(s.userId)!;
      user.stayLoggedIn = value;
      user.updatedAt = now();
      return true;
    },
  };

  return store;
}
