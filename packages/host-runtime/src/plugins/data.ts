/**
 * Migrations SQLite des plugins — port TF gold plugin-data.ts (N1).
 *
 * NE JAMAIS importer depuis le main Electron : exécuter en sous-process
 * Node vanilla via `bindings.nodeScript("plugin-data.js")` (cf. migratePluginData
 * dans control-extras). Utilise `node:sqlite` (kit) — les marques peuvent
 * injecter better-sqlite3 via `openDatabase`.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  openNodeSqliteDatabase,
  type OpenSqliteDatabase,
  type SqliteDatabase,
} from "@creezio/platform-core";

export type PluginDataMigrationReport = {
  databasePath: string;
  backupPath: string | null;
  applied: string[];
  skipped: string[];
};

function assertPluginDir(pluginDir: string): string {
  const resolved = path.resolve(pluginDir);
  if (!fs.existsSync(path.join(resolved, "manifest.json"))) {
    throw new Error("dossier plugin invalide");
  }
  return resolved;
}

export function applyPluginDataMigrations(
  pluginDirInput: string,
  opts?: { openDatabase?: OpenSqliteDatabase },
): PluginDataMigrationReport {
  const pluginDir = assertPluginDir(pluginDirInput);
  const dataDir = path.join(pluginDir, "data");
  const migrationsDir = path.join(pluginDir, "migrations");
  fs.mkdirSync(dataDir, { recursive: true });
  const databasePath = path.join(dataDir, "plugin.sqlite");
  const existed = fs.existsSync(databasePath);
  const migrationFiles = fs.existsSync(migrationsDir)
    ? fs
        .readdirSync(migrationsDir)
        .filter((name) => /^\d{3,}_[A-Za-z0-9_.-]+\.sql$/.test(name))
        .sort()
    : [];
  let backupPath: string | null = null;
  if (existed && migrationFiles.length) {
    backupPath = `${databasePath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(databasePath, backupPath);
  }
  const open = opts?.openDatabase || openNodeSqliteDatabase;
  const db: SqliteDatabase = open(databasePath);
  const pragma = (sql: string) => {
    try {
      db.exec(sql);
    } catch {
      /* node:sqlite / better-sqlite3 */
    }
  };
  pragma("PRAGMA foreign_keys=ON");
  pragma("PRAGMA busy_timeout=5000");
  db.exec(
    `CREATE TABLE IF NOT EXISTS _plugin_migrations (
      name TEXT PRIMARY KEY, sha256 TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  );
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    for (const name of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, name), "utf8");
      const sha256 = crypto.createHash("sha256").update(sql).digest("hex");
      const previous = db
        .prepare(`SELECT sha256 FROM _plugin_migrations WHERE name=?`)
        .get(name) as { sha256: string } | undefined;
      if (previous) {
        if (previous.sha256 !== sha256) {
          throw new Error(`migration déjà appliquée puis modifiée: ${name}`);
        }
        skipped.push(name);
        continue;
      }
      db.exec(sql);
      db.prepare(
        `INSERT INTO _plugin_migrations(name, sha256) VALUES (?, ?)`,
      ).run(name, sha256);
      applied.push(name);
    }
    return { databasePath, backupPath, applied, skipped };
  } catch (error) {
    db.close?.();
    if (backupPath) fs.copyFileSync(backupPath, databasePath);
    throw error;
  } finally {
    db.close?.();
  }
}

/** Entrée CLI (compilée en plugin-data.js côté marque). */
export function runPluginDataCli(argv: string[] = process.argv.slice(2)): void {
  const [command, pluginDir] = argv;
  try {
    if (command !== "migrate" || !pluginDir) {
      throw new Error("Usage: plugin-data.js migrate <pluginDir>");
    }
    process.stdout.write(
      `${JSON.stringify(applyPluginDataMigrations(pluginDir))}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}
