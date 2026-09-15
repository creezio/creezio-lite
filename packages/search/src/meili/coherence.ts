/**
 * Cohérence SQLite ↔ Meili au boot Electron.
 *
 * IMPORTANT : pas de better-sqlite3 ici (ABI Node ≠ Electron). Les lectures
 * SQLite passent par un spawn Node vanilla (meili-coherence-query.js).
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  GED_INDEXES,
  INDEX_SCHEMA_VERSION,
  expectedMeiliCounts,
  fingerprintCountKey,
  getMeiliCatalogSqlTables,
  type GedSqlCounts,
  type MeiliFingerprint,
  type GedIndexUid,
} from "./index-schema.js";
import { kitOsResourcesRoot } from "@creezio/platform-core";
import { expectedCountsForFeed, getMeiliBrandFeed } from "./feed.js";
import type { RunningMeili } from "../meili-launcher.js";
import { envForNodeScriptSpawn } from "@creezio/platform-core";

export type MeiliCoherencePaths = {
  dbPath: () => string;
  nodeBinary: () => string;
  nodeScript: (rel: string) => string;
  nodeModulesPathForScripts: () => string | null | undefined;
};

let paths: MeiliCoherencePaths | null = null;

/** Configure les chemins spawn (marque) — requis avant decideMeiliReady. */
export function configureMeiliCoherencePaths(next: MeiliCoherencePaths): void {
  paths = next;
}

function requirePaths(): MeiliCoherencePaths {
  if (!paths) {
    throw new Error(
      "MeiliCoherencePaths absents — appeler configureMeiliCoherencePaths()",
    );
  }
  return paths;
}

export type { GedSqlCounts, MeiliFingerprint };
export { INDEX_SCHEMA_VERSION } from "./index-schema.js";

/**
 * Chemin absolu du script de sonde SQL embarqué dans le package
 * (resources/scripts, copié hors asar côté desktop). Utilisable par le
 * harness serveur pour configurer MeiliCoherencePaths sans connaître le
 * layout interne du package.
 */
export function meiliCoherenceScriptPath(): string {
  return path.join(
    kitOsResourcesRoot(),
    "scripts",
    "meili-coherence-query.cjs",
  );
}

type CoherenceDbSnapshot = {
  sql: GedSqlCounts;
  sqliteSchema: number;
  fingerprint: MeiliFingerprint | null;
  /** Marqueur d'indexation précédente interrompue (peut être absent — anciens builds). */
  indexInProgress?: { startedAt: string; appVersion?: string } | null;
};

