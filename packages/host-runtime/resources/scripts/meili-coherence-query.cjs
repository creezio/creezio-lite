/*
 * Lecteur SQLite autonome pour le contrôle de cohérence Meili.
 *
 * Il est copié hors app.asar dans resources/scripts afin d'être exécutable par
 * le Node embarqué. Ne dépend volontairement d'aucun module de la marque ni
 * de better-sqlite3 : Electron/Node 22 expose node:sqlite.
 */
"use strict";

const { DatabaseSync } = require("node:sqlite");

const DB_PATH = process.env.DB_PATH;
if (!DB_PATH) {
  console.error("DB_PATH manquant");
  process.exit(2);
}

function tableExists(db, name) {
  return Number(
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?",
      )
      .get(name).c || 0,
  ) > 0;
}

function count(db, name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !tableExists(db, name)) {
    return 0;
  }
  return Number(db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get().c || 0);
}

function metaValue(db, key) {
  if (!tableExists(db, "meta")) return null;
  try {
    return db
      .prepare("SELECT value FROM meta WHERE key=?")
      .get(key)?.value ?? null;
  } catch {
    return null;
  }
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
try {
  // Même convention que l'indexeur (generic-indexer.readSqliteSchemaVersion) :
  // table meta, clé schema_version — le user_version SQLite n'est jamais
  // écrit par les migrations marque (mismatch systématique → réindexation
  // à chaque boot, régression prod serveur).
  const sqliteSchema = (() => {
    if (!tableExists(db, "meta")) return 0;
    const row = db
      .prepare("SELECT value FROM meta WHERE key='schema_version'")
      .get();
    return Number(row?.value || 0);
  })();
  const rawFingerprint = metaValue(db, "meili_index_fingerprint");
  const rawInProgress = metaValue(db, "meili_index_in_progress");
  let fingerprint = null;
  let indexInProgress = null;
  try {
    fingerprint = rawFingerprint ? JSON.parse(rawFingerprint) : null;
  } catch {
    /* fingerprint invalide => réindexation */
  }
  try {
    indexInProgress = rawInProgress ? JSON.parse(rawInProgress) : null;
  } catch {
    /* marqueur invalide => ignoré */
  }
  // Tables comptées : mapping générique clé fingerprint → table SQL
  // (CREEZIO_MEILI_COUNT_TABLES, posé par la cohérence depuis le feed).
  // Dual-read UNE version : envs legacy PRODUCTS/SITES puis défauts hérités.
  let countTables = null;
  try {
    const raw = process.env.CREEZIO_MEILI_COUNT_TABLES;
    if (raw) countTables = JSON.parse(raw);
  } catch {
    /* mapping invalide => fallback legacy */
  }
  if (!countTables || typeof countTables !== "object") {
    countTables = {
      produits: process.env.CREEZIO_MEILI_PRODUCTS_TABLE || "produits",
      fournisseurs: process.env.CREEZIO_MEILI_SITES_TABLE || "fournisseurs",
    };
  }
  const sql = {};
  for (const [key, table] of Object.entries(countTables)) {
    if (typeof table === "string") sql[key] = count(db, table);
  }
  process.stdout.write(
    JSON.stringify({
      sql,
      sqliteSchema,
      fingerprint,
      indexInProgress,
    }) + "\n",
  );
} finally {
  db.close();
}
