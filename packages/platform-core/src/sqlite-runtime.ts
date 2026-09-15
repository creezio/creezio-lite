/**
 * Runtime multi-DB SQLite (H2.0) — handles core / brand / plugin/<id>.
 *
 * Jour 0 serveur : ouvre **core + brand** uniquement.
 * Plugin : `openPlugin(id)` à l'install (ensurePluginDb + migrations).
 */

import fs from "node:fs";
import type { PathsContext } from "./paths.js";
import {
  openNodeSqliteDatabase,
  type OpenSqliteDatabase,
  type SqliteDatabase,
  type SqliteStatement,
} from "./sqlite-driver.js";
import {
  ensureMigrations,
  listAppliedMigrations,
  type EnsureMigrationsResult,
  type SqliteMigration,
} from "./sqlite-migrations.js";
import {
  ensureDay0SqliteLayout,
  ensurePluginDb,
  pluginDbExists,
  removePluginDb,
  resolveBrandDbPath,
  resolveCoreDbPath,
  resolvePluginDbPath,
} from "./sqlite-layout.js";

export type SqliteLayerKind = "core" | "brand" | "plugin";

export type SqliteLayerRef =
  | { kind: "core" }
  | { kind: "brand" }
  | { kind: "plugin"; pluginId: string };

export type SqliteHandle = {
  readonly layer: SqliteLayerRef;
  readonly path: string;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
  listMigrations(): string[];
};

export type SqliteRuntimeStatus = {
  corePath: string;
  brandPath: string;
  coreOpen: boolean;
  brandOpen: boolean;
  /** Plugin ids dont le handle est ouvert (pas seulement fichier existant). */
  openPlugins: string[];
  /** Plugin ids dont le fichier DB existe sur disque. */
  installedPlugins: string[];
};

export type OpenPluginResult = {
  handle: SqliteHandle;
  created: boolean;
  migrations: EnsureMigrationsResult;
};

export type SqliteRuntime = {
  readonly paths: { core: string; brand: string };
  getCore(): SqliteHandle;
  getBrand(): SqliteHandle;
  /** Throw si plugin non ouvert. */
  getPlugin(pluginId: string): SqliteHandle;
  hasPluginOpen(pluginId: string): boolean;
  pluginFileExists(pluginId: string): boolean;
  /**
   * Install / open plugin DB : ensure fichier + open + migrations plugin.
   * Ne touche jamais core/brand.
   */
  openPlugin(
    pluginId: string,
    migrations?: readonly SqliteMigration[],
  ): OpenPluginResult;
  /**
   * H5 — ferme le handle plugin (fichier conserve).
   * Retourne false si non ouvert.
   */
  closePlugin(pluginId: string): boolean;
  /**
   * H5 — uninstall : close handle + delete fichier `plugin/<id>.db`.
   * Ne touche jamais core/brand.
   */
  uninstallPlugin(pluginId: string): {
    closed: boolean;
    removed: boolean;
    path: string;
  };
  listOpenPlugins(): string[];
  status(): SqliteRuntimeStatus;
  close(): void;
};

export type CreateSqliteRuntimeOptions = {
  ctx: PathsContext;
  /** Migrations appliquées sur core au boot (jour 0). */
  coreMigrations?: readonly SqliteMigration[];
  /** Migrations appliquées sur brand au boot (jour 0). */
  brandMigrations?: readonly SqliteMigration[];
  openDatabase?: OpenSqliteDatabase;
  /** Touch brand file si absent (défaut true). */
  touchBrand?: boolean;
};

function wrapHandle(
  layer: SqliteLayerRef,
  dbPath: string,
  db: SqliteDatabase,
): SqliteHandle {
  let closed = false;
  return {
    layer,
    path: dbPath,
    exec(sql) {
      if (closed) throw new Error("sqlite handle closed");
      db.exec(sql);
    },
    prepare(sql) {
      if (closed) throw new Error("sqlite handle closed");
      return db.prepare(sql);
    },
    close() {
      if (closed) return;
      closed = true;
      db.close?.();
    },
    listMigrations() {
      if (closed) throw new Error("sqlite handle closed");
      return listAppliedMigrations(db);
    },
  };
}