function queryDbSnapshot(dbFile: string): CoherenceDbSnapshot {
  const p = requirePaths();
  const script = p.nodeScript("meili-coherence-query.js");
  const bin = p.nodeBinary();
  // Tables comptées : celles du feed marque si configuré, sinon la config
  // courante (mapping générique clé fingerprint → table SQL).
  const feed = getMeiliBrandFeed();
  const rawTables = feed ? feed.countTables : getMeiliCatalogSqlTables();
  const countTables: Record<string, string> = {};
  for (const [key, table] of Object.entries(rawTables)) {
    countTables[fingerprintCountKey(key)] = table;
  }
  const env: NodeJS.ProcessEnv = {
    ...envForNodeScriptSpawn(bin),
    DB_PATH: dbFile,
    CREEZIO_MEILI_COUNT_TABLES: JSON.stringify(countTables),
  };
  const nm = p.nodeModulesPathForScripts();
  if (nm) env.NODE_PATH = nm;
  const r = spawnSync(bin, [script], {
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(
      `meili-coherence-query exit ${r.status}: ${(r.stderr || r.stdout || "").slice(0, 400)}`,
    );
  }
  const line = (r.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (!line) throw new Error("meili-coherence-query: stdout vide");
  return JSON.parse(line) as CoherenceDbSnapshot;
}

async function meiliIndexStats(
  m: RunningMeili,
  uid: string,
): Promise<{ ok: boolean; missing: boolean; docs: number }> {
  try {
    const res = await fetch(`${m.host}/indexes/${uid}/stats`, {
      headers: { Authorization: `Bearer ${m.masterKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return { ok: true, missing: true, docs: 0 };
    if (!res.ok) return { ok: false, missing: false, docs: 0 };
    const data = (await res.json()) as { numberOfDocuments?: number };
    return { ok: true, missing: false, docs: Number(data.numberOfDocuments || 0) };
  } catch {
    return { ok: false, missing: false, docs: 0 };
  }
}

export type MeiliReadyDecision = {
  ready: boolean;
  reason: string;
  sql: GedSqlCounts;
  /** Docs par UID vérifié (UIDs du feed marque, sinon catalog_* génériques). */
  meili: Record<string, number>;
  fingerprint: MeiliFingerprint | null;
  sqliteSchema: number;
  /** Indexation précédente interrompue (marqueur meta resté en place). */
  interruptedPrevious: boolean;
};

/**
 * Ready seulement si fingerprint aligné + chaque index attendu peuplé si SQL > 0.
 *
 * UIDs + compteurs attendus : depuis le `BrandMeiliFeed` configuré si
 * présent (marques feed) — sinon les UIDs génériques `catalog_*` par défaut.
 *
 * `strictCounts` (serveur headless) : exige l'égalité exacte des compteurs
 * SQL ↔ Meili par index — le mode desktop historique tolère la dérive
 * (seul « index vide alors que SQL > 0 » invalide), mais côté serveur le
 * feed de boot est la SEULE resynchronisation (pas d'indexation
 * incrémentale aux imports) : sauter une réindexation malgré une dérive
 * figerait l'index jusqu'au prochain bump de schemaVersion.
 */
export async function decideMeiliReady(
  m: RunningMeili,
  dbFile?: string,
  opts?: { strictCounts?: boolean },
): Promise<MeiliReadyDecision> {
  dbFile = dbFile ?? requirePaths().dbPath();
  const snap = queryDbSnapshot(dbFile);
  const { sql, sqliteSchema, fingerprint } = snap;
  const interruptedPrevious = Boolean(snap.indexInProgress);
  const feed = getMeiliBrandFeed();
  const expectedSchema = feed ? feed.schemaVersion : INDEX_SCHEMA_VERSION;
  const uids: readonly string[] = feed
    ? feed.indexes.map((i) => i.uid)
    : GED_INDEXES;
  const expected: Record<string, number> = feed
    ? expectedCountsForFeed(feed, sql)
    : expectedMeiliCounts(sql);
  const meili: Record<string, number> = {};

  const decide = (ready: boolean, reason: string): MeiliReadyDecision => ({
    ready,
    reason,
    sql,
    meili,
    fingerprint,
    sqliteSchema,
    interruptedPrevious,
  });

  if (!fingerprint) {
    return decide(
      false,
      interruptedPrevious
        ? "fingerprint-absent (indexation précédente interrompue)"
        : "fingerprint-absent",
    );
  }
  if (fingerprint.indexSchema !== expectedSchema) {
    return decide(
      false,
      `index-schema-mismatch fp=${fingerprint.indexSchema} want=${expectedSchema}`,
    );
  }
  if (fingerprint.sqliteSchema !== sqliteSchema) {
    return decide(
      false,
      `sqlite-schema-mismatch fp=${fingerprint.sqliteSchema} want=${sqliteSchema}`,
    );
  }

  for (const uid of uids) {
    const st = await meiliIndexStats(m, uid);
    if (!st.ok) {
      return decide(false, `meili-stats-error:${uid}`);
    }
    if (st.missing) {
      return decide(false, `index-missing:${uid}`);
    }
    meili[uid] = st.docs;
    const want = expected[uid] ?? 0;
    if (want > 0 && st.docs === 0) {
      return decide(false, `index-empty-while-sql:${uid} sql=${want}`);
    }
    if (opts?.strictCounts && st.docs !== want) {
      return decide(
        false,
        `count-drift:${uid} meili=${st.docs} want=${want}`,
      );
    }
  }

  return decide(true, "fingerprint-ok");
}
