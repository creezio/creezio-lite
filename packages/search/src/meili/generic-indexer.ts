// @ts-nocheck — better-sqlite3 runtime (cwd marque)
/**
 * Indexeur Meili générique piloté par BrandMeiliFeed.
 * Pas de SQL TF / agrégateurs hardcodés.
 */
import path from "node:path";
import fs from "node:fs";
import { createAppRequire } from "@creezio/platform-core";
import { emitOpsEvent } from "@creezio/observability";
import {
  MEILI_FINGERPRINT_META_KEY,
  MEILI_INDEX_IN_PROGRESS_KEY,
  fingerprintCountKey,
  serializeFingerprint,
  type CatalogSqlCounts,
  type MeiliFingerprint,
} from "./index-schema.js";
import type { BrandMeiliFeed, BrandMeiliDocument } from "./feed.js";
import {
  mergeMeiliIndexSettings,
  needsMeiliMaxTotalHitsRaise,
} from "./pagination-settings.js";

type SqliteDb = {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
    run(...args: unknown[]): unknown;
  };
  close(): void;
};

type LogFn = (line: string) => void;
type Json = Record<string, unknown>;

const BATCH_MEILI = 500;

function openSqlite(
  dbPath: string,
  opts?: { readonly?: boolean; fileMustExist?: boolean },
): SqliteDb {
  const req = createAppRequire();
  try {
    const Database = req("better-sqlite3") as new (
      f: string,
      o?: { readonly?: boolean; fileMustExist?: boolean },
    ) => SqliteDb;
    return new Database(dbPath, opts);
  } catch {
    const mod = req("node:sqlite") as {
      DatabaseSync: new (
        path: string,
        o?: { readOnly?: boolean },
      ) => SqliteDb & { close(): void };
    };
    return new mod.DatabaseSync(dbPath, {
      readOnly: Boolean(opts?.readonly),
    });
  }
}

function createMeiliClient(host: string, masterKey: string) {
  const base = host.replace(/\/+$/, "");
  return {
    async request(
      method: string,
      p: string,
      body?: unknown,
      timeoutMs = 120_000,
    ): Promise<unknown> {
      const res = await fetch(`${base}${p}`, {
        method,
        headers: {
          Authorization: `Bearer ${masterKey}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await res.text();
      if (!res.ok) {
        throw new Error(`Meili HTTP ${res.status} ${p}: ${raw.slice(0, 300)}`);
      }
      return raw ? JSON.parse(raw) : null;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isDict(v: unknown): v is Json {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

async function waitTask(meili: ReturnType<typeof createMeiliClient>, task: unknown) {
  const uid = isDict(task) ? (task.taskUid ?? task.uid) : null;
  if (uid == null) return;
  for (let i = 0; i < 600; i++) {
    const st = await meili.request("GET", `/tasks/${uid}`);
    if (isDict(st) && (st.status === "succeeded" || st.status === "failed")) {
      if (st.status === "failed") {
        throw new Error(`Meili task ${uid} failed: ${JSON.stringify(st.error)}`);
      }
      return;
    }
    await sleep(50 + Math.min(i * 10, 500));
  }
  throw new Error(`Meili task ${uid} timeout`);
}

async function indexExists(
  meili: ReturnType<typeof createMeiliClient>,
  uid: string,
): Promise<boolean> {
  try {
    await meili.request("GET", `/indexes/${uid}`);
    return true;
  } catch {
    return false;
  }
}

async function createIndex(
  meili: ReturnType<typeof createMeiliClient>,
  uid: string,
): Promise<void> {
  await waitTask(
    meili,
    await meili.request("POST", "/indexes", { uid, primaryKey: "id" }),
  );
}

async function recreateIndex(
  meili: ReturnType<typeof createMeiliClient>,
  uid: string,
  settings: Json,
): Promise<void> {
  if (await indexExists(meili, uid)) {
    await waitTask(meili, await meili.request("DELETE", `/indexes/${uid}`));
  }
  await createIndex(meili, uid);
  await waitTask(
    meili,
    await meili.request(
      "PATCH",
      `/indexes/${uid}/settings`,
      mergeMeiliIndexSettings(settings),
    ),
  );
}

async function swapAndCleanup(
  meili: ReturnType<typeof createMeiliClient>,
  uid: string,
): Promise<void> {
  const newUid = `${uid}_new`;
  if (!(await indexExists(meili, uid))) {
    await createIndex(meili, uid);
  }
  await waitTask(
    meili,
    await meili.request("POST", "/swap-indexes", [{ indexes: [uid, newUid] }]),
  );
  await waitTask(meili, await meili.request("DELETE", `/indexes/${newUid}`));
}

async function deleteIndexIfExists(
  meili: ReturnType<typeof createMeiliClient>,
  uid: string,
  log: LogFn,
): Promise<void> {
  if (!(await indexExists(meili, uid))) return;
  await waitTask(meili, await meili.request("DELETE", `/indexes/${uid}`));
  log(`[meili] index obsolète supprimé: ${uid}`);
}

async function meiliAvailable(
  meili: ReturnType<typeof createMeiliClient>,
  log: LogFn,
): Promise<boolean> {
  try {
    await meili.request("GET", "/health", undefined, 5_000);
    return true;
  } catch (e) {
    log(
      `[meili] indisponible — indexation annulée (${e instanceof Error ? e.message : e})`,
    );
    return false;
  }
}

function tableExists(db: SqliteDb, name: string): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?`,
    )
    .get(name) as { c: number };
  return row.c > 0;
}

function columnExists(db: SqliteDb, table: string, col: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(col)) {
    return false;
  }
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return rows.some((r) => r.name === col);
}

function safeIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`identifiant SQL invalide: ${name}`);
  }
  return name;
}