/**
 * true si l'erreur d'ouverture est une corruption SQLite (SQLITE_CORRUPT /
 * NOTADB) — seul cas où la quarantaine WAL est légitime.
 */
function isSqliteCorruptOpen(err: unknown): boolean {
  const e = err as { errcode?: number; message?: string } | null;
  const msg = String(e?.message || err || "");
  return (
    e?.errcode === 11 || // SQLITE_CORRUPT
    e?.errcode === 26 || // SQLITE_NOTADB
    /malformed|not a database|database disk image/i.test(msg)
  );
}

/**
 * Ouvre une DB avec auto-guérison WAL : après un kill sauvage (OOM killer,
 * SIGKILL de recreate Docker), le couple -wal/-shm peut être incohérent avec
 * le fichier principal — l'open échoue alors en « database disk image is
 * malformed » alors que le fichier principal est sain (constat prod 2×).
 * La relecture du WAL étant précisément ce qui échoue, on met les sidecars
 * en quarantaine et on rouvre le fichier principal seul (les frames non
 * checkpointées du WAL orphelin sont perdues — préférable à un boot-loop).
 * Si le fichier principal est lui-même corrompu, le retry jette l'erreur
 * d'origine : pas de masquage.
 */
function openWithWalQuarantine(
  open: OpenSqliteDatabase,
  dbPath: string,
): SqliteDatabase {
  const probe = (db: SqliteDatabase): SqliteDatabase => {
    // Force la relecture du WAL dès l'open (node:sqlite peut être paresseux).
    db.prepare("SELECT COUNT(*) AS c FROM sqlite_master").get();
    return db;
  };
  try {
    return probe(open(dbPath));
  } catch (err) {
    if (!isSqliteCorruptOpen(err)) throw err;
    const sidecars = [`${dbPath}-wal`, `${dbPath}-shm`].filter((p) =>
      fs.existsSync(p),
    );
    if (sidecars.length === 0) throw err; // pas de WAL → fichier principal corrompu
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (const side of sidecars) {
      try {
        fs.renameSync(side, `${side}.quarantine-${stamp}`);
      } catch {
        /* rename impossible → on tente l'open quand même */
      }
    }
    console.warn(
      `[sqlite] open « malformed » sur ${dbPath} — WAL/SHM mis en quarantaine ` +
        `(${sidecars.length} fichier(s)), retry sur le fichier principal ` +
        `(${err instanceof Error ? err.message : err})`,
    );
    return probe(open(dbPath));
  }
}

/**
 * Crée le runtime multi-DB : layout jour 0 + open core/brand + migrations.
 * Aucun plugin n'est ouvert tant que `openPlugin` n'est pas appelé.
 */
