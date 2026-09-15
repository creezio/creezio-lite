#!/usr/bin/env node
/**
 * Résilience WAL SQLite — régression prod TF3 (08→09/08/2026) : après un
 * kill sauvage du container (SIGKILL de recreate / OOM), le couple
 * -wal/-shm peut devenir incohérent avec le fichier principal et l'open
 * échoue en « database disk image is malformed » alors que le fichier
 * principal est sain → boot-loop + rollback en boucle.
 *
 * Verrous :
 *  1. openWithWalQuarantine câblé dans createSqliteRuntime (core + brand +
 *     plugins via le wrapper `open`) — quarantaine des sidecars puis retry ;
 *     le fichier principal réellement corrompu doit toujours JETER (pas de
 *     masquage).
 *  2. close() fait un checkpoint PASSIVE best-effort avant de fermer.
 *  3. Harness : closeKernel() (SQLite) AVANT l'arrêt des sidecars lents
 *     (Meili, navigateur, plugins) — le SIGKILL de docker stop (~10 s) ne
 *     doit plus pouvoir frapper avant la fermeture des DB.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

test("S1 createSqliteRuntime : quarantaine WAL + checkpoint close câblés", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "packages/platform-core/src/sqlite-runtime.ts"),
    "utf8",
  );
  assert.match(src, /function openWithWalQuarantine\(/);
  assert.match(src, /function isSqliteCorruptOpen\(/);
  assert.match(src, /errcode === 11/); // SQLITE_CORRUPT
  assert.match(src, /-wal`, `\$\{dbPath\}-shm|dbPath\}-wal/);
  assert.match(src, /quarantine-/);
  // Le wrapper enveloppe l'opener injecté (couvre core, brand ET plugins).
  assert.match(src, /openWithWalQuarantine\(baseOpen, dbPath\)/);
  assert.match(src, /wal_checkpoint\(PASSIVE\)/);
});

test("S2 harness : DB fermée avant les sidecars lents", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/src/start-brand-kernel-harness.ts"),
    "utf8",
  );
  const closeBody = src.match(/const close = async \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(closeBody, "close() introuvable");
  const body = closeBody[1];
  const iKernel = body.indexOf("closeKernel()");
  const iMeili = body.indexOf("meiliStop?.()");
  const iPlugins = body.indexOf("pluginsPhase?.close()");
  const iBrowser = body.indexOf("browserSidecar?.close()");
  assert.ok(iKernel > -1 && iMeili > -1 && iPlugins > -1 && iBrowser > -1);
  assert.ok(
    iKernel < iMeili && iKernel < iPlugins && iKernel < iBrowser,
    "closeKernel() doit précéder l'arrêt des sidecars (budget SIGKILL 10 s)",
  );
});

test("S3 fonctionnel : cycle WAL propre, WAL chaud accepté, fichier corrompu jeté", async () => {
  const { createSqliteRuntime } = await import(
    path.join(ROOT, "packages/platform-core/dist/index.js")
  );
  const { demobrandManifest } = await import(
    path.join(ROOT, "packages/brand-config/dist/index.js")
  );
  const userDataRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "creezio-wal-resilience-"),
  );
  const ctx = {
    manifest: demobrandManifest,
    userDataRoot,
    isPackaged: true,
    env: {},
  };

  // (a) cycle propre : open → write → close → reopen
  let rt = createSqliteRuntime({ ctx });
  const brandPath = rt.paths.brand;
  rt.getBrand().exec("PRAGMA journal_mode=WAL;");
  rt.getBrand().exec("CREATE TABLE t (id TEXT); INSERT INTO t VALUES ('a');");
  rt.close();
  rt = createSqliteRuntime({ ctx });
  const row = rt.getBrand().prepare("SELECT COUNT(*) AS c FROM t").get();
  assert.equal(Number(row.c), 1);
  rt.close();

  // (b) WAL chaud laissé par un process mort sans close → open normal
  // (la quarantaine ne doit PAS se déclencher sur un WAL cohérent).
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      `const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.argv[1]);
db.exec("INSERT INTO t VALUES ('b')");
process.exit(0); // sortie sèche : WAL chaud non checkpointé`,
      brandPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
  rt = createSqliteRuntime({ ctx });
  const row2 = rt.getBrand().prepare("SELECT COUNT(*) AS c FROM t").get();
  assert.equal(Number(row2.c), 2, "le WAL chaud doit être rejoué normalement");
  rt.close();

  // (c) fichier principal réellement corrompu → l'open doit JETER
  // (la quarantaine ne masque jamais une corruption du fichier principal).
  const fd = fs.openSync(brandPath, "r+");
  fs.writeSync(fd, Buffer.alloc(100, 0x5a), 0, 100, 0);
  fs.closeSync(fd);
  assert.throws(() => createSqliteRuntime({ ctx }), /malformed|not a database|SQLITE|corrupt/i);
});
