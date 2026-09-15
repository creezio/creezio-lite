/**
 * Sous-process Node vanilla — upsert clé service dans api_keys.
 * Usage : node ensure-crm-key-db.js <dbPath> <apiKey> <name> [scopes]
 * Ne jamais importer depuis electron/main (ABI better-sqlite3).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createAppRequire } from "@creezio/platform-core";

type SqliteStmt = {
  get(...args: unknown[]): unknown;
  run(...args: unknown[]): { lastInsertRowid: number | bigint };
};

type DatabaseCtor = new (filename: string) => {
  prepare(sql: string): SqliteStmt;
  close(): void;
};

function loadDatabase(): DatabaseCtor {
  const req = createAppRequire();
  return req("better-sqlite3") as DatabaseCtor;
}

const dbPath = process.argv[2];
const apiKey = process.argv[3];
const name = process.argv[4] || "Hermes (service)";
const scopesRaw = process.argv[5] || "full";

if (!dbPath || !apiKey) {
  console.error(
    "usage: ensure-crm-key-db.js <dbPath> <apiKey> [name] [scopes]",
  );
  process.exit(2);
}
if (!fs.existsSync(dbPath)) {
  console.error(`db absente: ${dbPath}`);
  process.exit(1);
}

function normalizeScopes(raw: string): string {
  const list = String(raw || "full")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length || list.includes("full") || list.includes("*")) return "full";
  const out = new Set<string>();
  for (const s of list) {
    if (s === "crm:read" || s === "crm:write") out.add(s);
  }
  if (out.has("crm:write")) out.add("crm:read");
  return out.size ? [...out].sort().join(",") : "full";
}

function keyPrefix(key: string): string {
  const m = key.match(/^([a-z0-9]+_live_)/i);
  const stem = m?.[1];
  if (stem) return key.slice(0, stem.length + 6);
  return key.slice(0, 14);
}

const scopes = normalizeScopes(scopesRaw);
const hash = crypto.createHash("sha256").update(apiKey, "utf8").digest("hex");
const prefix = keyPrefix(apiKey);

const Database = loadDatabase();
const db = new Database(dbPath);
try {
  const table = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'`,
    )
    .get() as { name?: string } | undefined;
  if (!table?.name) {
    console.error("table api_keys absente — migrations requises");
    process.exit(1);
  }

  const existing = db
    .prepare(
      `SELECT id, scopes FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL`,
    )
    .get(hash) as { id?: number; scopes?: string } | undefined;

  if (existing?.id) {
    if (existing.scopes !== scopes) {
      db.prepare(`UPDATE api_keys SET scopes = ? WHERE id = ?`).run(
        scopes,
        existing.id,
      );
      console.log(`updated:${existing.id}:${scopes}`);
    } else {
      console.log(`exists:${existing.id}`);
    }
    process.exit(0);
  }

  const r = db
    .prepare(
      `INSERT INTO api_keys (name, key_hash, prefix, scopes, user_id)
       VALUES (?, ?, ?, ?, NULL)`,
    )
    .run(name, hash, prefix, scopes);
  console.log(`created:${r.lastInsertRowid}:${scopes}`);
  process.exit(0);
} finally {
  db.close();
}