function readSqliteSchemaVersion(db: SqliteDb): number {
  if (!tableExists(db, "meta")) return 0;
  const row = db
    .prepare(`SELECT value FROM meta WHERE key='schema_version'`)
    .get() as { value: string } | undefined;
  return Number(row?.value || 0);
}

function writeMeta(dbFile: string, key: string, value: string): void {
  const w = openSqlite(dbFile, { fileMustExist: true });
  try {
    if (!tableExists(w, "meta")) {
      w.prepare(
        `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      ).run();
    }
    w.prepare(
      `INSERT INTO meta(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value);
  } finally {
    w.close();
  }
}

function clearMeta(dbFile: string, key: string): void {
  try {
    const w = openSqlite(dbFile, { fileMustExist: true });
    try {
      if (tableExists(w, "meta")) {
        w.prepare(`DELETE FROM meta WHERE key = ?`).run(key);
      }
    } finally {
      w.close();
    }
  } catch {
    /* best-effort */
  }
}

function countTable(db: SqliteDb, table: string): number {
  if (!tableExists(db, table)) return 0;
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM ${safeIdent(table)}`)
    .get() as { c: number };
  return Number(row.c || 0);
}

function loadDocs(
  db: SqliteDb,
  feed: BrandMeiliFeed,
  index: BrandMeiliFeed["indexes"][number],
): BrandMeiliDocument[] {
  // Mode custom : la marque génère ses documents (jointures/provenance) —
  // aucun SQL marque dans le kit.
  if (index.loadDocs) return [...index.loadDocs(db)];
  if (!index.table || !index.columns || !index.docType) return [];
  const table = safeIdent(index.table);
  if (!tableExists(db, table)) return [];
  const cols = ["id", ...index.columns.filter((c) => c !== "id")].filter(
    (c, i, a) => a.indexOf(c) === i,
  );
  for (const c of cols) safeIdent(c);
  const available = cols.filter((c) => columnExists(db, table, c));
  if (!available.includes("id")) return [];

  let sql = `SELECT ${available.join(", ")} FROM ${table}`;
  if (
    index.excludeArchived &&
    columnExists(db, table, "archived_at")
  ) {
    sql += ` WHERE archived_at IS NULL OR archived_at = ''`;
  }
  const rows = db.prepare(sql).all() as Array<Record<string, unknown>>;
  return rows
    .filter((r) => r.id != null && r.id !== "")
    .map((r) => {
      const doc: BrandMeiliDocument = { id: String(r.id), type: index.docType };
      for (const c of available) {
        if (c === "id") continue;
        doc[c] = r[c] ?? null;
      }
      return doc;
    });
}

/**
 * Indexe une brand.db selon un BrandMeiliFeed (UIDs génériques).
 */
export async function runFeedIndexation(opts: {
  feed: BrandMeiliFeed;
  dbPath?: string;
  meiliHost?: string;
  masterKey?: string;
  log?: LogFn;
  appVersion?: string;
}): Promise<{ indexed: Record<string, number>; engine: "meili" | "skipped" }> {
  const log = opts.log ?? ((line) => console.log(line));
  const feed = opts.feed;
  const dbPath = opts.dbPath ?? process.env.DB_PATH;
  const meiliHost = opts.meiliHost ?? process.env.MEILI_HOST;
  const masterKey = opts.masterKey ?? process.env.MEILI_MASTER_KEY ?? "";

  if (!dbPath) throw new Error("DB_PATH manquant");
  if (!meiliHost) throw new Error("MEILI_HOST manquant");
  if (!fs.existsSync(dbPath)) throw new Error(`[meili] DB manquante: ${dbPath}`);

  const meili = createMeiliClient(meiliHost, masterKey);
  if (!(await meiliAvailable(meili, log))) {
    return { indexed: {}, engine: "skipped" };
  }

  const started = Date.now();
  writeMeta(
    dbPath,
    MEILI_INDEX_IN_PROGRESS_KEY,
    JSON.stringify({
      startedAt: new Date().toISOString(),
      feedId: feed.id,
      appVersion: opts.appVersion,
    }),
  );
  emitOpsEvent({ level: "event", kind: "index.start", ctx: { feed: feed.id } });

  const db = openSqlite(dbPath, { readonly: true, fileMustExist: true });
  const indexed: Record<string, number> = {};
  try {
    // Compteurs génériques : clés fingerprint = countKey déclaré par la marque.
    const sqlCounts: CatalogSqlCounts = {};
    for (const [key, table] of Object.entries(feed.countTables)) {
      sqlCounts[fingerprintCountKey(key)] = countTable(db, table);
    }
    const totalDocs = feed.indexes.reduce(
      (acc, idx) => acc + (sqlCounts[fingerprintCountKey(idx.countKey)] ?? 0),
      0,
    );
    let done = 0;
    const bump = (n: number) => {
      done += n;
      if (totalDocs > 0) {
        console.log(
          `${feed.progressPrefix}PROGRESS ${JSON.stringify({ done, total: totalDocs })}`,
        );
      }
    };

    for (const index of feed.indexes) {
      const newUid = `${index.uid}_new`;
      await recreateIndex(meili, newUid, index.settings as Json);
      const docs = loadDocs(db, feed, index);
      for (let i = 0; i < docs.length; i += BATCH_MEILI) {
        const batch = docs.slice(i, i + BATCH_MEILI);
        await waitTask(
          meili,
          await meili.request(
            "POST",
            `/indexes/${newUid}/documents?primaryKey=id`,
            batch,
          ),
        );
        bump(batch.length);
      }
      await swapAndCleanup(meili, index.uid);
      indexed[index.uid] = docs.length;
      log(`[meili] ${index.uid}: ${docs.length} docs (swap OK)`);
    }

    for (const uid of feed.obsoleteIndexUids || []) {
      await deleteIndexIfExists(meili, uid, log);
      await deleteIndexIfExists(meili, `${uid}_new`, log);
    }

    const fp: MeiliFingerprint = {
      indexSchema: feed.schemaVersion,
      sqliteSchema: readSqliteSchemaVersion(db),
      counts: sqlCounts,
      builtAt: new Date().toISOString(),
      appVersion: opts.appVersion,
    };
    writeMeta(dbPath, MEILI_FINGERPRINT_META_KEY, serializeFingerprint(fp));

    const metaUid = feed.metaIndexUid || "catalog_meta";
    try {
      if (!(await indexExists(meili, metaUid))) {
        await createIndex(meili, metaUid);
      }
      await waitTask(
        meili,
        await meili.request("POST", `/indexes/${metaUid}/documents?primaryKey=id`, [
          { id: "fingerprint", feedId: feed.id, ...fp },
        ]),
      );
    } catch (e) {
      log(
        `[meili] fingerprint Meili non écrit (${e instanceof Error ? e.message : e})`,
      );
    }

    clearMeta(dbPath, MEILI_INDEX_IN_PROGRESS_KEY);
    emitOpsEvent({
      level: "event",
      kind: "index.done",
      outcome: "ok",
      durationMs: Date.now() - started,
      ctx: { feed: feed.id, ...indexed },
    });
    log(
      `[meili] feed=${feed.id} terminé en ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    return { indexed, engine: "meili" };
  } finally {
    db.close();
  }
}

/**
 * Recherche multi-index Meili — retourne [] si q vide / host absent.
 *
 * Fail-closed (Meili = composant core) : seul un index ABSENT (HTTP 404,
 * indexation initiale pas encore passée) est toléré silencieusement.
 * Toute autre erreur (Meili down, refus connexion, timeout, 5xx) est
 * RETHROW — l'appelant (search mount) doit la transformer en
 * 503 `meili_unavailable`, jamais en fallback SQL silencieux.
 */
/**
 * PATCH `pagination.maxTotalHits` sur des index déjà swapés — pas de
 * réindexation. Appelé au boot quand le fingerprint est cohérent
 * (sinon `recreateIndex` pose déjà le plancher).
 */
export async function ensureMeiliPaginationSettings(opts: {
  meiliHost: string;
  masterKey?: string;
  indexUids: readonly string[];
  log?: LogFn;
}): Promise<void> {
  const log = opts.log ?? ((line) => console.log(line));
  if (!opts.meiliHost || opts.indexUids.length === 0) return;
  const meili = createMeiliClient(opts.meiliHost, opts.masterKey || "");
  for (const uid of opts.indexUids) {
    try {
      const settings = (await meili.request(
        "GET",
        `/indexes/${uid}/settings`,
      )) as { pagination?: { maxTotalHits?: unknown } };
      const current = settings?.pagination?.maxTotalHits;
      if (!needsMeiliMaxTotalHitsRaise(current)) continue;
      const merged = mergeMeiliIndexSettings({
        pagination: { maxTotalHits: current },
      });
      await waitTask(
        meili,
        await meili.request("PATCH", `/indexes/${uid}/settings`, {
          pagination: merged.pagination,
        }),
      );
      log(
        `[meili] ${uid}: pagination.maxTotalHits ${String(current ?? "défaut")} → ${String((merged.pagination as { maxTotalHits: number }).maxTotalHits)}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/^Meili HTTP 404\b/.test(msg)) continue;
      log(
        `[meili] ${uid}: maxTotalHits ensure ignoré (${msg.slice(0, 180)})`,
      );
    }
  }
}

export async function searchMeiliIndexes(opts: {
  host: string;
  masterKey?: string;
  indexUids: readonly string[];
  query: string;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  const q = opts.query.trim();
  if (!q || !opts.host) return [];
  const meili = createMeiliClient(opts.host, opts.masterKey || "");
  const limit = opts.limit ?? 20;
  const hits: Array<Record<string, unknown>> = [];
  for (const uid of opts.indexUids) {
    try {
      const res = (await meili.request("POST", `/indexes/${uid}/search`, {
        q,
        limit,
      })) as { hits?: Array<Record<string, unknown>> };
      for (const h of res.hits || []) {
        hits.push({ ...h, _index: uid });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/^Meili HTTP 404\b/.test(msg)) continue; // index pas encore créé
      throw err;
    }
  }
  return hits;
}