export function createSqliteRuntime(
  opts: CreateSqliteRuntimeOptions,
): SqliteRuntime {
  const baseOpen = opts.openDatabase || openNodeSqliteDatabase;
  const open: OpenSqliteDatabase = (dbPath) =>
    openWithWalQuarantine(baseOpen, dbPath);
  const touchBrand = opts.touchBrand !== false;
  const day0 = ensureDay0SqliteLayout(opts.ctx, { touchBrand });

  const coreDb = open(day0.core);
  coreDb.exec("PRAGMA foreign_keys = ON;");
  if (opts.coreMigrations?.length) {
    ensureMigrations(coreDb, opts.coreMigrations);
  } else {
    ensureMigrations(coreDb, []);
  }

  const brandDb = open(day0.brand);
  brandDb.exec("PRAGMA foreign_keys = ON;");
  if (opts.brandMigrations?.length) {
    ensureMigrations(brandDb, opts.brandMigrations);
  } else {
    ensureMigrations(brandDb, []);
  }

  let coreHandle: SqliteHandle | null = wrapHandle(
    { kind: "core" },
    day0.core,
    coreDb,
  );
  let brandHandle: SqliteHandle | null = wrapHandle(
    { kind: "brand" },
    day0.brand,
    brandDb,
  );
  const plugins = new Map<string, SqliteHandle>();
  let closed = false;

  function assertOpen(): void {
    if (closed) throw new Error("SqliteRuntime closed");
  }

  return {
    paths: { core: day0.core, brand: day0.brand },

    getCore() {
      assertOpen();
      if (!coreHandle) throw new Error("core handle missing");
      return coreHandle;
    },

    getBrand() {
      assertOpen();
      if (!brandHandle) throw new Error("brand handle missing");
      return brandHandle;
    },

    getPlugin(pluginId) {
      assertOpen();
      const h = plugins.get(pluginId);
      if (!h) {
        throw new Error(`plugin DB non ouverte: ${pluginId}`);
      }
      return h;
    },

    hasPluginOpen(pluginId) {
      return plugins.has(pluginId);
    },

    pluginFileExists(pluginId) {
      return pluginDbExists(opts.ctx, pluginId);
    },

    openPlugin(pluginId, migrations = []) {
      assertOpen();
      const existing = plugins.get(pluginId);
      if (existing) {
        const mig =
          migrations.length > 0
            ? ensureMigrations(
                {
                  exec: (sql) => existing.exec(sql),
                  prepare: (sql) => existing.prepare(sql),
                },
                migrations,
              )
            : { applied: [] as string[], already: existing.listMigrations() };
        return { handle: existing, created: false, migrations: mig };
      }

      const ensured = ensurePluginDb(opts.ctx, pluginId);
      const db = open(ensured.path);
      db.exec("PRAGMA foreign_keys = ON;");
      const mig = ensureMigrations(db, migrations);
      const handle = wrapHandle(
        { kind: "plugin", pluginId },
        ensured.path,
        db,
      );
      plugins.set(pluginId, handle);
      return { handle, created: ensured.created, migrations: mig };
    },

    closePlugin(pluginId) {
      assertOpen();
      const h = plugins.get(pluginId);
      if (!h) return false;
      h.close();
      plugins.delete(pluginId);
      return true;
    },

    uninstallPlugin(pluginId) {
      assertOpen();
      const closed = Boolean(plugins.get(pluginId));
      if (closed) {
        plugins.get(pluginId)!.close();
        plugins.delete(pluginId);
      }
      const removed = removePluginDb(opts.ctx, pluginId);
      return {
        closed,
        removed: removed.removed,
        path: removed.path,
      };
    },

    listOpenPlugins() {
      return [...plugins.keys()].sort();
    },

    status() {
      const installed: string[] = [];
      // Ne scanne pas le FS exhaustivement — expose open + existence connue via openPlugin.
      for (const id of plugins.keys()) {
        if (pluginDbExists(opts.ctx, id)) installed.push(id);
      }
      return {
        corePath: resolveCoreDbPath(opts.ctx),
        brandPath: resolveBrandDbPath(opts.ctx),
        coreOpen: Boolean(coreHandle) && !closed,
        brandOpen: Boolean(brandHandle) && !closed,
        openPlugins: [...plugins.keys()].sort(),
        installedPlugins: installed.sort(),
      };
    },

    close() {
      if (closed) return;
      closed = true;
      // Checkpoint passif best-effort avant fermeture : pousse les frames du
      // WAL dans le fichier principal tant que possible. La dernière
      // connexion qui se ferme checkpointe + tronque le WAL (comportement
      // SQLite) — critique pour qu'un recreate Docker ne retrouve jamais un
      // WAL chaud inutile au boot suivant.
      const passiveCheckpoint = (h: SqliteHandle | null) => {
        try {
          h?.exec("PRAGMA wal_checkpoint(PASSIVE);");
        } catch {
          /* DB en journal non-WAL ou verrouillée → close() standard */
        }
      };
      for (const h of plugins.values()) {
        passiveCheckpoint(h);
        h.close();
      }
      plugins.clear();
      passiveCheckpoint(brandHandle);
      brandHandle?.close();
      passiveCheckpoint(coreHandle);
      coreHandle?.close();
      brandHandle = null;
      coreHandle = null;
    },
  };
}

/** Résout le chemin d'une couche (utile tests / diagnostics). */
export function resolveLayerPath(
  ctx: PathsContext,
  layer: SqliteLayerRef,
): string {
  if (layer.kind === "core") return resolveCoreDbPath(ctx);
  if (layer.kind === "brand") return resolveBrandDbPath(ctx);
  return resolvePluginDbPath(ctx, layer.pluginId);
}
